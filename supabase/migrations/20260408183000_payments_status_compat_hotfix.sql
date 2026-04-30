BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_status TEXT;

UPDATE public.payments
SET payment_status = COALESCE(NULLIF(payment_status, ''), status::text, 'pending')
WHERE payment_status IS NULL OR payment_status = '';

CREATE OR REPLACE FUNCTION public.sync_payment_status_aliases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.status::text, '') = '' THEN
    NEW.status := COALESCE(NULLIF(NEW.payment_status, ''), 'pending')::public.payment_status_enum;
  END IF;

  IF COALESCE(NEW.payment_status, '') = '' THEN
    NEW.payment_status := COALESCE(NULLIF(NEW.status::text, ''), 'pending');
  END IF;

  NEW.status := lower(NEW.status::text)::public.payment_status_enum;
  NEW.payment_status := lower(NEW.payment_status);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_sync_aliases ON public.payments;
DROP TRIGGER IF EXISTS trg_payments_sync_columns ON public.payments;

CREATE TRIGGER trg_payments_sync_columns
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_payment_status_aliases();

CREATE INDEX IF NOT EXISTS idx_payments_payment_status
  ON public.payments(payment_status);

COMMIT;
