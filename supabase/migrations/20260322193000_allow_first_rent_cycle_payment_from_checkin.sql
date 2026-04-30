BEGIN;

CREATE OR REPLACE FUNCTION public.get_booking_rent_cycle(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_today DATE := timezone('utc', now())::date;
    v_cycle_end DATE;
    v_status TEXT;
    v_can_pay BOOLEAN := FALSE;
    v_message TEXT := '';
    v_is_closed BOOLEAN := FALSE;
    v_has_verified_monthly_payment BOOLEAN := FALSE;
BEGIN
    v_booking := public.ensure_booking_rent_cycle_state(p_booking_id);

    IF auth.uid() IS NOT NULL
       AND NOT public.is_admin(auth.uid())
       AND v_booking.customer_id <> auth.uid()
       AND v_booking.owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_is_closed := public.is_booking_rent_cycle_closed(
        v_booking.status::text,
        v_booking.stay_status,
        v_booking.booking_status,
        v_booking.continue_status,
        v_booking.vacate_date,
        v_booking.rent_cycle_closed_at
    );

    v_cycle_end := COALESCE(
        v_booking.next_due_date,
        v_booking.current_cycle_start_date + GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30))
    );

    SELECT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.booking_id = v_booking.id
          AND lower(COALESCE(p.payment_type, '')) IN ('monthly', 'rent')
          AND lower(COALESCE(p.payment_status, p.status, '')) IN ('paid', 'completed', 'success', 'authorized')
    )
    INTO v_has_verified_monthly_payment;

    IF v_is_closed THEN
        v_status := 'closed';
        v_can_pay := FALSE;
        v_message := 'Rent cycle is closed.';
    ELSIF v_today > v_cycle_end THEN
        v_status := 'overdue';
        v_can_pay := TRUE;
        v_message := format(
            'This rent cycle is overdue since %s. Complete payment now to keep the next cycle in sync.',
            to_char(v_cycle_end, 'DD Mon YYYY')
        );
    ELSIF v_today = v_cycle_end THEN
        v_status := 'due';
        v_can_pay := TRUE;
        v_message := format(
            'Rent payment is due today for the cycle ending %s.',
            to_char(v_cycle_end, 'DD Mon YYYY')
        );
    ELSIF NOT v_has_verified_monthly_payment THEN
        v_status := 'due';
        v_can_pay := TRUE;
        v_message := format(
            'Your first rent cycle started on %s. You can pay this cycle now, and the next due date will move automatically after verification.',
            to_char(v_booking.current_cycle_start_date, 'DD Mon YYYY')
        );
    ELSE
        v_status := 'active';
        v_can_pay := FALSE;
        v_message := format(
            'Your current rent cycle is active until %s.',
            to_char(v_cycle_end, 'DD Mon YYYY')
        );
    END IF;

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'current_cycle_start_date', v_booking.current_cycle_start_date,
        'cycle_end_date', v_cycle_end,
        'next_due_date', v_booking.next_due_date,
        'cycle_duration_days', v_booking.cycle_duration_days,
        'server_date', v_today,
        'status', v_status,
        'can_pay_rent', v_can_pay,
        'message', v_message
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_rent_cycle_on_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_payment public.payments%ROWTYPE;
    v_booking public.bookings%ROWTYPE;
    v_today DATE := timezone('utc', now())::date;
    v_cycle_start DATE;
    v_next_due DATE;
    v_cycle_end DATE;
    v_new_start DATE;
    v_new_next_due DATE;
    v_already_advanced BOOLEAN := FALSE;
    v_has_prior_verified_monthly_payment BOOLEAN := FALSE;
BEGIN
    SELECT *
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
    END IF;

    IF lower(COALESCE(v_payment.payment_type, '')) NOT IN ('rent', 'monthly') THEN
        RAISE EXCEPTION 'PAYMENT_TYPE_NOT_RENT';
    END IF;

    IF lower(COALESCE(v_payment.payment_status, v_payment.status, '')) NOT IN ('paid', 'completed', 'success', 'authorized') THEN
        RAISE EXCEPTION 'RENT_PAYMENT_NOT_SETTLED';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_booking := public.ensure_booking_rent_cycle_state(v_payment.booking_id);

    SELECT *
    INTO v_booking
    FROM public.bookings
    WHERE id = v_payment.booking_id
    FOR UPDATE;

    v_already_advanced := lower(COALESCE(v_payment.metadata->>'cycle_advanced', 'false')) IN ('true', '1', 'yes');
    IF v_already_advanced THEN
        RETURN jsonb_build_object(
            'advanced', FALSE,
            'reason', 'already_advanced',
            'booking_id', v_booking.id,
            'payment_id', v_payment.id,
            'next_due_date', v_booking.next_due_date
        );
    END IF;

    IF v_booking.rent_cycle_closed_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'advanced', FALSE,
            'reason', 'cycle_closed',
            'booking_id', v_booking.id,
            'payment_id', v_payment.id
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.booking_id = v_payment.booking_id
          AND p.id <> v_payment.id
          AND lower(COALESCE(p.payment_type, '')) IN ('monthly', 'rent')
          AND lower(COALESCE(p.payment_status, p.status, '')) IN ('paid', 'completed', 'success', 'authorized')
    )
    INTO v_has_prior_verified_monthly_payment;

    IF v_today < v_booking.next_due_date AND v_has_prior_verified_monthly_payment THEN
        RAISE EXCEPTION 'RENT_CYCLE_NOT_DUE';
    END IF;

    v_cycle_start := v_booking.current_cycle_start_date;
    v_next_due := v_booking.next_due_date;
    v_cycle_end := v_next_due;
    v_new_start := v_next_due;
    v_new_next_due := v_new_start + v_booking.cycle_duration_days;

    UPDATE public.bookings
    SET current_cycle_start_date = v_new_start,
        next_due_date = v_new_next_due,
        rent_payment_status = CASE
            WHEN v_new_next_due > v_today THEN 'not_due'
            ELSE 'paid'
        END,
        updated_at = timezone('utc', now())
    WHERE id = v_booking.id;

    UPDATE public.payments
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'cycle_covered_from', v_cycle_start::text,
            'cycle_covered_to', v_cycle_end::text,
            'cycle_start_date', v_cycle_start::text,
            'cycle_end_date', v_cycle_end::text,
            'cycle_duration_days', v_booking.cycle_duration_days,
            'next_due_date', v_next_due::text,
            'cycle_advanced', true,
            'cycle_advanced_at', timezone('utc', now()),
            'cycle_next_due_date', v_new_next_due::text
        ),
        updated_at = timezone('utc', now())
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
        'advanced', TRUE,
        'booking_id', v_booking.id,
        'payment_id', v_payment.id,
        'cycle_covered_from', v_cycle_start,
        'cycle_covered_to', v_cycle_end,
        'new_cycle_start_date', v_new_start,
        'new_next_due_date', v_new_next_due
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_rent_cycle(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_rent_cycle_on_payment(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
