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
  v_customer_id UUID;
  v_status_lower TEXT;
  v_stay_status_lower TEXT;
  v_breakdown JSONB;
BEGIN
  SELECT customer_id,
         lower(COALESCE(status::text, '')),
         lower(COALESCE(stay_status, ''))
    INTO v_customer_id,
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

  v_breakdown := public.preview_vacate_rent_breakdown(p_booking_id);

  IF v_status_lower = 'vacate_requested' OR v_stay_status_lower = 'vacate_requested' THEN
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

  PERFORM set_config('app.bypass_customer_booking_write_guard', 'true', true);

  UPDATE public.bookings
  SET stay_status = 'vacate_requested',
      status = 'vacate_requested',
      updated_at = NOW()
  WHERE id = p_booking_id;

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
