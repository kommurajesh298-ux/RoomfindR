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
      updated_at = timezone('utc', now())
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    UPDATE public.rooms
    SET booked_count = GREATEST(COALESCE(booked_count, 0) - 1, 0),
        is_available = CASE
          WHEN COALESCE(capacity, 0) > 0 THEN GREATEST(COALESCE(booked_count, 0) - 1, 0) < capacity
          ELSE TRUE
        END
    WHERE id = p_room_id;
  END IF;

  v_room_label := CASE
    WHEN COALESCE(NULLIF(trim(v_room_number), ''), '') <> '' THEN format('Room %s', trim(v_room_number))
    ELSE 'your booking'
  END;

  INSERT INTO public.notifications (
    user_id,
    title,
    message,
    type,
    data,
    is_read
  )
  VALUES (
    v_customer_id,
    'Vacate approved',
    format('Vacate approved for %s.', v_room_label),
    'booking',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'checked-out'),
    false
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'checked-out'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_approve_vacate(UUID, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
