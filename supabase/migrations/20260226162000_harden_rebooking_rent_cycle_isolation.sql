BEGIN;
CREATE OR REPLACE FUNCTION public.initialize_booking_rent_cycle_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT := lower(COALESCE(NEW.status::text, ''));
    v_is_terminal BOOLEAN;
    v_cycle_duration INTEGER;
    v_cycle_anchor DATE;
BEGIN
    v_is_terminal := NEW.vacate_date IS NOT NULL
        OR v_status IN (
            'cancelled',
            'cancelled_by_customer',
            'cancelled-by-customer',
            'rejected',
            'checked-out',
            'checked_out',
            'completed',
            'vacated',
            'expired',
            'ended',
            'inactive'
        );

    v_cycle_duration := GREATEST(1, COALESCE(NEW.cycle_duration_days, 30));
    NEW.cycle_duration_days := v_cycle_duration;

    v_cycle_anchor := COALESCE(
        NEW.current_cycle_start_date,
        NEW.check_in_date,
        NEW.start_date,
        timezone('utc', now())::date
    );
    NEW.current_cycle_start_date := v_cycle_anchor;

    IF NEW.next_due_date IS NULL OR NEW.next_due_date <= v_cycle_anchor THEN
        NEW.next_due_date := v_cycle_anchor + v_cycle_duration;
    END IF;

    IF v_is_terminal THEN
        NEW.rent_cycle_closed_at := COALESCE(NEW.rent_cycle_closed_at, timezone('utc', now()));
    ELSE
        NEW.rent_cycle_closed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_initialize_booking_rent_cycle_state ON public.bookings;
CREATE TRIGGER trg_initialize_booking_rent_cycle_state
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.initialize_booking_rent_cycle_state();
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
      booking_status = 'ENDING',
      continue_status = 'exit_requested',
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
      booking_status = 'COMPLETED',
      continue_status = 'exit_completed',
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
      booking_status = 'COMPLETED',
      continue_status = 'exit_completed',
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
GRANT EXECUTE ON FUNCTION public.customer_request_vacate(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_approve_vacate(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_out_booking(UUID, UUID) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
