BEGIN;

CREATE OR REPLACE FUNCTION public.notification_amount_text(
    p_amount NUMERIC,
    p_currency TEXT DEFAULT 'INR'
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_amount NUMERIC := ROUND(COALESCE(p_amount, 0)::NUMERIC, 2);
    v_prefix TEXT := CASE
        WHEN upper(COALESCE(NULLIF(trim(p_currency), ''), 'INR')) = 'INR' THEN 'Rs'
        ELSE upper(COALESCE(NULLIF(trim(p_currency), ''), 'INR'))
    END;
BEGIN
    IF v_amount <= 0 THEN
        RETURN NULL;
    END IF;

    RETURN v_prefix || ' ' || regexp_replace(
        to_char(v_amount, 'FM999999999999990.00'),
        '\.?0+$',
        ''
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_room_text(
    p_room_number TEXT,
    p_fallback TEXT DEFAULT 'booking'
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF NULLIF(trim(COALESCE(p_room_number, '')), '') IS NULL THEN
        RETURN COALESCE(NULLIF(trim(p_fallback), ''), 'booking');
    END IF;

    RETURN 'Room ' || trim(p_room_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_person_text(
    p_name TEXT,
    p_fallback TEXT DEFAULT 'Customer'
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN COALESCE(NULLIF(trim(p_name), ''), COALESCE(NULLIF(trim(p_fallback), ''), 'Customer'));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_accept_booking(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off AS $$
DECLARE
  v_owner_id UUID;
  v_customer_id UUID;
  v_property_id UUID;
  v_status TEXT;
  v_payment_status TEXT;
  v_room_number TEXT;
  v_currency TEXT;
  v_advance_paid NUMERIC;
  v_amount_paid NUMERIC;
  v_status_lower TEXT;
  v_conflict_exists BOOLEAN;
  v_room_label TEXT;
  v_amount_text TEXT;
BEGIN
  SELECT owner_id, customer_id, property_id, status::text, payment_status::text, room_number, currency,
         COALESCE(advance_paid, 0), COALESCE(amount_paid, 0)
    INTO v_owner_id, v_customer_id, v_property_id, v_status, v_payment_status, v_room_number, v_currency,
         v_advance_paid, v_amount_paid
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR v_owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF lower(coalesce(v_payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_CONFIRMED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.customer_id = v_customer_id
      AND b.vacate_date IS NULL
      AND lower(coalesce(b.status::text, '')) IN ('checked-in','checked_in','active','ongoing','vacate_requested')
      AND b.property_id <> v_property_id
  ) INTO v_conflict_exists;

  IF v_conflict_exists THEN
    RAISE EXCEPTION 'STAY_CONFLICT';
  END IF;

  v_status_lower := lower(coalesce(v_status, ''));
  IF v_status_lower IN ('approved','accepted','checked-in','checked_in','active','ongoing','vacate_requested') THEN
    RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', v_status);
  END IF;
  IF v_status_lower IN ('rejected','cancelled','refunded','checked-out','checked_out','completed') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  UPDATE public.bookings
  SET status = 'approved',
      updated_at = NOW()
  WHERE id = p_booking_id;

  v_room_label := public.notification_room_text(v_room_number);
  v_amount_text := public.notification_amount_text(
    CASE WHEN v_advance_paid > 0 THEN v_advance_paid ELSE v_amount_paid END,
    COALESCE(v_currency, 'INR')
  );

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Booking approved',
    CASE
      WHEN v_amount_text IS NOT NULL THEN format('%s booking approved. Payment %s received.', v_room_label, v_amount_text)
      ELSE format('%s booking approved.', v_room_label)
    END,
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'approved'),
    FALSE
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'approved');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_reject_booking(
  p_booking_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off AS $$
DECLARE
  v_owner_id UUID;
  v_customer_id UUID;
  v_status TEXT;
  v_status_lower TEXT;
  v_reason TEXT;
  v_room_number TEXT;
  v_room_label TEXT;
BEGIN
  SELECT owner_id, customer_id, status::text, room_number
    INTO v_owner_id, v_customer_id, v_status, v_room_number
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR v_owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_status_lower := lower(coalesce(v_status, ''));
  IF v_status_lower IN ('rejected','cancelled','refunded') THEN
    RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', v_status);
  END IF;
  IF v_status_lower IN ('checked-out','checked_out','completed') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  v_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Booking rejected');

  UPDATE public.bookings
  SET status = 'rejected',
      rejection_reason = v_reason,
      updated_at = NOW()
  WHERE id = p_booking_id;

  v_room_label := public.notification_room_text(v_room_number);

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Booking rejected',
    format('%s booking rejected. Reason: %s.', v_room_label, v_reason),
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'rejected'),
    FALSE
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'rejected');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_check_in_booking(
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
  v_property_id UUID;
  v_check_in_date DATE;
  v_cycle_duration INTEGER;
  v_conflict_exists BOOLEAN;
  v_settlement_id UUID;
  v_settlement_status TEXT;
  v_settlement_amount NUMERIC;
  v_settlement_payment_type TEXT;
  v_room_number TEXT;
  v_customer_name TEXT;
  v_currency TEXT;
  v_room_label TEXT;
  v_payout_label TEXT;
  v_payout_context TEXT;
  v_payout_amount_text TEXT;
BEGIN
  SELECT owner_id, customer_id, property_id, check_in_date, COALESCE(cycle_duration_days, 30),
         room_number, customer_name, currency
    INTO v_owner_id, v_customer_id, v_property_id, v_check_in_date, v_cycle_duration,
         v_room_number, v_customer_name, v_currency
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR v_owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.customer_id = v_customer_id
      AND b.vacate_date IS NULL
      AND lower(coalesce(b.status::text, '')) IN ('checked-in','checked_in','active','ongoing','vacate_requested')
      AND b.property_id <> v_property_id
  ) INTO v_conflict_exists;

  IF v_conflict_exists THEN
    RAISE EXCEPTION 'STAY_CONFLICT';
  END IF;

  v_check_in_date := COALESCE(v_check_in_date, CURRENT_DATE);

  UPDATE public.bookings
  SET status = 'checked-in',
      stay_status = 'ongoing',
      check_in_date = v_check_in_date,
      current_cycle_start_date = v_check_in_date,
      next_due_date = v_check_in_date + GREATEST(1, COALESCE(v_cycle_duration, 30)),
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    PERFORM public.increment_room_occupancy(p_room_id);
  END IF;

  v_room_label := public.notification_room_text(v_room_number);

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Check-in confirmed',
    format('Check-in confirmed for %s.', v_room_label),
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'checked-in'),
    FALSE
  );

  SELECT s.id, s.status, COALESCE(s.net_payable, s.total_amount), s.payment_type
    INTO v_settlement_id, v_settlement_status, v_settlement_amount, v_settlement_payment_type
  FROM public.settlements s
  WHERE s.booking_id = p_booking_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_settlement_id IS NOT NULL AND upper(COALESCE(v_settlement_status, '')) IN ('COMPLETED', 'FAILED') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = v_owner_id
        AND lower(COALESCE(n.notification_type, n.type, '')) = CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'settlement_completed'
          ELSE 'settlement_failed'
        END
        AND COALESCE(n.data->>'settlement_id', '') = v_settlement_id::text
    ) THEN
      v_payout_label := CASE
        WHEN lower(COALESCE(v_settlement_payment_type, '')) IN ('monthly', 'rent') THEN 'Rent payout'
        ELSE 'Advance payout'
      END;
      v_payout_amount_text := public.notification_amount_text(v_settlement_amount, COALESCE(v_currency, 'INR'));
      v_payout_context := concat_ws(', ', public.notification_person_text(v_customer_name), v_room_label);

      INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
      )
      VALUES (
        v_owner_id,
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN v_payout_label || ' received'
          ELSE v_payout_label || ' failed'
        END,
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN format('%s of %s for %s received successfully.', v_payout_label, COALESCE(v_payout_amount_text, 'the amount'), v_payout_context)
          ELSE format('%s of %s for %s failed.', v_payout_label, COALESCE(v_payout_amount_text, 'the amount'), v_payout_context)
        END,
        'system',
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'settlement_completed'
          ELSE 'settlement_failed'
        END,
        'queued',
        jsonb_build_object('settlement_id', v_settlement_id),
        FALSE
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'checked-in');
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
  v_room_number TEXT;
  v_room_label TEXT;
