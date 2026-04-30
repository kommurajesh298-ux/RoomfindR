begin;

with deleted_orphans as (
  delete from public.wallet_transactions
  where settlement_id is null
    and payment_id is null
  returning wallet_id
),
affected_wallets as (
  select distinct wallet_id
  from deleted_orphans
),
recomputed_balances as (
  select
    aw.wallet_id,
    coalesce(
      sum(
        case
          when lower(coalesce(wt.status::text, '')) = 'completed'
            and lower(coalesce(wt.type::text, '')) = 'credit'
            then coalesce(wt.amount, 0)
          when lower(coalesce(wt.status::text, '')) = 'completed'
            and lower(coalesce(wt.type::text, '')) = 'debit'
            then -coalesce(wt.amount, 0)
          else 0
        end
      ),
      0
    ) as available_balance,
    coalesce(
      sum(
        case
          when lower(coalesce(wt.status::text, '')) = 'pending'
            and lower(coalesce(wt.type::text, '')) = 'credit'
            then coalesce(wt.amount, 0)
          when lower(coalesce(wt.status::text, '')) = 'pending'
            and lower(coalesce(wt.type::text, '')) = 'debit'
            then -coalesce(wt.amount, 0)
          else 0
        end
      ),
      0
    ) as pending_balance
  from affected_wallets aw
  left join public.wallet_transactions wt
    on wt.wallet_id = aw.wallet_id
  group by aw.wallet_id
)
update public.wallets w
set
  available_balance = rb.available_balance,
  pending_balance = rb.pending_balance,
  updated_at = now()
from recomputed_balances rb
where w.id = rb.wallet_id;

notify pgrst, 'reload schema';

commit;
