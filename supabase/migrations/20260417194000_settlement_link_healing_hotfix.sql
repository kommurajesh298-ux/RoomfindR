begin;

create or replace function public.is_settlement_payment_type_match(
  p_settlement_payment_type text,
  p_payment_type text
)
returns boolean
language sql
immutable
as $$
  select case
    when lower(coalesce(nullif(p_settlement_payment_type, ''), '')) in ('monthly', 'rent', 'monthly_rent')
      then lower(coalesce(nullif(p_payment_type, ''), '')) in ('monthly', 'rent', 'monthly_rent')
    when lower(coalesce(nullif(p_settlement_payment_type, ''), '')) in ('advance', 'booking', 'full', 'deposit')
      then lower(coalesce(nullif(p_payment_type, ''), 'booking')) in ('advance', 'booking', 'full', 'deposit')
    when coalesce(nullif(lower(p_settlement_payment_type), ''), '') = ''
      then true
    else lower(coalesce(nullif(p_payment_type, ''), '')) = lower(p_settlement_payment_type)
  end;
$$;

create or replace function public.find_best_payment_for_settlement(
  p_settlement_id uuid,
  p_booking_id uuid,
  p_owner_id uuid,
  p_payment_id uuid,
  p_payment_type text,
  p_total_amount numeric,
  p_created_at timestamptz
)
returns table (
  payment_id uuid,
  booking_id uuid
)
language plpgsql
as $$
begin
  if p_payment_id is not null then
    return query
    select p.id, p.booking_id
    from public.payments p
    where p.id = p_payment_id
    limit 1;
    return;
  end if;

  return query
  with candidates as (
    select
      p.id as payment_id,
      p.booking_id,
      case
        when public.is_settlement_payment_type_match(p_payment_type, p.payment_type) then 0
        else 1
      end as type_rank,
      case
        when p_total_amount is not null
          and p_total_amount > 0
          and abs(coalesce(p.amount, 0) - p_total_amount) <= 0.01
          then 0
        else 1
      end as amount_rank,
      abs(
        extract(
          epoch from (
            coalesce(p.verified_at, p.payment_date, p.created_at, p_created_at, timezone('utc', now()))
            - coalesce(p_created_at, p.verified_at, p.payment_date, p.created_at, timezone('utc', now()))
          )
        )
      ) as time_distance
    from public.payments p
    join public.bookings b
      on b.id = p.booking_id
    where lower(
      coalesce(
        nullif(trim(coalesce(p.payment_status::text, '')), ''),
        nullif(trim(coalesce(p.status::text, '')), ''),
        ''
      )
    ) in ('completed', 'success', 'authorized')
      and (p_booking_id is null or p.booking_id = p_booking_id)
      and (p_booking_id is not null or p_owner_id is null or b.owner_id = p_owner_id)
      and not exists (
        select 1
        from public.settlements s2
        where s2.payment_id = p.id
          and (p_settlement_id is null or s2.id <> p_settlement_id)
      )
  )
  select c.payment_id, c.booking_id
  from candidates c
  order by c.type_rank asc, c.amount_rank asc, c.time_distance asc, c.payment_id asc
  limit 1;
end;
$$;

update public.settlements s
set booking_id = p.booking_id
from public.payments p
where s.payment_id = p.id
  and s.booking_id is null;

with matched_links as (
  select
    s.id as settlement_id,
    best.payment_id,
    best.booking_id
  from public.settlements s
  cross join lateral public.find_best_payment_for_settlement(
    s.id,
    s.booking_id,
    s.owner_id,
    s.payment_id,
    s.payment_type,
    s.total_amount,
    s.created_at
  ) best
  where s.booking_id is null or s.payment_id is null
)
update public.settlements s
set
  booking_id = coalesce(s.booking_id, matched_links.booking_id),
  payment_id = coalesce(s.payment_id, matched_links.payment_id)
from matched_links
where s.id = matched_links.settlement_id
  and (
    (s.booking_id is null and matched_links.booking_id is not null)
    or (s.payment_id is null and matched_links.payment_id is not null)
  );

update public.wallet_transactions wt
set payment_id = s.payment_id
from public.settlements s
where wt.settlement_id = s.id
  and wt.payment_id is null
  and s.payment_id is not null;

create or replace function public.heal_settlement_links()
returns trigger
language plpgsql
as $$
declare
  v_match record;
begin
  if new.payment_id is not null and new.booking_id is null then
    select p.booking_id
    into new.booking_id
    from public.payments p
    where p.id = new.payment_id;
  end if;

  if new.payment_id is null or new.booking_id is null then
    select *
    into v_match
    from public.find_best_payment_for_settlement(
      new.id,
      new.booking_id,
      new.owner_id,
      new.payment_id,
      new.payment_type,
      new.total_amount,
      coalesce(new.created_at, timezone('utc', now()))
    );

    if new.payment_id is null then
      new.payment_id := v_match.payment_id;
    end if;

    if new.booking_id is null then
      new.booking_id := v_match.booking_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists settlements_heal_links_trigger on public.settlements;

create trigger settlements_heal_links_trigger
before insert or update of booking_id, payment_id, owner_id, payment_type, total_amount, created_at
on public.settlements
for each row
execute function public.heal_settlement_links();

notify pgrst, 'reload schema';

commit;
