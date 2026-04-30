BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'booking_status_enum'
  ) THEN
    BEGIN
      ALTER TYPE public.booking_status_enum ADD VALUE IF NOT EXISTS 'payment_failed';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;

ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
ADD CONSTRAINT bookings_status_check
CHECK (
  lower(COALESCE(status::text, '')) IN (
    'pending',
    'requested',
    'accepted',
    'approved',
    'confirmed',
    'rejected',
    'cancelled',
    'cancelled_by_customer',
    'checked-in',
    'checked_in',
    'checked-out',
    'checked_out',
    'completed',
    'paid',
    'vacate_requested',
    'active',
    'ongoing',
    'booked',
    'vacated',
    'payment_pending',
    'payment_failed',
    'refunded'
  )
) NOT VALID;

ALTER TABLE public.bookings
VALIDATE CONSTRAINT bookings_status_check;

COMMIT;
