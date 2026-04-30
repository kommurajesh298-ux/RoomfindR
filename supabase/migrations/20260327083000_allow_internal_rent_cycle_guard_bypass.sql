BEGIN;

CREATE OR REPLACE FUNCTION public.guard_customer_booking_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_bypass_guard text := lower(COALESCE(current_setting('app.bypass_customer_booking_write_guard', true), ''));
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF v_bypass_guard IN ('1', 'true', 'on', 'yes') THEN
        RETURN NEW;
    END IF;

    IF v_actor IS NULL OR public.is_admin(v_actor) OR OLD.owner_id = v_actor THEN
        RETURN NEW;
    END IF;

    IF OLD.customer_id IS DISTINCT FROM v_actor THEN
        RETURN NEW;
    END IF;

    IF (
        to_jsonb(NEW) - ARRAY['status', 'stay_status', 'vacate_date', 'updated_at']::text[]
    ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['status', 'stay_status', 'vacate_date', 'updated_at']::text[]
    ) THEN
        RAISE EXCEPTION 'Customers cannot modify booking pricing, ownership, payment, or review fields directly'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'payment_pending'
       AND NEW.stay_status IS NOT DISTINCT FROM OLD.stay_status
       AND NEW.vacate_date IS NOT DISTINCT FROM OLD.vacate_date THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'vacate_requested'
       AND NEW.stay_status = 'vacate_requested'
       AND NEW.vacate_date IS NOT DISTINCT FROM OLD.vacate_date THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Customers cannot apply this booking state change directly'
        USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_booking_rent_cycle_state(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_cycle_duration INTEGER;
    v_cycle_start DATE;
    v_next_due DATE;
    v_is_closed BOOLEAN;
    v_closed_at TIMESTAMPTZ;
BEGIN
    SELECT *
    INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    v_cycle_duration := GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30));
    v_cycle_start := COALESCE(
        v_booking.check_in_date,
        v_booking.current_cycle_start_date,
        v_booking.start_date,
        timezone('utc', now())::date
    );
    v_is_closed := public.is_booking_rent_cycle_closed(
        v_booking.status::text,
        v_booking.stay_status,
        v_booking.booking_status,
        v_booking.continue_status,
        v_booking.vacate_date,
        v_booking.rent_cycle_closed_at
    );
    v_next_due := CASE
        WHEN v_is_closed THEN NULL
        ELSE COALESCE(v_booking.next_due_date, v_cycle_start + v_cycle_duration)
    END;
    v_closed_at := CASE
        WHEN v_is_closed THEN COALESCE(v_booking.rent_cycle_closed_at, timezone('utc', now()))
        ELSE NULL
    END;

    IF v_booking.cycle_duration_days IS DISTINCT FROM v_cycle_duration
       OR v_booking.current_cycle_start_date IS DISTINCT FROM v_cycle_start
       OR v_booking.next_due_date IS DISTINCT FROM v_next_due
       OR v_booking.rent_cycle_closed_at IS DISTINCT FROM v_closed_at THEN
        PERFORM set_config('app.bypass_customer_booking_write_guard', 'true', true);

        UPDATE public.bookings
        SET cycle_duration_days = v_cycle_duration,
            current_cycle_start_date = v_cycle_start,
            next_due_date = v_next_due,
            rent_cycle_closed_at = v_closed_at,
            updated_at = timezone('utc', now())
        WHERE id = p_booking_id
        RETURNING * INTO v_booking;
    END IF;

    RETURN v_booking;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
