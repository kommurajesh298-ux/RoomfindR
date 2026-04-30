-- Drop legacy helper functions that still reference removed settlement/refund tables.
BEGIN;
DO $$
DECLARE
    fn regprocedure;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'ensure_wallet_transaction',
              'apply_payment_success',
              'resolve_wallet_txn_payment_id',
              'refresh_owner_monthly_summary'
          )
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', fn);
    END LOOP;
END;
$$;
COMMIT;
