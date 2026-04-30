-- Move wallet orphan-cleanup rows out of transaction_logs (which is settlement/refund oriented)
-- and into audit_logs, then remove them from transaction_logs to avoid misleading NULL links.

BEGIN;
DO $$
BEGIN
    IF to_regclass('public.transaction_logs') IS NULL OR to_regclass('public.audit_logs') IS NULL THEN
        RAISE NOTICE 'transaction_logs or audit_logs table missing; skipping migration.';
        RETURN;
    END IF;
END $$;
INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    created_at
)
SELECT
    tl.created_by,
    'wallet_txn_orphan_cleanup',
    'wallet_transaction',
    tl.entity_id,
    jsonb_build_object(
        'message', COALESCE(tl.message, 'Removed orphan wallet transaction with no payment_id/settlement_id'),
        'owner_id', tl.owner_id,
        'transaction_log_id', tl.id,
        'status', tl.status,
        'payload', COALESCE(tl.payload, '{}'::jsonb)
    ),
    COALESCE(tl.created_at, NOW())
FROM public.transaction_logs tl
WHERE lower(coalesce(tl.entity_type, '')) = 'wallet_transaction'
  AND lower(coalesce(tl.event_type, '')) = 'wallet_txn_orphan_cleanup'
  AND tl.settlement_id IS NULL
  AND tl.refund_id IS NULL;
DELETE FROM public.transaction_logs tl
WHERE lower(coalesce(tl.entity_type, '')) = 'wallet_transaction'
  AND lower(coalesce(tl.event_type, '')) = 'wallet_txn_orphan_cleanup'
  AND tl.settlement_id IS NULL
  AND tl.refund_id IS NULL;
ALTER TABLE public.transaction_logs
    DROP CONSTRAINT IF EXISTS transaction_logs_wallet_orphan_cleanup_scope_chk;
ALTER TABLE public.transaction_logs
    ADD CONSTRAINT transaction_logs_wallet_orphan_cleanup_scope_chk
    CHECK (
        lower(coalesce(event_type, '')) <> 'wallet_txn_orphan_cleanup'
        OR settlement_id IS NOT NULL
        OR refund_id IS NOT NULL
    );
COMMIT;
