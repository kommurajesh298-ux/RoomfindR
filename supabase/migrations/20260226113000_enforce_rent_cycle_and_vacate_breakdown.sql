BEGIN;
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS current_cycle_start_date DATE,
    ADD COLUMN IF NOT EXISTS next_due_date DATE,
    ADD COLUMN IF NOT EXISTS cycle_duration_days INTEGER,
    ADD COLUMN IF NOT EXISTS rent_cycle_closed_at TIMESTAMPTZ;
UPDATE public.bookings
SET cycle_duration_days = 30
WHERE cycle_duration_days IS NULL OR cycle_duration_days <= 0;
ALTER TABLE public.bookings
    ALTER COLUMN cycle_duration_days SET DEFAULT 30,
    ALTER COLUMN cycle_duration_days SET NOT NULL;
ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_cycle_duration_days_positive;
ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_cycle_duration_days_positive
    CHECK (cycle_duration_days > 0);
UPDATE public.bookings
SET current_cycle_start_date = COALESCE(
    current_cycle_start_date,
    check_in_date,
    start_date,
    (created_at AT TIME ZONE 'utc')::date,
    timezone('utc', now())::date
)
WHERE current_cycle_start_date IS NULL;
UPDATE public.bookings
SET next_due_date = COALESCE(
    next_due_date,
    current_cycle_start_date + cycle_duration_days
)
WHERE next_due_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_current_cycle_start_date
    ON public.bookings(current_cycle_start_date);
CREATE INDEX IF NOT EXISTS idx_bookings_next_due_date
    ON public.bookings(next_due_date);
CREATE INDEX IF NOT EXISTS idx_bookings_rent_cycle_closed_at
    ON public.bookings(rent_cycle_closed_at);
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
        v_booking.current_cycle_start_date,
        v_booking.check_in_date,
        v_booking.start_date,
        timezone('utc', now())::date
    );
    v_next_due := COALESCE(v_booking.next_due_date, v_cycle_start + v_cycle_duration);

    IF v_booking.cycle_duration_days IS DISTINCT FROM v_cycle_duration
       OR v_booking.current_cycle_start_date IS DISTINCT FROM v_cycle_start
       OR v_booking.next_due_date IS DISTINCT FROM v_next_due THEN
        UPDATE public.bookings
        SET cycle_duration_days = v_cycle_duration,
            current_cycle_start_date = v_cycle_start,
            next_due_date = v_next_due,
            updated_at = timezone('utc', now())
        WHERE id = p_booking_id
        RETURNING * INTO v_booking;
    END IF;

    RETURN v_booking;
END;
$$;
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
BEGIN
    v_booking := public.ensure_booking_rent_cycle_state(p_booking_id);

    IF auth.uid() IS NOT NULL
       AND NOT public.is_admin(auth.uid())
       AND v_booking.customer_id <> auth.uid()
       AND v_booking.owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_is_closed := v_booking.rent_cycle_closed_at IS NOT NULL
        OR lower(COALESCE(v_booking.stay_status, '')) = 'vacated'
        OR lower(COALESCE(v_booking.status::text, '')) IN ('checked-out', 'checked_out', 'completed', 'vacated');

    v_cycle_end := v_booking.next_due_date;

    IF v_is_closed THEN
        v_status := 'closed';
        v_can_pay := FALSE;
        v_message := 'Rent cycle is closed.';
    ELSIF v_today > v_booking.next_due_date THEN
        v_status := 'overdue';
        v_can_pay := TRUE;
    ELSIF v_today = v_booking.next_due_date THEN
        v_status := 'due';
        v_can_pay := TRUE;
    ELSE
        v_status := 'active';
        v_can_pay := FALSE;
        v_message := format(
            'Your current rent cycle is active until %s.',
            to_char(v_booking.next_due_date, 'DD Mon YYYY')
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
BEGIN
    SELECT *
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
    END IF;

    IF lower(COALESCE(v_payment.payment_type, '')) <> 'rent' THEN
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

    IF v_today < v_booking.next_due_date THEN
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
        rent_payment_status = 'paid',
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
CREATE OR REPLACE FUNCTION public.preview_vacate_rent_breakdown(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_last_rent_payment public.payments%ROWTYPE;
    v_today DATE := timezone('utc', now())::date;
    v_total_rent_paid NUMERIC(10, 2) := 0;
    v_total_days INTEGER := 30;
    v_days_used INTEGER := 0;
    v_remaining_days INTEGER := 0;
    v_remaining_amount NUMERIC(10, 2) := 0;
    v_cycle_start DATE;
    v_next_due DATE;
BEGIN
    v_booking := public.ensure_booking_rent_cycle_state(p_booking_id);

    IF auth.uid() IS NOT NULL
       AND NOT public.is_admin(auth.uid())
       AND v_booking.customer_id <> auth.uid()
       AND v_booking.owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    SELECT *
    INTO v_last_rent_payment
    FROM public.payments
    WHERE booking_id = p_booking_id
      AND lower(COALESCE(payment_type, '')) = 'rent'
      AND lower(COALESCE(payment_status, status, '')) IN ('paid', 'completed', 'success', 'authorized')
    ORDER BY created_at DESC
    LIMIT 1;

    v_total_rent_paid := COALESCE(v_last_rent_payment.amount, v_booking.monthly_rent, 0);
    v_total_days := GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30));
    v_cycle_start := v_booking.current_cycle_start_date;
    v_next_due := v_booking.next_due_date;

    IF v_cycle_start IS NULL OR v_next_due IS NULL THEN
        v_days_used := 0;
    ELSIF v_today < v_cycle_start THEN
        v_days_used := 0;
    ELSIF v_today >= v_next_due THEN
        v_days_used := v_total_days;
    ELSE
        v_days_used := LEAST(v_total_days, GREATEST(0, (v_today - v_cycle_start) + 1));
    END IF;

    v_remaining_days := GREATEST(0, v_total_days - v_days_used);
    v_remaining_amount := ROUND((v_total_rent_paid / v_total_days::numeric) * v_remaining_days, 2);

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
        'refund_policy', 'Not refundable via app',
        'server_date', v_today
    );
