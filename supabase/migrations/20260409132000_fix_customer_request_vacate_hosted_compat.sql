BEGIN;

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
  v_status_lower TEXT;
  v_stay_status_lower TEXT;
  v_breakdown JSONB;
  v_room_label TEXT;
BEGIN
  SELECT owner_id,
         customer_id,
         customer_name,
         room_number,
         lower(COALESCE(status::text, '')),
         lower(COALESCE(stay_status, ''))
    INTO v_owner_id,
         v_customer_id,
         v_customer_name,
         v_room_number,
         v_status_lower,
         v_stay_status_lower
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR v_customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_status_lower = 'vacate_requested' OR v_stay_status_lower = 'vacate_requested' THEN
    v_breakdown := public.preview_vacate_rent_breakdown(p_booking_id);
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'status', 'vacate_requested',
      'vacate_breakdown', v_breakdown
    );
  END IF;

  IF v_status_lower IN ('checked-out', 'checked_out', 'completed', 'cancelled', 'rejected', 'refunded') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  v_breakdown := public.preview_vacate_rent_breakdown(p_booking_id);

  PERFORM set_config('app.bypass_customer_booking_write_guard', 'true', true);

  UPDATE public.bookings
  SET stay_status = 'vacate_requested',
      status = 'vacate_requested',
      updated_at = NOW()
  WHERE id = p_booking_id;

  v_room_label := public.notification_room_text(v_room_number);

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = v_owner_id
      AND lower(COALESCE(n.notification_type, n.type, '')) = 'booking'
      AND COALESCE(n.data->>'type', '') = 'vacate_request'
      AND COALESCE(n.data->>'booking_id', '') = p_booking_id::text
  ) THEN
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
  END IF;

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

GRANT EXECUTE ON FUNCTION public.customer_request_vacate(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
