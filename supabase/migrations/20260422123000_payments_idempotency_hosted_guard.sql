BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key_unique
  ON public.payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