END;
$$;
CREATE OR REPLACE FUNCTION public.customer_request_vacate(
    p_booking_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off AS $$
DECLARE
  v_owner_id UUID;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_breakdown JSONB;
BEGIN
  SELECT owner_id, customer_id, customer_name
    INTO v_owner_id, v_customer_id, v_customer_name
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR v_customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_breakdown := public.preview_vacate_rent_breakdown(p_booking_id);

  UPDATE public.bookings
  SET stay_status = 'vacate_requested',
      status = 'vacate_requested',
      rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
      updated_at = NOW()
  WHERE id = p_booking_id;

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_owner_id,
    'Vacate request',
    format('%s has requested to vacate. Approval required.', COALESCE(v_customer_name, 'A resident')),
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'type', 'vacate_request', 'rent_breakdown', v_breakdown),
    FALSE
  );

  RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'status', 'vacate_requested',
      'vacate_breakdown', v_breakdown
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_approve_vacate(
  p_booking_id UUID,
  p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off AS $$
DECLARE
  v_owner_id UUID;
  v_customer_id UUID;
BEGIN
  SELECT owner_id, customer_id
    INTO v_owner_id, v_customer_id
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR v_owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.bookings
  SET status = 'checked-out',
      stay_status = 'vacated',
      vacate_date = CURRENT_DATE,
      portal_access = false,
      rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    PERFORM public.decrement_room_occupancy(p_room_id);
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Vacate Approved',
    'Your vacate request has been approved by the owner.',
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'checked-out'),
    FALSE
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'checked-out');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_check_out_booking(
  p_booking_id UUID,
  p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off AS $$
DECLARE
  v_owner_id UUID;
  v_customer_id UUID;
BEGIN
  SELECT owner_id, customer_id
    INTO v_owner_id, v_customer_id
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR v_owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.bookings
  SET status = 'checked-out',
      stay_status = 'vacated',
      vacate_date = CURRENT_DATE,
      portal_access = false,
      rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    PERFORM public.decrement_room_occupancy(p_room_id);
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Checked Out',
    'Your stay has been marked as checked out.',
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'checked-out'),
    FALSE
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'checked-out');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;
CREATE OR REPLACE FUNCTION public.exit_booking_stay(
    p_booking_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay_type TEXT;
BEGIN
  SELECT lower(COALESCE(stay_type, ''))
  INTO v_stay_type
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_stay_type = 'days' THEN
    UPDATE public.bookings
    SET status = 'checked-out',
        stay_status = 'vacated',
        vacate_date = CURRENT_DATE,
        booking_status = 'COMPLETED',
        continue_status = 'exit_completed',
        portal_access = false,
        rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
        updated_at = NOW()
    WHERE id = p_booking_id;
  ELSE
    UPDATE public.bookings
    SET booking_status = 'ENDING',
        continue_status = 'exit_requested',
        stay_status = 'vacate_requested',
        portal_access = true,
        rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_booking_rent_cycle_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_booking_rent_cycle_state(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_rent_cycle(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_rent_cycle_on_payment(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_vacate_rent_breakdown(UUID) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
