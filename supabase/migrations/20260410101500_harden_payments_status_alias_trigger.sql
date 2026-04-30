BEGIN;

CREATE OR REPLACE FUNCTION public.sync_payment_status_aliases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status_text TEXT := lower(COALESCE(NEW.status::text, ''));
  v_payment_status_text TEXT := lower(COALESCE(NEW.payment_status::text, ''));
BEGIN
  IF v_status_text = '' THEN
    v_status_text := v_payment_status_text;
  END IF;

  IF v_payment_status_text = '' THEN
    v_payment_status_text := v_status_text;
  END IF;

  IF v_status_text = 'paid' THEN
    v_status_text := 'completed';
  END IF;

  IF v_payment_status_text = 'paid' THEN
    v_payment_status_text := 'completed';
  END IF;

  IF v_status_text NOT IN (
    'created', 'pending', 'authorized', 'success',
    'completed', 'failed', 'cancelled', 'refunded'
  ) THEN
    v_status_text := 'pending';
  END IF;

  IF v_payment_status_text NOT IN (
    'created', 'pending', 'authorized', 'success',
    'completed', 'failed', 'cancelled', 'refunded'
  ) THEN
    v_payment_status_text := v_status_text;
  END IF;

  NEW.status := v_status_text::public.payment_status_enum;
  NEW.payment_status := v_payment_status_text;

  RETURN NEW;
END;
$$;

UPDATE public.payments
SET
  status = CASE
    WHEN lower(COALESCE(status::text, '')) = 'paid' THEN 'completed'::public.payment_status_enum
    ELSE status
  END,
  payment_status = CASE
    WHEN lower(COALESCE(payment_status::text, '')) = 'paid' THEN 'completed'
    ELSE payment_status
  END
WHERE
  lower(COALESCE(status::text, '')) = 'paid'
  OR lower(COALESCE(payment_status::text, '')) = 'paid';

COMMIT;

NOTIFY pgrst, 'reload schema';
