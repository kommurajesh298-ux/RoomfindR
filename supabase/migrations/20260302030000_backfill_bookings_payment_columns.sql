BEGIN;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS charge_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS advance_charge_status TEXT,
  ADD COLUMN IF NOT EXISTS rent_charge_status TEXT;
ALTER TABLE public.bookings
  ALTER COLUMN payment_status SET DEFAULT 'pending',
  ALTER COLUMN charge_status SET DEFAULT 'pending';
UPDATE public.bookings
SET payment_status = 'pending'
WHERE payment_status IS NULL OR btrim(payment_status) = '';
UPDATE public.bookings
SET charge_status = 'pending'
WHERE charge_status IS NULL OR btrim(charge_status) = '';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'advance_payment_status'
  ) THEN
    EXECUTE '
      UPDATE public.bookings
      SET advance_charge_status = COALESCE(advance_charge_status, advance_payment_status)
      WHERE advance_charge_status IS NULL
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'rent_payment_status'
  ) THEN
    EXECUTE '
      UPDATE public.bookings
      SET rent_charge_status = COALESCE(rent_charge_status, rent_payment_status)
      WHERE rent_charge_status IS NULL
    ';
  END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
