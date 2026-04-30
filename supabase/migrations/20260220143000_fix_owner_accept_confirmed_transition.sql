BEGIN;
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
  v_status_lower TEXT;
  v_conflict_exists BOOLEAN;
BEGIN
  SELECT owner_id, customer_id, property_id, status::text, payment_status::text
    INTO v_owner_id, v_customer_id, v_property_id, v_status, v_payment_status
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

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Booking Approved!',
    'Your host has approved your booking request.',
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
GRANT EXECUTE ON FUNCTION public.owner_accept_booking(UUID) TO authenticated, service_role;
COMMIT;
