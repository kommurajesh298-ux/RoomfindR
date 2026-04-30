BEGIN;
CREATE OR REPLACE FUNCTION public.preview_vacate_rent_breakdown(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_today DATE := timezone('utc', now())::date;
    v_total_rent_paid NUMERIC(10, 2) := 0;
    v_total_days INTEGER := 30;
    v_days_used INTEGER := 0;
    v_remaining_days INTEGER := 0;
    v_remaining_amount NUMERIC(10, 2) := 0;
    v_cycle_start DATE;
    v_next_due DATE;
    v_is_closed BOOLEAN := FALSE;
    v_is_full_cycle_prepaid BOOLEAN := FALSE;
    v_last_rent_amount NUMERIC(10, 2);
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

    -- payments table was removed from the live stack; use transactions as the paid-rent source.
    SELECT t.amount
    INTO v_last_rent_amount
    FROM public.transactions t
    WHERE t.booking_id = p_booking_id
      AND lower(COALESCE(t.charge_type, t.metadata->>'charge_type', '')) IN ('rent', 'monthly', 'monthly_rent')
      AND (
          t.paid_at IS NOT NULL
          OR lower(COALESCE(t.metadata->>'payment_status', '')) IN (
              'paid',
              'completed',
              'success',
              'authorized',
              'paid_pending_owner_acceptance'
          )
      )
    ORDER BY COALESCE(t.paid_at, t.created_at) DESC
    LIMIT 1;

    v_total_days := GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30));
    v_cycle_start := v_booking.current_cycle_start_date;
    v_next_due := v_booking.next_due_date;

    IF v_last_rent_amount IS NOT NULL THEN
        v_total_rent_paid := GREATEST(0, COALESCE(v_last_rent_amount, 0));
    ELSE
        v_is_full_cycle_prepaid := lower(COALESCE(v_booking.payment_type, '')) = 'full'
            AND (
                lower(COALESCE(v_booking.payment_status::text, '')) IN (
                    'paid',
                    'completed',
                    'success',
                    'authorized',
                    'paid_pending_owner_acceptance'
                )
                OR lower(COALESCE(v_booking.advance_payment_status, '')) IN (
                    'paid',
                    'completed',
                    'success',
                    'authorized',
                    'paid_pending_owner_acceptance'
                )
            );

        IF v_is_full_cycle_prepaid THEN
            v_total_rent_paid := GREATEST(0, COALESCE(v_booking.monthly_rent, 0));
        ELSE
            v_total_rent_paid := 0;
        END IF;
    END IF;

    IF v_is_closed THEN
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
    IF v_total_rent_paid <= 0 OR v_remaining_days = 0 THEN
        v_remaining_amount := 0;
    ELSE
        v_remaining_amount := ROUND((v_total_rent_paid / v_total_days::numeric) * v_remaining_days, 2);
    END IF;

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'cycle_start_date', v_cycle_start,
        'cycle_end_date', v_next_due,
        'next_due_date', v_next_due,
        'total_rent_paid', v_total_rent_paid,
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
