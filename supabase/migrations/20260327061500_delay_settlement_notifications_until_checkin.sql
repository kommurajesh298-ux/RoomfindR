CREATE OR REPLACE FUNCTION public.ensure_booking_rent_cycle_state(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_cycle_duration INTEGER;
    v_cycle_start DATE;
    v_next_due DATE;
    v_is_closed BOOLEAN;
    v_closed_at TIMESTAMPTZ;
BEGIN
    SELECT *
    INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    v_cycle_duration := GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30));
    v_cycle_start := COALESCE(
        v_booking.check_in_date,
        v_booking.current_cycle_start_date,
        v_booking.start_date,
        timezone('utc', now())::date
    );
    v_is_closed := public.is_booking_rent_cycle_closed(
        v_booking.status::text,
        v_booking.stay_status,
        v_booking.booking_status,
        v_booking.continue_status,
        v_booking.vacate_date,
        v_booking.rent_cycle_closed_at
    );
    v_next_due := CASE
        WHEN v_is_closed THEN NULL
        ELSE COALESCE(v_booking.next_due_date, v_cycle_start + v_cycle_duration)
    END;
    v_closed_at := CASE
        WHEN v_is_closed THEN COALESCE(v_booking.rent_cycle_closed_at, timezone('utc', now()))
        ELSE NULL
    END;

    IF v_booking.cycle_duration_days IS DISTINCT FROM v_cycle_duration
       OR v_booking.current_cycle_start_date IS DISTINCT FROM v_cycle_start
       OR v_booking.next_due_date IS DISTINCT FROM v_next_due
       OR v_booking.rent_cycle_closed_at IS DISTINCT FROM v_closed_at THEN
        UPDATE public.bookings
        SET cycle_duration_days = v_cycle_duration,
            current_cycle_start_date = v_cycle_start,
            next_due_date = v_next_due,
            rent_cycle_closed_at = v_closed_at,
            updated_at = timezone('utc', now())
        WHERE id = p_booking_id
        RETURNING * INTO v_booking;
    END IF;

    RETURN v_booking;
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
  v_cycle_duration INTEGER;
  v_conflict_exists BOOLEAN;
  v_settlement_id UUID;
  v_settlement_status TEXT;
BEGIN
  SELECT owner_id, customer_id, property_id, check_in_date, COALESCE(cycle_duration_days, 30)
    INTO v_owner_id, v_customer_id, v_property_id, v_check_in_date, v_cycle_duration
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

  v_check_in_date := COALESCE(v_check_in_date, CURRENT_DATE);

  UPDATE public.bookings
  SET status = 'checked-in',
      stay_status = 'ongoing',
      check_in_date = v_check_in_date,
      current_cycle_start_date = v_check_in_date,
      next_due_date = v_check_in_date + GREATEST(1, COALESCE(v_cycle_duration, 30)),
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

  SELECT s.id, s.status
    INTO v_settlement_id, v_settlement_status
  FROM public.settlements s
  WHERE s.booking_id = p_booking_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_settlement_id IS NOT NULL AND upper(COALESCE(v_settlement_status, '')) IN ('COMPLETED', 'FAILED') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = v_owner_id
        AND lower(COALESCE(n.notification_type, n.type, '')) = CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'settlement_completed'
          ELSE 'settlement_failed'
        END
        AND COALESCE(n.data->>'settlement_id', '') = v_settlement_id::text
    ) THEN
      INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
      )
      VALUES (
        v_owner_id,
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'Settlement Completed'
          ELSE 'Settlement Failed'
        END,
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'Your settlement payout has been completed.'
          ELSE 'Your settlement payout failed. Please contact support.'
        END,
        'system',
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'settlement_completed'
          ELSE 'settlement_failed'
        END,
        'queued',
        jsonb_build_object('settlement_id', v_settlement_id),
        FALSE
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'checked-in');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

NOTIFY pgrst, 'reload schema';
