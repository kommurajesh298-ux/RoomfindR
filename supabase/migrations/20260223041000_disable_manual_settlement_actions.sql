BEGIN;
-- Enforce real-time Cashfree-only settlement lifecycle.
-- Manual admin settlement mutations are disabled.
DROP FUNCTION IF EXISTS public.admin_mark_settlement_paid(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_mark_settlement_failed(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_approve_settlement(UUID, UUID);
COMMIT;
