begin;

with recomputed_balances as (
  select
    w.id as wallet_id,
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
  from public.wallets w
  left join public.wallet_transactions wt
    on wt.wallet_id = w.id
  group by w.id
)
update public.wallets w
set
  available_balance = rb.available_balance,
  pending_balance = rb.pending_balance,
  updated_at = now()
from recomputed_balances rb
where w.id = rb.wallet_id
  and (
    coalesce(w.available_balance, 0) <> rb.available_balance
    or coalesce(w.pending_balance, 0) <> rb.pending_balance
  );

notify pgrst, 'reload schema';

commit;
