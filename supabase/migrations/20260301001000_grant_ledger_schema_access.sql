BEGIN;
-- Ensure app roles can resolve and execute ledger schema objects in webhook/payment flows.
GRANT USAGE ON SCHEMA ledger TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA ledger
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ledger.record_payment_success(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ledger.record_payout_success(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ledger.record_refund_success(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ledger.validate_journal_balance() TO authenticated, service_role;
COMMIT;
