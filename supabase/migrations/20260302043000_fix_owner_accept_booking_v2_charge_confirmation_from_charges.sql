BEGIN;
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
  v_has_charge_status_col BOOLEAN := FALSE;
  v_has_status_col BOOLEAN := FALSE;
  v_has_charge_type_col BOOLEAN := FALSE;
  v_charge_state_expr TEXT;
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
    OR lower(COALESCE(v_booking.payment_status, '')) = ANY(v_paid_statuses);

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

  RETURN v_booking;
END;
$$;
GRANT EXECUTE ON FUNCTION public.owner_accept_booking_v2(UUID) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