BEGIN
  SELECT owner_id, customer_id, room_number
    INTO v_owner_id, v_customer_id, v_room_number
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
      booking_status = 'COMPLETED',
      continue_status = 'exit_completed',
      portal_access = false,
      next_due_date = NULL,
      rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    PERFORM public.decrement_room_occupancy(p_room_id);
  END IF;

  v_room_label := public.notification_room_text(v_room_number);

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Vacate approved',
    format('Vacate approved for %s.', v_room_label),
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
  v_room_number TEXT;
  v_room_label TEXT;
BEGIN
  SELECT owner_id, customer_id, room_number
    INTO v_owner_id, v_customer_id, v_room_number
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
      booking_status = 'COMPLETED',
      continue_status = 'exit_completed',
      portal_access = false,
      next_due_date = NULL,
      rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    PERFORM public.decrement_room_occupancy(p_room_id);
  END IF;

  v_room_label := public.notification_room_text(v_room_number);

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Check-out completed',
    format('Check-out completed for %s.', v_room_label),
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

CREATE OR REPLACE FUNCTION public.customer_request_vacate(
    p_booking_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_owner_id UUID;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_room_number TEXT;
  v_breakdown JSONB;
  v_room_label TEXT;
BEGIN
  SELECT owner_id, customer_id, customer_name, room_number
    INTO v_owner_id, v_customer_id, v_customer_name, v_room_number
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

  PERFORM set_config('app.bypass_customer_booking_write_guard', 'true', true);

  UPDATE public.bookings
  SET stay_status = 'vacate_requested',
      status = 'vacate_requested',
      booking_status = 'ENDING',
      continue_status = 'exit_requested',
      updated_at = NOW()
  WHERE id = p_booking_id;

  v_room_label := public.notification_room_text(v_room_number);

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_owner_id,
    'Vacate request',
    format('%s requested vacate for %s.', public.notification_person_text(v_customer_name, 'Resident'), v_room_label),
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

CREATE OR REPLACE FUNCTION public.owner_accept_booking_v2(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_status_lower TEXT;
  v_booking_status_lower TEXT;
  v_is_admin BOOLEAN := FALSE;
  v_conflict_exists BOOLEAN := FALSE;
  v_charge_confirmed BOOLEAN := FALSE;
  v_has_charges_table BOOLEAN := FALSE;
  v_has_payments_table BOOLEAN := FALSE;
  v_has_payment_attempts_table BOOLEAN := FALSE;
  v_has_charge_status_col BOOLEAN := FALSE;
  v_has_status_col BOOLEAN := FALSE;
  v_has_charge_type_col BOOLEAN := FALSE;
  v_has_payment_status_col BOOLEAN := FALSE;
  v_has_payment_type_col BOOLEAN := FALSE;
  v_has_attempt_status_col BOOLEAN := FALSE;
  v_charge_state_expr TEXT;
  v_payment_state_expr TEXT;
  v_paid_statuses TEXT[] := ARRAY[
    'paid',
    'success',
    'completed',
    'authorized',
    'held',
    'eligible',
    'payout_pending',
    'paid_pending_owner_acceptance'
  ];
  v_sql TEXT;
  v_room_label TEXT;
  v_amount_text TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  BEGIN
    v_is_admin := COALESCE(public.cashfree_is_admin(v_actor), FALSE);
  EXCEPTION
    WHEN undefined_function THEN
      v_is_admin := FALSE;
  END;

  IF NOT v_is_admin THEN
    BEGIN
      v_is_admin := COALESCE(public.is_admin(v_actor), FALSE);
    EXCEPTION
      WHEN undefined_function THEN
        v_is_admin := FALSE;
    END;
  END IF;

  IF v_booking.owner_id IS DISTINCT FROM v_actor AND NOT v_is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_status_lower := lower(COALESCE(v_booking.status::TEXT, ''));
  v_booking_status_lower := lower(COALESCE(v_booking.booking_status, ''));

  IF v_status_lower IN ('rejected', 'cancelled', 'refunded', 'checked-out', 'checked_out', 'completed')
     OR v_booking_status_lower IN ('rejected', 'cancelled', 'refunded', 'checked-out', 'checked_out', 'completed') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  v_charge_confirmed :=
    lower(COALESCE(v_booking.charge_status, '')) = ANY(v_paid_statuses)
    OR lower(COALESCE(v_booking.advance_charge_status, '')) = ANY(v_paid_statuses)
    OR lower(COALESCE(v_booking.payment_status, '')) = ANY(v_paid_statuses)
    OR COALESCE(v_booking.amount_paid, 0) > 0
    OR COALESCE(v_booking.advance_paid, 0) > 0;

  v_has_charges_table := to_regclass('public.charges') IS NOT NULL;

  IF NOT v_charge_confirmed AND v_has_charges_table THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'charges'
        AND column_name = 'charge_status'
    ) INTO v_has_charge_status_col;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'charges'
        AND column_name = 'status'
    ) INTO v_has_status_col;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'charges'
        AND column_name = 'charge_type'
    ) INTO v_has_charge_type_col;

    IF v_has_charge_status_col OR v_has_status_col THEN
      IF v_has_charge_status_col AND v_has_status_col THEN
        v_charge_state_expr := 'coalesce(c.charge_status, c.status, '''')';
      ELSIF v_has_charge_status_col THEN
        v_charge_state_expr := 'coalesce(c.charge_status, '''')';
      ELSE
        v_charge_state_expr := 'coalesce(c.status, '''')';
      END IF;

      v_sql :=
        'SELECT EXISTS (' ||
        '  SELECT 1' ||
        '  FROM public.charges c' ||
        '  WHERE c.booking_id = $1' ||
        '    AND lower(' || v_charge_state_expr || ') = ANY($2)';

      IF v_has_charge_type_col THEN
        v_sql := v_sql ||
          '    AND coalesce(nullif(lower(coalesce(c.charge_type, '''')), ''''), ''advance'') IN (''advance'', ''full'', ''booking'', ''deposit'')';
      END IF;

      v_sql := v_sql || ')';

      EXECUTE v_sql INTO v_charge_confirmed USING v_booking.id, v_paid_statuses;
    END IF;
  END IF;

  v_has_payments_table := to_regclass('public.payments') IS NOT NULL;

  IF NOT v_charge_confirmed AND v_has_payments_table THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payments'
        AND column_name = 'payment_status'
    ) INTO v_has_payment_status_col;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payments'
        AND column_name = 'status'
    ) INTO v_has_status_col;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payments'
        AND column_name = 'payment_type'
    ) INTO v_has_payment_type_col;

    IF v_has_payment_status_col OR v_has_status_col THEN
      IF v_has_payment_status_col AND v_has_status_col THEN
        v_payment_state_expr := 'coalesce(p.payment_status, p.status, '''')';
      ELSIF v_has_payment_status_col THEN
        v_payment_state_expr := 'coalesce(p.payment_status, '''')';
      ELSE
        v_payment_state_expr := 'coalesce(p.status, '''')';
      END IF;

      v_sql :=
        'SELECT EXISTS (' ||
        '  SELECT 1' ||
        '  FROM public.payments p' ||
        '  WHERE p.booking_id = $1' ||
        '    AND lower(' || v_payment_state_expr || ') = ANY($2)';

      IF v_has_payment_type_col THEN
        v_sql := v_sql ||
          '    AND coalesce(nullif(lower(coalesce(p.payment_type, '''')), ''''), ''advance'') IN (''advance'', ''full'', ''booking'', ''deposit'')';
      END IF;

      v_sql := v_sql || ')';

      EXECUTE v_sql INTO v_charge_confirmed USING v_booking.id, v_paid_statuses;
    END IF;
  END IF;

  v_has_payment_attempts_table := to_regclass('public.payment_attempts') IS NOT NULL;

  IF NOT v_charge_confirmed AND v_has_payment_attempts_table THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payment_attempts'
        AND column_name = 'status'
    ) INTO v_has_attempt_status_col;

    IF v_has_attempt_status_col THEN
      EXECUTE
        'SELECT EXISTS (' ||
        '  SELECT 1' ||
        '  FROM public.payment_attempts pa' ||
        '  WHERE pa.booking_id = $1' ||
        '    AND lower(coalesce(pa.status::text, '''')) IN (''success'', ''completed'', ''authorized'', ''paid'')' ||
        ')'
      INTO v_charge_confirmed
      USING v_booking.id;
    END IF;
  END IF;

  IF NOT v_charge_confirmed THEN
    RAISE EXCEPTION 'CHARGE_NOT_CONFIRMED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.customer_id = v_booking.customer_id
      AND b.id <> v_booking.id
      AND b.property_id IS DISTINCT FROM v_booking.property_id
      AND b.vacate_date IS NULL
      AND (
        lower(COALESCE(b.status::TEXT, '')) IN ('checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
        OR lower(COALESCE(b.booking_status, '')) IN ('checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
      )
  ) INTO v_conflict_exists;

  IF v_conflict_exists THEN
    RAISE EXCEPTION 'STAY_CONFLICT';
  END IF;

  UPDATE public.bookings
  SET
    status = CASE
      WHEN lower(COALESCE(status::TEXT, '')) IN ('approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
        THEN status
      ELSE 'approved'
    END,
    booking_status = CASE
      WHEN lower(COALESCE(booking_status, '')) IN ('approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
        THEN booking_status
      ELSE 'approved'
    END,
    owner_accept_status = TRUE,
    updated_at = timezone('utc', now())
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  v_room_label := public.notification_room_text(v_booking.room_number);
  v_amount_text := public.notification_amount_text(
    CASE WHEN COALESCE(v_booking.advance_paid, 0) > 0 THEN v_booking.advance_paid ELSE v_booking.amount_paid END,
    COALESCE(v_booking.currency, 'INR')
  );

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_booking.customer_id,
    'Booking approved',
    CASE
      WHEN v_amount_text IS NOT NULL THEN format('%s booking approved. Payment %s received.', v_room_label, v_amount_text)
      ELSE format('%s booking approved.', v_room_label)
    END,
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'approved'),
    FALSE
  );

  RETURN v_booking;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_accept_booking(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_reject_booking(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_in_booking(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_out_booking(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_approve_vacate(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_request_vacate(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_accept_booking_v2(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
