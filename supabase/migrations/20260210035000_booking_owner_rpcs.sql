BEGIN;
-- Role helpers (used by RPCs)
-- Keep existing arg names to avoid breaking dependent RLS policies
DO $do$
DECLARE
  v_argname TEXT := 'uid';
BEGIN
  SELECT COALESCE(proargnames[1], 'uid') INTO v_argname
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'is_admin'
  LIMIT 1;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.is_admin(%I UUID DEFAULT auth.uid())
     RETURNS BOOLEAN
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public
     SET row_security = off
     AS $func$
       SELECT (
         (auth.jwt()->''user_metadata''->>''role'') = ''admin''
         AND (%I IS NULL OR %I = auth.uid())
       );
     $func$;',
    v_argname, v_argname, v_argname
  );
END $do$;
-- Ensure no-arg admin helper is safe and RLS-proof
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.is_admin(auth.uid());
$$;
DO $do$
DECLARE
  v_argname TEXT := 'uid';
BEGIN
  SELECT COALESCE(proargnames[1], 'uid') INTO v_argname
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'is_owner'
  LIMIT 1;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.is_owner(%I UUID DEFAULT auth.uid())
     RETURNS BOOLEAN
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public
     SET row_security = off
     AS $func$
       SELECT (
         (auth.jwt()->''user_metadata''->>''role'') = ''owner''
         AND (%I IS NULL OR %I = auth.uid())
       );
     $func$;',
    v_argname, v_argname, v_argname
  );
END $do$;
-- Ensure no-arg owner helper is safe and RLS-proof
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.is_owner(auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;
-- Room occupancy helpers (used by check-in/check-out)
CREATE OR REPLACE FUNCTION public.increment_room_occupancy(room_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.rooms
  SET booked_count = booked_count + 1,
      is_available = CASE
        WHEN booked_count + 1 >= capacity THEN false
        ELSE true
      END
  WHERE id = room_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.decrement_room_occupancy(room_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.rooms
  SET booked_count = GREATEST(0, booked_count - 1),
      is_available = true
  WHERE id = room_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_room_occupancy(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_room_occupancy(uuid) TO authenticated, service_role;
-- Owner booking RPCs
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
  IF v_status_lower IN ('approved','accepted','checked-in','checked_in','confirmed') THEN
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
BEGIN
  SELECT owner_id, customer_id, status::text
    INTO v_owner_id, v_customer_id, v_status
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

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Booking Update',
    format('Your booking request was rejected. Host''s Note: %s', v_reason),
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
  v_conflict_exists BOOLEAN;
BEGIN
  SELECT owner_id, customer_id, property_id, check_in_date
    INTO v_owner_id, v_customer_id, v_property_id, v_check_in_date
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

  UPDATE public.bookings
  SET status = 'checked-in',
      stay_status = 'ongoing',
      check_in_date = COALESCE(v_check_in_date, CURRENT_DATE),
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    PERFORM public.increment_room_occupancy(p_room_id);
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, notification_type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Checked In!',
    'Welcome to your new home! You can now access all portal features.',
    'booking',
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'checked-in'),
    FALSE
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'checked-in');
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
      portal_access = false,
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
      portal_access = false,
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

  UPDATE public.bookings
  SET stay_status = 'vacate_requested',
      status = 'vacate_requested',
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
    jsonb_build_object('booking_id', p_booking_id, 'type', 'vacate_request'),
    FALSE
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'vacate_requested');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;
GRANT EXECUTE ON FUNCTION public.owner_accept_booking(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_reject_booking(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_in_booking(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_out_booking(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_approve_vacate(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_request_vacate(UUID) TO authenticated, service_role;
-- Ensure trigger helpers don't hit RLS recursion during RPC updates
DO $$
BEGIN
  IF to_regprocedure('public.trigger_notification_push()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.trigger_notification_push() SET row_security = off';
  END IF;

  IF to_regprocedure('public.prepare_settlement_for_booking(uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.prepare_settlement_for_booking(uuid) SET row_security = off';
  END IF;

  IF to_regprocedure('public.trigger_booking_settlement()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.trigger_booking_settlement() SET row_security = off';
  END IF;
END $$;
-- Refresh PostgREST schema cache so /rpc/* endpoints appear
NOTIFY pgrst, 'reload schema';
COMMIT;
