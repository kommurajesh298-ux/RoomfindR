BEGIN;
-- Ensure pg_net for admin refund RPC
CREATE EXTENSION IF NOT EXISTS pg_net;
-- Secure booking mutations via RPCs (owners/customers/admin)
CREATE OR REPLACE FUNCTION public.owner_accept_booking(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_status_lower TEXT;
    v_conflict_exists BOOLEAN;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (public.is_admin(auth.uid()) OR v_booking.owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    IF lower(coalesce(v_booking.payment_status::text, '')) <> 'paid' THEN
        RAISE EXCEPTION 'PAYMENT_NOT_CONFIRMED';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.customer_id = v_booking.customer_id
          AND b.vacate_date IS NULL
          AND lower(coalesce(b.status::text, '')) IN ('checked-in','checked_in','active','ongoing')
          AND b.property_id <> v_booking.property_id
    ) INTO v_conflict_exists;

    IF v_conflict_exists THEN
        RAISE EXCEPTION 'STAY_CONFLICT';
    END IF;

    v_status_lower := lower(coalesce(v_booking.status::text, ''));
    IF v_status_lower IN ('approved','accepted','checked-in','checked_in','confirmed') THEN
        RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', v_booking.status);
    END IF;
    IF v_status_lower IN ('rejected','cancelled','refunded','checked-out','checked_out','completed') THEN
        RAISE EXCEPTION 'INVALID_STATUS';
    END IF;

    UPDATE public.bookings
    SET status = 'approved',
        updated_at = NOW()
    WHERE id = v_booking.id;

    INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
    )
    VALUES (
        v_booking.customer_id,
        'Booking Approved!',
        'Your host has approved your booking request.',
        'booking',
        'booking',
        'queued',
        jsonb_build_object('booking_id', v_booking.id, 'status', 'approved'),
        FALSE
    );

    RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', 'approved');
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_reject_booking(
    p_booking_id UUID,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_status_lower TEXT;
    v_reason TEXT;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (public.is_admin(auth.uid()) OR v_booking.owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_status_lower := lower(coalesce(v_booking.status::text, ''));
    IF v_status_lower IN ('rejected','cancelled','refunded') THEN
        RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', v_booking.status);
    END IF;
    IF v_status_lower IN ('checked-out','checked_out','completed') THEN
        RAISE EXCEPTION 'INVALID_STATUS';
    END IF;

    v_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Booking rejected');

    UPDATE public.bookings
    SET status = 'rejected',
        rejection_reason = v_reason,
        updated_at = NOW()
    WHERE id = v_booking.id;

    INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
    )
    VALUES (
        v_booking.customer_id,
        'Booking Update',
        format('Your booking request was rejected. Host''s Note: %s', v_reason),
        'booking',
        'booking',
        'queued',
        jsonb_build_object('booking_id', v_booking.id, 'status', 'rejected'),
        FALSE
    );

    RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', 'rejected');
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_check_in_booking(
    p_booking_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_conflict_exists BOOLEAN;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (public.is_admin(auth.uid()) OR v_booking.owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.customer_id = v_booking.customer_id
          AND b.vacate_date IS NULL
          AND lower(coalesce(b.status::text, '')) IN ('checked-in','checked_in','active','ongoing')
          AND b.property_id <> v_booking.property_id
    ) INTO v_conflict_exists;

    IF v_conflict_exists THEN
        RAISE EXCEPTION 'STAY_CONFLICT';
    END IF;

    UPDATE public.bookings
    SET status = 'checked-in',
        stay_status = 'ongoing',
        updated_at = NOW()
    WHERE id = v_booking.id;

    IF p_room_id IS NOT NULL THEN
        PERFORM public.increment_room_occupancy(p_room_id);
    END IF;

    INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
    )
    VALUES (
        v_booking.customer_id,
        'Checked In!',
        'Welcome to your new home! You can now access all portal features.',
        'booking',
        'booking',
        'queued',
        jsonb_build_object('booking_id', v_booking.id, 'status', 'checked-in'),
        FALSE
    );

    RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', 'checked-in');
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_check_out_booking(
    p_booking_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (public.is_admin(auth.uid()) OR v_booking.owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    UPDATE public.bookings
    SET status = 'checked-out',
        stay_status = 'vacated',
        vacate_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = v_booking.id;

    IF p_room_id IS NOT NULL THEN
        PERFORM public.decrement_room_occupancy(p_room_id);
    END IF;

    INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
    )
    VALUES (
        v_booking.customer_id,
        'Checked Out',
        'Your stay has been marked as checked out.',
        'booking',
        'booking',
        'queued',
        jsonb_build_object('booking_id', v_booking.id, 'status', 'checked-out'),
        FALSE
    );

    RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', 'checked-out');
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_approve_vacate(
    p_booking_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (public.is_admin(auth.uid()) OR v_booking.owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    UPDATE public.bookings
    SET status = 'checked-out',
        stay_status = 'vacated',
        vacate_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = v_booking.id;

    IF p_room_id IS NOT NULL THEN
        PERFORM public.decrement_room_occupancy(p_room_id);
    END IF;

    INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
    )
    VALUES (
        v_booking.customer_id,
        'Vacate Approved',
        'Your vacate request has been approved by the owner.',
        'booking',
        'booking',
        'queued',
        jsonb_build_object('booking_id', v_booking.id, 'status', 'checked-out'),
        FALSE
    );

    RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', 'checked-out');
END;
$$;
CREATE OR REPLACE FUNCTION public.customer_request_vacate(
    p_booking_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (public.is_admin(auth.uid()) OR v_booking.customer_id = auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    UPDATE public.bookings
    SET vacate_date = CURRENT_DATE,
        stay_status = 'vacate_requested',
        status = 'checked-in',
        updated_at = NOW()
    WHERE id = v_booking.id;

    INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
    )
    VALUES (
        v_booking.owner_id,
        'Vacate request',
        format('%s has requested to vacate. Approval required.', COALESCE(v_booking.customer_name, 'A resident')),
        'booking',
        'booking',
        'queued',
        jsonb_build_object('booking_id', v_booking.id, 'type', 'vacate_request'),
        FALSE
    );

    RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', 'vacate_requested');
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_cancel_booking(
    p_booking_id UUID,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_reason TEXT;
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    v_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled by admin');

    UPDATE public.bookings
    SET status = 'cancelled',
        cancelled_at = NOW(),
        rejection_reason = v_reason,
        updated_at = NOW()
    WHERE id = v_booking.id;

    IF v_booking.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (
            user_id, title, message, type, notification_type, status, data, is_read
        )
        VALUES (
            v_booking.customer_id,
            'Booking Cancelled',
            v_reason,
            'booking',
            'booking',
            'queued',
            jsonb_build_object('booking_id', v_booking.id, 'status', 'cancelled'),
            FALSE
        );
    END IF;

    IF v_booking.owner_id IS NOT NULL THEN
        INSERT INTO public.notifications (
            user_id, title, message, type, notification_type, status, data, is_read
        )
        VALUES (
            v_booking.owner_id,
            'Booking Cancelled',
            v_reason,
            'booking',
            'booking',
            'queued',
            jsonb_build_object('booking_id', v_booking.id, 'status', 'cancelled'),
            FALSE
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'booking_id', v_booking.id, 'status', 'cancelled');
END;
$$;
-- Admin-only refund trigger via RPC (no auto-refund on status change)
CREATE OR REPLACE FUNCTION public.admin_refund_booking(
    p_booking_id UUID,
    p_payment_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT 'Refund initiated by admin',
    p_refund_reason TEXT DEFAULT 'booking_cancelled',
    p_refund_amount NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE EXCEPTION 'Missing supabase_url or service key for refund';
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/cashfree-refund',
        headers := headers,
        body := jsonb_build_object(
            'bookingId', p_booking_id,
            'paymentId', p_payment_id,
            'reason', p_reason,
            'refundReason', p_refund_reason,
            'refundAmount', p_refund_amount,
            'initiatedBy', 'admin'
        )
    );

    RETURN jsonb_build_object('queued', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.owner_accept_booking(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_reject_booking(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_in_booking(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_out_booking(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_approve_vacate(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_request_vacate(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_booking(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_refund_booking(UUID, UUID, TEXT, TEXT, NUMERIC) TO authenticated, service_role;
-- Tighten RLS: bookings update restricted to admin (mutations via RPCs)
DROP POLICY IF EXISTS "Booking update policy v4" ON public.bookings;
DROP POLICY IF EXISTS "Booking update policy v3" ON public.bookings;
DROP POLICY IF EXISTS "Booking update policy v2" ON public.bookings;
DROP POLICY IF EXISTS "Users can update related bookings" ON public.bookings;
CREATE POLICY "Booking update admin only"
    ON public.bookings
    FOR UPDATE
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));
-- Restrict direct payments insert (use Edge Functions / RPCs)
DROP POLICY IF EXISTS "System can create payments" ON public.payments;
CREATE POLICY "Payments insert admin only"
    ON public.payments
    FOR INSERT
    WITH CHECK (public.is_admin(auth.uid()));
COMMIT;
