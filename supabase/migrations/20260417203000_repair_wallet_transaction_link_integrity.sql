begin;

create or replace function public.resolve_wallet_txn_payment_id(
  p_settlement_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  if p_settlement_id is null then
    return null;
  end if;

  select coalesce(s.payment_id, b.payment_id, p.id)
  into v_payment_id
  from public.settlements s
  left join public.bookings b
    on b.id = s.booking_id
  left join lateral (
    select p2.id
    from public.payments p2
    where p2.booking_id = s.booking_id
    order by
      case
        when lower(
          coalesce(
            nullif(trim(coalesce(p2.payment_status::text, '')), ''),
            nullif(trim(coalesce(p2.status::text, '')), ''),
            ''
          )
        ) in ('completed', 'success', 'authorized', 'paid') then 0
        else 1
      end,
      coalesce(p2.verified_at, p2.payment_date, p2.created_at) desc nulls last
    limit 1
  ) p on true
  where s.id = p_settlement_id
  limit 1;

  return v_payment_id;
end;
$$;

create or replace function public.resolve_wallet_txn_settlement_id(
  p_payment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
begin
  if p_payment_id is null then
    return null;
  end if;

  select s.id
  into v_settlement_id
  from public.payments p
  join public.settlements s
    on s.payment_id = p.id
    or (s.payment_id is null and s.booking_id = p.booking_id)
  where p.id = p_payment_id
  order by
    case
      when upper(coalesce(s.payout_status, s.status::text, '')) in ('PROCESSING', 'PENDING') then 0
      when upper(coalesce(s.payout_status, s.status::text, '')) in ('SUCCESS', 'COMPLETED') then 1
      when upper(coalesce(s.payout_status, s.status::text, '')) = 'FAILED' then 2
      else 3
    end,
    s.updated_at desc nulls last,
    s.created_at desc nulls last
  limit 1;

  return v_settlement_id;
end;
$$;

create or replace function public.find_best_settlement_for_wallet_transaction(
  p_wallet_id uuid,
  p_reference text,
  p_amount numeric,
  p_type text,
  p_created_at timestamptz
)
returns table (
  settlement_id uuid,
  payment_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_reference text;
begin
  select w.owner_id
  into v_owner_id
  from public.wallets w
  where w.id = p_wallet_id
  limit 1;

  if v_owner_id is null or lower(coalesce(p_type, '')) <> 'credit' then
    return;
  end if;

  v_reference := nullif(trim(coalesce(p_reference, '')), '');

  return query
  with candidates as (
    select
      s.id as settlement_id,
      coalesce(s.payment_id, public.resolve_wallet_txn_payment_id(s.id)) as payment_id,
      case
        when v_reference is not null and (
          s.provider_transfer_id = v_reference
          or s.provider_reference = v_reference
          or p.provider_payment_id = v_reference
          or p.provider_order_id = v_reference
        ) then 0
        else 1
      end as reference_rank,
      case
        when p_amount is not null
          and p_amount > 0
          and abs(coalesce(s.net_payable, s.total_amount, 0) - p_amount) <= 0.01
          then 0
        else 1
      end as amount_rank,
      case
        when upper(coalesce(s.payout_status, s.status::text, '')) in ('PROCESSING', 'PENDING', 'SUCCESS', 'COMPLETED') then 0
        when upper(coalesce(s.payout_status, s.status::text, '')) = 'FAILED' then 1
        else 2
      end as status_rank,
      abs(
        extract(
          epoch from (
            coalesce(s.processed_at, s.updated_at, s.created_at, p_created_at, timezone('utc', now()))
            - coalesce(p_created_at, s.processed_at, s.updated_at, s.created_at, timezone('utc', now()))
          )
        )
      ) as time_distance
    from public.settlements s
    left join public.payments p
      on p.id = s.payment_id
    where s.owner_id = v_owner_id
  )
  select c.settlement_id, c.payment_id
  from candidates c
  order by
    c.reference_rank asc,
    c.amount_rank asc,
    c.status_rank asc,
    c.time_distance asc,
    c.settlement_id asc
  limit 1;
end;
$$;

update public.wallet_transactions wt
set payment_id = public.resolve_wallet_txn_payment_id(wt.settlement_id)
where wt.settlement_id is not null
  and wt.payment_id is null;

update public.wallet_transactions wt
set settlement_id = public.resolve_wallet_txn_settlement_id(wt.payment_id)
where wt.payment_id is not null
  and wt.settlement_id is null;

with orphan_matches as (
  select
    wt.id,
    best.settlement_id,
    best.payment_id
  from public.wallet_transactions wt
  cross join lateral public.find_best_settlement_for_wallet_transaction(
    wt.wallet_id,
    wt.reference,
    wt.amount,
    wt.type::text,
    coalesce(wt.created_at, timezone('utc', now()))
  ) best
  where wt.settlement_id is null
    and wt.payment_id is null
)
update public.wallet_transactions wt
set
  settlement_id = orphan_matches.settlement_id,
  payment_id = coalesce(orphan_matches.payment_id, public.resolve_wallet_txn_payment_id(orphan_matches.settlement_id))
from orphan_matches
where wt.id = orphan_matches.id
  and orphan_matches.settlement_id is not null;

create or replace function public.fill_and_guard_wallet_transaction_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.settlement_id is not null and new.payment_id is null then
    new.payment_id := public.resolve_wallet_txn_payment_id(new.settlement_id);
  end if;

  if new.payment_id is not null and new.settlement_id is null then
    new.settlement_id := public.resolve_wallet_txn_settlement_id(new.payment_id);
  end if;

  if (new.reference is null or btrim(new.reference) = '') and new.settlement_id is not null then
    select coalesce(s.provider_transfer_id, s.provider_reference)
    into new.reference
    from public.settlements s
    where s.id = new.settlement_id;
  end if;

  if new.settlement_id is null and new.payment_id is null then
    raise exception 'wallet_transactions requires settlement_id or payment_id';
  end if;

  return new;
end;
$$;

drop trigger if exists wallet_transactions_fill_guard on public.wallet_transactions;
create trigger wallet_transactions_fill_guard
before insert or update on public.wallet_transactions
for each row
execute function public.fill_and_guard_wallet_transaction_links();

create or replace function public.sync_wallet_transaction_payment_link_from_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_id is not null then
    update public.wallet_transactions
    set payment_id = coalesce(public.wallet_transactions.payment_id, new.payment_id)
    where settlement_id = new.id
      and payment_id is null;
  end if;

  return new;
end;
$$;

drop trigger if exists settlements_sync_wallet_txn_payment_link on public.settlements;
create trigger settlements_sync_wallet_txn_payment_link
after insert or update of payment_id on public.settlements
for each row
execute function public.sync_wallet_transaction_payment_link_from_settlement();

create or replace function public.preserve_wallet_transaction_payment_link_on_settlement_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.payment_id is not null then
    update public.wallet_transactions
    set payment_id = coalesce(public.wallet_transactions.payment_id, old.payment_id)
    where settlement_id = old.id
      and payment_id is null;
  end if;

  return old;
end;
$$;

drop trigger if exists settlements_preserve_wallet_txn_links_before_delete on public.settlements;
create trigger settlements_preserve_wallet_txn_links_before_delete
before delete on public.settlements
for each row
execute function public.preserve_wallet_transaction_payment_link_on_settlement_delete();

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_source_link_chk;

alter table public.wallet_transactions
  add constraint wallet_transactions_source_link_chk
  check (settlement_id is not null or payment_id is not null) not valid;

notify pgrst, 'reload schema';

commit;
