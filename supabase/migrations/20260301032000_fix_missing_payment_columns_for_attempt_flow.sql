BEGIN;
-- Hotfix: ensure payments table has all columns required by start_payment_attempt_v3
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER,
  ADD COLUMN IF NOT EXISTS cf_order_id TEXT,
  ADD COLUMN IF NOT EXISTS cf_payment_session_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_state TEXT,
  ADD COLUMN IF NOT EXISTS last_provider_check_at TIMESTAMPTZ;
UPDATE public.payments
SET attempt_number = 1
WHERE attempt_number IS NULL OR attempt_number <= 0;
ALTER TABLE public.payments
  ALTER COLUMN attempt_number SET DEFAULT 1;
ALTER TABLE public.payments
  ALTER COLUMN attempt_number SET NOT NULL;
UPDATE public.payments
SET cf_order_id = COALESCE(
  NULLIF(trim(cf_order_id), ''),
  NULLIF(trim(cashfree_order_id), ''),
  NULLIF(trim(provider_order_id), ''),
  NULLIF(trim(order_id), '')
)
WHERE COALESCE(trim(cf_order_id), '') = '';
UPDATE public.payments
SET cf_payment_session_id = COALESCE(
  NULLIF(trim(cf_payment_session_id), ''),
  NULLIF(trim(provider_session_id), '')
)
WHERE COALESCE(trim(cf_payment_session_id), '') = '';
UPDATE public.payments
SET attempt_state = CASE
  WHEN lower(COALESCE(payment_status, status, '')) = 'created' THEN 'initiated'
  WHEN lower(COALESCE(payment_status, status, '')) IN ('pending', 'processing', 'authorized') THEN 'pending'
  WHEN lower(COALESCE(payment_status, status, '')) IN ('paid', 'completed', 'success', 'held', 'eligible', 'eligible_rejected', 'payout_pending', 'refunded') THEN 'success'
  WHEN lower(COALESCE(payment_status, status, '')) = 'cancelled' THEN 'cancelled'
  WHEN lower(COALESCE(payment_status, status, '')) IN ('expired', 'terminated') THEN 'expired'
  ELSE 'failed'
END
WHERE COALESCE(trim(attempt_state), '') = '';
ALTER TABLE public.payments
  ALTER COLUMN attempt_state SET DEFAULT 'initiated';
ALTER TABLE public.payments
  ALTER COLUMN attempt_state SET NOT NULL;
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_attempt_state_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_attempt_state_check
  CHECK (attempt_state IN ('initiated', 'pending', 'success', 'failed', 'cancelled', 'expired'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key_unique
  ON public.payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_cf_order_id_unique
  ON public.payments(cf_order_id)
  WHERE cf_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_attempt_state
  ON public.payments(attempt_state);
COMMIT;
