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

  PERFORM set_config('app.bypass_customer_booking_write_guard', 'true', true);

  UPDATE public.bookings
  SET stay_status = 'vacate_requested',
      status = 'vacate_requested',
      booking_status = 'ENDING',
      continue_status = 'exit_requested',
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

GRANT EXECUTE ON FUNCTION public.customer_request_vacate(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
