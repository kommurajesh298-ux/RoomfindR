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
  v_actor_role TEXT := lower(
    COALESCE(
      auth.jwt() -> 'user_metadata' ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  );
  v_is_admin BOOLEAN := v_actor_role = 'admin';
  v_conflict_exists BOOLEAN := FALSE;
  v_charge_confirmed BOOLEAN := FALSE;
  v_paid_amount NUMERIC := 0;
  v_amount_text TEXT := NULL;
  v_room_label TEXT;
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

  IF v_booking.owner_id IS DISTINCT FROM v_actor AND NOT v_is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_status_lower := lower(COALESCE(v_booking.status::TEXT, ''));

  IF v_status_lower IN ('rejected', 'cancelled', 'refunded', 'checked-out', 'checked_out', 'completed') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  v_charge_confirmed :=
    lower(COALESCE(v_booking.payment_status::TEXT, '')) IN ('paid', 'success', 'completed', 'authorized', 'verified', 'held', 'eligible', 'payout_pending', 'paid_pending_owner_acceptance')
    OR COALESCE(v_booking.amount_paid, 0) > 0
    OR COALESCE(v_booking.advance_paid, 0) > 0
    OR EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.booking_id = v_booking.id
        AND lower(COALESCE(NULLIF(p.payment_status, ''), p.status::TEXT, '')) IN ('paid', 'success', 'completed', 'authorized', 'verified')
        AND COALESCE(NULLIF(lower(COALESCE(p.payment_type, '')), ''), 'advance') IN ('advance', 'full', 'booking', 'deposit')
      LIMIT 1
    )
    OR EXISTS (
      SELECT 1
      FROM public.payment_attempts pa
      WHERE pa.booking_id = v_booking.id
        AND lower(COALESCE(pa.status::TEXT, '')) IN ('paid', 'success', 'completed', 'authorized')
      LIMIT 1
    );

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
      AND lower(COALESCE(b.status::TEXT, '')) IN ('checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
  ) INTO v_conflict_exists;

  IF v_conflict_exists THEN
    RAISE EXCEPTION 'STAY_CONFLICT';
  END IF;

  UPDATE public.bookings
  SET
    status = CASE
      WHEN lower(COALESCE(status::TEXT, '')) IN ('approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested') THEN status
      ELSE 'approved'
    END,
    updated_at = timezone('utc', now())
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

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
    'booking_confirmed',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'approved'),
    FALSE
  );

  RETURN v_booking;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.owner_accept_booking_v2(UUID) TO authenticated, service_role;
