BEGIN;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS check_in_date DATE;
UPDATE public.bookings
SET check_in_date = COALESCE(check_in_date, start_date)
WHERE check_in_date IS NULL
  AND start_date IS NOT NULL
  AND lower(coalesce(status::text, '')) IN ('checked-in','checked_in','active','ongoing');
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
        check_in_date = COALESCE(v_booking.check_in_date, CURRENT_DATE),
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
COMMIT;
