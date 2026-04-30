begin;

alter table public.settlements
  drop constraint if exists unique_settlement_per_booking;

drop index if exists public.unique_settlement_per_booking;
drop index if exists public.idx_settlements_booking_id;

create index if not exists idx_settlements_booking_id
  on public.settlements(booking_id);

create unique index if not exists settlements_payment_id_unique
  on public.settlements(payment_id)
  where payment_id is not null;

create unique index if not exists settlements_legacy_booking_id_unique
  on public.settlements(booking_id)
  where booking_id is not null and payment_id is null;

notify pgrst, 'reload schema';

commit;
