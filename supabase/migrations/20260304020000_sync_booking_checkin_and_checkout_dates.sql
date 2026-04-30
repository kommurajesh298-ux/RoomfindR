BEGIN;
-- 1) Backfill check-in date for existing rows.
UPDATE public.bookings
SET check_in_date = COALESCE(
    check_in_date,
    start_date,
    current_cycle_start_date,
    (created_at AT TIME ZONE 'utc')::date
)
WHERE check_in_date IS NULL;
-- 2) Backfill vacate_date only for already terminal/closed bookings.
--    Keep active bookings untouched (vacate_date stays NULL until real checkout).
UPDATE public.bookings
SET vacate_date = COALESCE(
    vacate_date,
    end_date,
    valid_till,
    check_in_date,
    start_date,
    (created_at AT TIME ZONE 'utc')::date
)
WHERE vacate_date IS NULL
  AND (
    lower(COALESCE(status::text, '')) IN (
      'vacated',
      'checked_out',
      'checked-out',
      'completed',
      'inactive',
      'cancelled',
      'rejected'
    )
    OR lower(COALESCE(booking_status::text, '')) IN (
      'vacated',
      'checked_out',
      'checked-out',
      'completed',
      'inactive',
      'cancelled',
      'rejected'
    )
    OR lower(COALESCE(stay_status::text, '')) IN (
      'vacated',
      'checked_out',
      'checked-out'
    )
  );
-- 3) Ensure new writes keep dates synchronized.
CREATE OR REPLACE FUNCTION public.sync_booking_checkin_and_checkout_dates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.start_date := COALESCE(
    NEW.start_date,
    NEW.check_in_date,
    NEW.current_cycle_start_date,
    (timezone('utc', now()))::date
  );

  NEW.check_in_date := COALESCE(
    NEW.check_in_date,
    NEW.start_date,
    NEW.current_cycle_start_date
  );

  NEW.end_date := COALESCE(
    NEW.end_date,
    NEW.valid_till
  );

  -- Set vacate_date automatically only when booking is terminal.
  IF NEW.vacate_date IS NULL AND (
    lower(COALESCE(NEW.status::text, '')) IN (
      'vacated',
      'checked_out',
      'checked-out',
      'completed',
      'inactive',
      'cancelled',
      'rejected'
    )
    OR lower(COALESCE(NEW.booking_status::text, '')) IN (
      'vacated',
      'checked_out',
      'checked-out',
      'completed',
      'inactive',
      'cancelled',
      'rejected'
    )
    OR lower(COALESCE(NEW.stay_status::text, '')) IN (
      'vacated',
      'checked_out',
      'checked-out'
    )
  ) THEN
    NEW.vacate_date := COALESCE(
      NEW.end_date,
      NEW.valid_till,
      NEW.check_in_date,
      NEW.start_date,
      (timezone('utc', now()))::date
    );
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_booking_checkin_and_checkout_dates ON public.bookings;
CREATE TRIGGER trg_sync_booking_checkin_and_checkout_dates
BEFORE INSERT OR UPDATE OF start_date, check_in_date, end_date, valid_till, current_cycle_start_date, status, booking_status, stay_status, vacate_date
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.sync_booking_checkin_and_checkout_dates();
NOTIFY pgrst, 'reload schema';
COMMIT;
