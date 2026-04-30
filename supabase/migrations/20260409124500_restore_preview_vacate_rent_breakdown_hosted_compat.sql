BEGIN;

CREATE OR REPLACE FUNCTION public.preview_vacate_rent_breakdown(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_booking RECORD;
    v_today DATE := timezone('utc', now())::date;
    v_cycle_start DATE;
    v_next_due DATE;
    v_total_days INTEGER := 30;
    v_days_used INTEGER := 0;
    v_remaining_days INTEGER := 0;
    v_monthly_rent NUMERIC(10, 2) := 0;
    v_remaining_amount NUMERIC(10, 2) := 0;
BEGIN
    SELECT
        b.id,
        b.customer_id,
        b.owner_id,
        b.start_date,
        b.current_cycle_start_date,
        b.next_due_date,
        b.cycle_duration_days,
        b.monthly_rent,
        b.vacate_date
    INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF auth.uid() IS NOT NULL
       AND NOT public.is_admin(auth.uid())
       AND v_booking.customer_id <> auth.uid()
       AND v_booking.owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_cycle_start := COALESCE(v_booking.current_cycle_start_date, v_booking.start_date);
    v_next_due := v_booking.next_due_date;
    v_total_days := GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30));
    v_monthly_rent := GREATEST(0, COALESCE(v_booking.monthly_rent, 0));

    IF v_booking.vacate_date IS NOT NULL THEN
        v_days_used := v_total_days;
    ELSIF v_cycle_start IS NULL OR v_next_due IS NULL THEN
        v_days_used := 0;
    ELSIF v_today < v_cycle_start THEN
        v_days_used := 0;
    ELSIF v_today >= v_next_due THEN
        v_days_used := v_total_days;
    ELSE
        v_days_used := LEAST(v_total_days, GREATEST(0, (v_today - v_cycle_start) + 1));
    END IF;

    v_remaining_days := GREATEST(0, v_total_days - v_days_used);
    IF v_monthly_rent > 0 AND v_remaining_days > 0 THEN
        v_remaining_amount := ROUND((v_monthly_rent / v_total_days::numeric) * v_remaining_days, 2);
    END IF;

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'cycle_start_date', v_cycle_start,
        'cycle_end_date', v_next_due,
        'next_due_date', v_next_due,
        'total_rent_paid', v_monthly_rent,
        'total_days_in_cycle', v_total_days,
        'days_used', v_days_used,
        'remaining_days', v_remaining_days,
        'remaining_rent_value', v_remaining_amount,
        'reversal_policy', 'Not reversible via app',
        'refund_policy', 'Not refundable via app',
        'server_date', v_today
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_vacate_rent_breakdown(UUID) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
