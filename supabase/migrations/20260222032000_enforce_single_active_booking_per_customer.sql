-- Enforce one active booking per customer at a time.
-- A booking is considered active when vacate_date is NULL and status is non-terminal.

CREATE OR REPLACE FUNCTION public.enforce_single_active_booking_per_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_conflicting_booking_id UUID;
BEGIN
    IF NEW.customer_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_status := lower(coalesce(NEW.status::text, ''));

    IF NEW.vacate_date IS NOT NULL
       OR v_status IN (
            'cancelled',
            'cancelled_by_customer',
            'cancelled-by-customer',
            'rejected',
            'refunded',
            'checked-out',
            'checked_out',
            'vacated',
            'completed',
            'expired',
            'ended',
            'inactive'
       ) THEN
        RETURN NEW;
    END IF;

    -- Serialize booking writes per customer to prevent concurrent double bookings.
    PERFORM pg_advisory_xact_lock(9201, hashtext(NEW.customer_id::text));

    SELECT b.id
      INTO v_conflicting_booking_id
      FROM public.bookings b
     WHERE b.customer_id = NEW.customer_id
       AND b.id IS DISTINCT FROM NEW.id
       AND b.vacate_date IS NULL
       AND lower(coalesce(b.status::text, '')) NOT IN (
            'cancelled',
            'cancelled_by_customer',
            'cancelled-by-customer',
            'rejected',
            'refunded',
            'checked-out',
            'checked_out',
            'vacated',
            'completed',
            'expired',
            'ended',
            'inactive'
       )
     ORDER BY b.created_at DESC
     LIMIT 1;

    IF v_conflicting_booking_id IS NOT NULL THEN
        RAISE EXCEPTION
            'ACTIVE_PG_BOOKING_EXISTS: You already have an active booking. Please vacate your current PG before booking another one.'
            USING ERRCODE = 'P0001',
                  DETAIL = format('conflicting_booking_id=%s', v_conflicting_booking_id),
                  HINT = 'Only one active booking is allowed per customer at a time.';
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_single_active_booking_per_customer ON public.bookings;
CREATE TRIGGER trg_enforce_single_active_booking_per_customer
BEFORE INSERT OR UPDATE OF customer_id, status, vacate_date
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_active_booking_per_customer();
CREATE INDEX IF NOT EXISTS idx_bookings_customer_active_lookup
    ON public.bookings(customer_id, created_at DESC)
    WHERE vacate_date IS NULL;
