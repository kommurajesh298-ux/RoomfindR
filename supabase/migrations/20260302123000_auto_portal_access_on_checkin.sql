BEGIN;
CREATE OR REPLACE FUNCTION public.trg_bookings_auto_enable_portal_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT := lower(replace(coalesce(NEW.status::text, ''), '_', '-'));
  v_booking_status TEXT := lower(replace(coalesce(NEW.booking_status, ''), '_', '-'));
  v_stay_status TEXT := lower(replace(coalesce(NEW.stay_status, ''), '_', '-'));
  v_continue_status TEXT := lower(replace(coalesce(NEW.continue_status, ''), '_', '-'));
  v_is_terminal BOOLEAN := FALSE;
  v_is_live_checkin BOOLEAN := FALSE;
BEGIN
  v_is_terminal :=
    NEW.vacate_date IS NOT NULL
    OR NEW.rent_cycle_closed_at IS NOT NULL
    OR v_status IN (
      'checked-out',
      'vacated',
      'completed',
      'cancelled',
      'cancelled-by-customer',
      'rejected',
      'inactive',
      'expired',
      'failed',
      'payment-failed',
      'charge-failed',
      'refunded'
    )
    OR v_booking_status IN ('completed', 'cancelled', 'rejected', 'ended', 'expired', 'vacated', 'inactive')
    OR v_continue_status IN ('exit-completed', 'exited', 'ended', 'vacated', 'inactive', 'cancelled');

  v_is_live_checkin :=
    NEW.check_in_date IS NOT NULL
    AND (
      v_status IN ('checked-in', 'active', 'ongoing', 'vacate-requested', 'approved', 'accepted', 'confirmed')
      OR v_booking_status IN ('checked-in', 'active', 'ongoing', 'vacate-requested', 'approved', 'accepted', 'confirmed')
      OR v_stay_status IN ('ongoing', 'vacate-requested')
      OR v_continue_status IN ('active', 'ongoing', 'continued', 'exit-requested')
    );

  IF v_is_live_checkin AND NOT v_is_terminal THEN
    NEW.portal_access := TRUE;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bookings_auto_enable_portal_access ON public.bookings;
CREATE TRIGGER trg_bookings_auto_enable_portal_access
BEFORE INSERT OR UPDATE OF
  status,
  booking_status,
  stay_status,
  continue_status,
  check_in_date,
  vacate_date,
  rent_cycle_closed_at,
  portal_access
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trg_bookings_auto_enable_portal_access();
UPDATE public.bookings b
SET
  portal_access = TRUE,
  updated_at = NOW()
WHERE COALESCE(b.portal_access, FALSE) = FALSE
  AND b.check_in_date IS NOT NULL
  AND b.vacate_date IS NULL
  AND b.rent_cycle_closed_at IS NULL
  AND lower(replace(coalesce(b.status::text, ''), '_', '-')) NOT IN (
    'checked-out',
    'vacated',
    'completed',
    'cancelled',
    'cancelled-by-customer',
    'rejected',
    'inactive',
    'expired',
    'failed',
    'payment-failed',
    'charge-failed',
    'refunded'
  )
  AND lower(replace(coalesce(b.booking_status, ''), '_', '-')) NOT IN (
    'completed',
    'cancelled',
    'rejected',
    'ended',
    'expired',
    'vacated',
    'inactive'
  )
  AND lower(replace(coalesce(b.continue_status, ''), '_', '-')) NOT IN (
    'exit-completed',
    'exited',
    'ended',
    'vacated',
    'inactive',
    'cancelled'
  );
COMMIT;
