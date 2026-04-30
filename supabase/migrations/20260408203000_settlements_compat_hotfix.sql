begin;

alter table public.settlements
  add column if not exists payment_id uuid null references public.payments(id) on delete set null,
  add column if not exists payment_type text null,
  add column if not exists payout_status text null;

create index if not exists settlements_payment_id_idx on public.settlements(payment_id);
create index if not exists settlements_payment_type_idx on public.settlements(payment_type);

update public.settlements
set payout_status = case
  when upper(coalesce(status::text, '')) = 'COMPLETED' then 'success'
  when upper(coalesce(status::text, '')) = 'FAILED' then 'failed'
  when upper(coalesce(status::text, '')) in ('PROCESSING', 'PENDING') then 'processing'
  else coalesce(lower(status::text), 'processing')
end
where payout_status is null;

with matched_payments as (
  select
    s.id as settlement_id,
    p.id as payment_id,
    coalesce(nullif(p.payment_type, ''), 'booking') as payment_type,
    row_number() over (
      partition by s.id
      order by abs(extract(epoch from (coalesce(s.created_at, timezone('utc', now())) - coalesce(p.verified_at, p.payment_date, p.created_at, timezone('utc', now()))))) asc
    ) as rn
  from public.settlements s
  join public.payments p
    on p.booking_id = s.booking_id
)
update public.settlements s
set
  payment_id = mp.payment_id,
  payment_type = coalesce(s.payment_type, mp.payment_type)
from matched_payments mp
where s.id = mp.settlement_id
  and mp.rn = 1
  and (s.payment_id is null or s.payment_type is null);

update public.settlements
set payment_type = coalesce(nullif(payment_type, ''), 'booking')
where payment_type is null or payment_type = '';

notify pgrst, 'reload schema';

commit;
