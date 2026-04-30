BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS room_gst NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (room_gst >= 0),
  ADD COLUMN IF NOT EXISTS room_gst_rate NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (room_gst_rate >= 0 AND room_gst_rate <= 1),
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  ADD COLUMN IF NOT EXISTS platform_gst NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (platform_gst >= 0),
  ADD COLUMN IF NOT EXISTS platform_gst_rate NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (platform_gst_rate >= 0 AND platform_gst_rate <= 1),
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
  ADD COLUMN IF NOT EXISTS tcs_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tcs_amount >= 0),
  ADD COLUMN IF NOT EXISTS gst_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS place_of_supply_type TEXT NOT NULL DEFAULT 'unknown' CHECK (place_of_supply_type IN ('cgst_sgst', 'igst', 'unknown')),
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';

UPDATE public.bookings
SET
  total_amount = CASE
    WHEN COALESCE(total_amount, 0) > 0 THEN total_amount
    ELSE COALESCE(amount_paid, amount_due, advance_paid, monthly_rent, 0)
  END,
  currency = COALESCE(NULLIF(currency, ''), 'INR'),
  gst_breakdown = COALESCE(gst_breakdown, '{}'::jsonb),
  place_of_supply_type = COALESCE(NULLIF(place_of_supply_type, ''), 'unknown')
WHERE
  total_amount IS NULL
  OR currency IS NULL
  OR currency = ''
  OR gst_breakdown IS NULL
  OR place_of_supply_type IS NULL
  OR place_of_supply_type = '';

NOTIFY pgrst, 'reload schema';

COMMIT;
