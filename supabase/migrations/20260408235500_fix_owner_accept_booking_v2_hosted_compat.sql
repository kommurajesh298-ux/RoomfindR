CREATE OR REPLACE FUNCTION public.owner_accept_booking_v2(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_status_lower TEXT;
  v_booking_status_lower TEXT := '';
  v_is_admin BOOLEAN := FALSE;
  v_conflict_exists BOOLEAN := FALSE;
  v_charge_confirmed BOOLEAN := FALSE;
  v_has_booking_status_col BOOLEAN := FALSE;
  v_has_owner_accept_status_col BOOLEAN := FALSE;
  v_has_payments_table BOOLEAN := FALSE;
  v_has_payment_attempts_table BOOLEAN := FALSE;
  v_has_payment_status_col BOOLEAN := FALSE;
  v_has_status_col BOOLEAN := FALSE;
  v_has_payment_type_col BOOLEAN := FALSE;
  v_has_attempt_status_col BOOLEAN := FALSE;
  v_payment_state_expr TEXT;
  v_paid_statuses TEXT[] := ARRAY[
    'paid',
    'success',
    'completed',
    'authorized',
    'verified',
    'held',
    'eligible',
    'payout_pending',
    'paid_pending_owner_acceptance'
  ];
  v_sql TEXT;
  v_room_label TEXT;
  v_paid_amount NUMERIC := 0;
  v_amount_text TEXT := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'booking_status'
  ) INTO v_has_booking_status_col;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'owner_accept_status'
  ) INTO v_has_owner_accept_status_col;

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

  IF v_has_booking_status_col THEN
    EXECUTE
      'SELECT lower(coalesce(booking_status, '''')) FROM public.bookings WHERE id = $1'
    INTO v_booking_status_lower
    USING p_booking_id;
  END IF;

  IF v_status_lower IN ('rejected', 'cancelled', 'refunded', 'checked-out', 'checked_out', 'completed')
     OR v_booking_status_lower IN ('rejected', 'cancelled', 'refunded', 'checked-out', 'checked_out', 'completed') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  v_charge_confirmed :=
    lower(COALESCE(v_booking.payment_status, '')) = ANY(v_paid_statuses)
    OR COALESCE(v_booking.amount_paid, 0) > 0
    OR COALESCE(v_booking.advance_paid, 0) > 0;

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

  IF v_has_booking_status_col THEN
    EXECUTE
      'SELECT EXISTS (' ||
      '  SELECT 1' ||
      '  FROM public.bookings b' ||
      '  WHERE b.customer_id = $1' ||
      '    AND b.id <> $2' ||
      '    AND b.property_id IS DISTINCT FROM $3' ||
      '    AND b.vacate_date IS NULL' ||
      '    AND (' ||
      '      lower(coalesce(b.status::text, '''')) IN (''checked-in'', ''checked_in'', ''active'', ''ongoing'', ''vacate_requested'')' ||
      '      OR lower(coalesce(b.booking_status, '''')) IN (''checked-in'', ''checked_in'', ''active'', ''ongoing'', ''vacate_requested'')' ||
      '    )' ||
      ')'
    INTO v_conflict_exists
    USING v_booking.customer_id, v_booking.id, v_booking.property_id;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.customer_id = v_booking.customer_id
        AND b.id <> v_booking.id
        AND b.property_id IS DISTINCT FROM v_booking.property_id
        AND b.vacate_date IS NULL
        AND lower(COALESCE(b.status::TEXT, '')) IN ('checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
    ) INTO v_conflict_exists;
  END IF;

  IF v_conflict_exists THEN
    RAISE EXCEPTION 'STAY_CONFLICT';
  END IF;

  v_sql :=
    'UPDATE public.bookings SET ' ||
    'status = CASE ' ||
    '  WHEN lower(coalesce(status::text, '''')) IN (''approved'', ''accepted'', ''confirmed'', ''checked-in'', ''checked_in'', ''active'', ''ongoing'', ''vacate_requested'') THEN status ' ||
    '  ELSE ''approved'' ' ||
    'END';

  IF v_has_booking_status_col THEN
    v_sql := v_sql ||
      ', booking_status = CASE ' ||
      '  WHEN lower(coalesce(booking_status, '''')) IN (''approved'', ''accepted'', ''confirmed'', ''checked-in'', ''checked_in'', ''active'', ''ongoing'', ''vacate_requested'') THEN booking_status ' ||
      '  ELSE ''approved'' ' ||
      'END';
  END IF;

  IF v_has_owner_accept_status_col THEN
    v_sql := v_sql || ', owner_accept_status = TRUE';
  END IF;

  v_sql := v_sql ||
    ', updated_at = timezone(''utc'', now()) ' ||
    'WHERE id = $1 RETURNING *';

  EXECUTE v_sql INTO v_booking USING p_booking_id;

  v_room_label := CASE
    WHEN COALESCE(NULLIF(trim(v_booking.room_number), ''), '') <> '' THEN format('Room %s', trim(v_booking.room_number))
    ELSE 'Booking'
  END;

  v_paid_amount := CASE
    WHEN COALESCE(v_booking.advance_paid, 0) > 0 THEN v_booking.advance_paid
    ELSE COALESCE(v_booking.amount_paid, 0)
  END;

  IF v_paid_amount > 0 THEN
    v_amount_text := format('%s %s', COALESCE(v_booking.currency, 'INR'), trim(to_char(v_paid_amount, 'FM9999999990D00')));
  END IF;

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
$function$;

GRANT EXECUTE ON FUNCTION public.owner_accept_booking_v2(UUID) TO authenticated, service_role;
