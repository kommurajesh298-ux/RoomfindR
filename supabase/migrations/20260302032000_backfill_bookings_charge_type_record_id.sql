BEGIN;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS charge_type TEXT DEFAULT 'advance',
  ADD COLUMN IF NOT EXISTS record_id TEXT;
UPDATE public.bookings
SET charge_type = 'advance'
WHERE charge_type IS NULL OR btrim(charge_type) = '';
NOTIFY pgrst, 'reload schema';
COMMIT;
