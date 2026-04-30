BEGIN;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS rent_cycle_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_source TEXT,
  ADD COLUMN IF NOT EXISTS webhook_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_event_id TEXT;
UPDATE public.payments
SET verification_source = CASE
    WHEN lower(coalesce(status, payment_status, '')) IN ('paid_pending_owner_acceptance', 'paid', 'completed', 'success', 'authorized') THEN 'webhook'
    ELSE 'system'
  END
WHERE verification_source IS NULL;
UPDATE public.payments
SET webhook_verified_at = COALESCE(updated_at, created_at, timezone('utc', now()))
WHERE webhook_verified_at IS NULL
  AND lower(coalesce(status, payment_status, '')) IN ('paid_pending_owner_acceptance', 'paid', 'completed', 'success', 'authorized');
UPDATE public.payments
SET rent_cycle_id = COALESCE(
  NULLIF(trim(rent_cycle_id), ''),
  NULLIF(trim((metadata->>'rent_cycle_id')), ''),
  NULLIF(trim((metadata->>'month_token')), ''),
  NULLIF(trim((metadata->>'month')), ''),
  NULLIF(trim(substr(coalesce(metadata->>'cycle_start_date', ''), 1, 7)), ''),
  to_char(coalesce(created_at, timezone('utc', now())), 'YYYY-MM')
)
WHERE payment_type = 'rent';
ALTER TABLE public.payments
  ALTER COLUMN verification_source SET DEFAULT 'system',
  ALTER COLUMN verification_source SET NOT NULL;
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_verification_source_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_verification_source_check
  CHECK (verification_source IN ('webhook', 'system', 'admin'));
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_rent_cycle_required_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_rent_cycle_required_check
  CHECK (payment_type <> 'rent' OR (rent_cycle_id IS NOT NULL AND trim(rent_cycle_id) <> ''));
CREATE INDEX IF NOT EXISTS idx_payments_rent_cycle_id
  ON public.payments (rent_cycle_id)
  WHERE payment_type = 'rent' AND rent_cycle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_booking_rent_cycle_unique_active
  ON public.payments (booking_id, rent_cycle_id)
  WHERE payment_type = 'rent'
    AND rent_cycle_id IS NOT NULL
    AND lower(status) IN ('created', 'pending', 'processing', 'authorized', 'paid', 'completed', 'success');
CREATE OR REPLACE FUNCTION public.enforce_payment_success_requires_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_status TEXT := lower(coalesce(NEW.payment_status, NEW.status, 'pending'));
  v_old_status TEXT := lower(coalesce(OLD.payment_status, OLD.status, 'pending'));
  v_new_source TEXT := lower(coalesce(NEW.verification_source, 'system'));
BEGIN
  IF v_new_status IN ('paid_pending_owner_acceptance', 'paid', 'completed', 'success', 'authorized') THEN
    IF TG_OP = 'INSERT' OR v_old_status NOT IN ('paid_pending_owner_acceptance', 'paid', 'completed', 'success', 'authorized') THEN
      IF v_new_source <> 'webhook' THEN
        RAISE EXCEPTION 'PAYMENT_SUCCESS_REQUIRES_WEBHOOK_VERIFICATION';
      END IF;
      IF NEW.webhook_verified_at IS NULL THEN
        NEW.webhook_verified_at := timezone('utc', now());
      END IF;
    ELSIF NEW.webhook_verified_at IS NULL AND OLD.webhook_verified_at IS NOT NULL THEN
      NEW.webhook_verified_at := OLD.webhook_verified_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_payment_success_requires_webhook ON public.payments;
CREATE TRIGGER trg_enforce_payment_success_requires_webhook
BEFORE INSERT OR UPDATE OF status, payment_status, verification_source, webhook_verified_at
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_payment_success_requires_webhook();
NOTIFY pgrst, 'reload schema';
COMMIT;
