BEGIN;
CREATE OR REPLACE FUNCTION public.normalize_booking_state_token(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(replace(COALESCE(trim(p_value), ''), '_', '-'));
$$;
CREATE OR REPLACE FUNCTION public.is_booking_terminal_status(
    p_status TEXT,
    p_stay_status TEXT,
    p_booking_status TEXT,
    p_continue_status TEXT,
    p_vacate_date DATE
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        p_vacate_date IS NOT NULL
        OR public.normalize_booking_state_token(p_status) IN (
            'cancelled',
            'cancelled-by-customer',
            'rejected',
            'refunded',
            'checked-out',
            'completed',
            'vacated',
            'expired',
            'ended',
            'inactive'
        )
        OR public.normalize_booking_state_token(p_stay_status) IN (
            'cancelled',
            'cancelled-by-customer',
            'rejected',
            'checked-out',
            'completed',
            'vacated',
            'expired',
            'ended',
            'inactive'
        )
        OR public.normalize_booking_state_token(p_booking_status) IN (
            'completed',
            'cancelled',
            'rejected',
            'ended',
            'expired',
            'vacated',
            'inactive'
        )
        OR public.normalize_booking_state_token(p_continue_status) IN (
            'exit-completed',
            'exited',
            'ended',
            'vacated',
            'inactive'
        );
$$;
CREATE OR REPLACE FUNCTION public.is_booking_active_status(
    p_status TEXT,
    p_stay_status TEXT,
    p_booking_status TEXT,
    p_continue_status TEXT,
    p_vacate_date DATE
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NOT public.is_booking_terminal_status(
        p_status,
        p_stay_status,
        p_booking_status,
        p_continue_status,
        p_vacate_date
    );
$$;
CREATE OR REPLACE FUNCTION public.is_booking_rent_cycle_closed(
    p_status TEXT,
    p_stay_status TEXT,
    p_booking_status TEXT,
    p_continue_status TEXT,
    p_vacate_date DATE,
    p_rent_cycle_closed_at TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_rent_cycle_closed_at IS NOT NULL
        OR public.is_booking_terminal_status(
            p_status,
            p_stay_status,
            p_booking_status,
            p_continue_status,
            p_vacate_date
        );
$$;
-- Enforce one active booking per customer using full booking lifecycle fields.
CREATE OR REPLACE FUNCTION public.enforce_single_active_booking_per_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conflicting_booking_id UUID;
BEGIN
    IF NEW.customer_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NOT public.is_booking_active_status(
        NEW.status::text,
        NEW.stay_status,
        NEW.booking_status,
        NEW.continue_status,
        NEW.vacate_date
    ) THEN
        RETURN NEW;
    END IF;

    -- Serialize booking writes per customer to prevent concurrent double bookings.
    PERFORM pg_advisory_xact_lock(9201, hashtext(NEW.customer_id::text));

    SELECT b.id
      INTO v_conflicting_booking_id
      FROM public.bookings b
     WHERE b.customer_id = NEW.customer_id
       AND b.id IS DISTINCT FROM NEW.id
       AND public.is_booking_active_status(
            b.status::text,
            b.stay_status,
            b.booking_status,
            b.continue_status,
            b.vacate_date
       )
     ORDER BY
        COALESCE(b.check_in_date, b.start_date, (b.created_at AT TIME ZONE 'utc')::date) DESC,
        b.created_at DESC,
        b.id DESC
     LIMIT 1;

    IF v_conflicting_booking_id IS NOT NULL THEN
        RAISE EXCEPTION
            'ACTIVE_PG_BOOKING_EXISTS: You already have an active booking. Please vacate your current PG before booking another one.'
            USING ERRCODE = 'P0001',
                  DETAIL = format('conflicting_booking_id=%s', v_conflicting_booking_id),
                  HINT = 'Only one active booking is allowed per customer at a time.';
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_single_active_booking_per_customer ON public.bookings;
CREATE TRIGGER trg_enforce_single_active_booking_per_customer
BEFORE INSERT OR UPDATE OF customer_id, status, stay_status, booking_status, continue_status, vacate_date, rent_cycle_closed_at
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_active_booking_per_customer();
DROP INDEX IF EXISTS idx_bookings_customer_active_lookup;
CREATE INDEX IF NOT EXISTS idx_bookings_customer_active_lookup
    ON public.bookings(customer_id, created_at DESC);
-- Keep only one active booking per user by auto-closing stale duplicates.
WITH ranked_active AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY customer_id
            ORDER BY
                COALESCE(check_in_date, start_date, (created_at AT TIME ZONE 'utc')::date) DESC,
                created_at DESC,
                id DESC
        ) AS active_rank
    FROM public.bookings
    WHERE customer_id IS NOT NULL
      AND public.is_booking_active_status(
            status::text,
            stay_status,
            booking_status,
            continue_status,
            vacate_date
      )
)
UPDATE public.bookings b
SET status = 'checked-out',
    stay_status = 'vacated',
    booking_status = 'COMPLETED',
    continue_status = 'exit_completed',
    vacate_date = COALESCE(b.vacate_date, CURRENT_DATE),
    rent_cycle_closed_at = COALESCE(b.rent_cycle_closed_at, timezone('utc', now())),
    next_due_date = NULL,
    portal_access = false,
    updated_at = timezone('utc', now())
FROM ranked_active r
WHERE b.id = r.id
  AND r.active_rank > 1;
CREATE OR REPLACE FUNCTION public.initialize_booking_rent_cycle_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_terminal BOOLEAN;
    v_cycle_duration INTEGER;
    v_cycle_anchor DATE;
BEGIN
    v_is_terminal := public.is_booking_terminal_status(
        NEW.status::text,
        NEW.stay_status,
        NEW.booking_status,
        NEW.continue_status,
        NEW.vacate_date
    );

    v_cycle_duration := GREATEST(1, COALESCE(NEW.cycle_duration_days, 30));
    NEW.cycle_duration_days := v_cycle_duration;

    -- Fresh cycle must always anchor to this booking's own start/check-in date.
    v_cycle_anchor := COALESCE(
        NEW.check_in_date,
        NEW.start_date,
        NEW.current_cycle_start_date,
        timezone('utc', now())::date
    );
    NEW.current_cycle_start_date := v_cycle_anchor;

    IF v_is_terminal THEN
        NEW.rent_cycle_closed_at := COALESCE(NEW.rent_cycle_closed_at, timezone('utc', now()));
        NEW.next_due_date := NULL;
    ELSE
        NEW.rent_cycle_closed_at := NULL;
        NEW.next_due_date := v_cycle_anchor + v_cycle_duration;
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_initialize_booking_rent_cycle_state ON public.bookings;
CREATE TRIGGER trg_initialize_booking_rent_cycle_state
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.initialize_booking_rent_cycle_state();
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
        v_booking.current_cycle_start_date,
        v_booking.check_in_date,
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
CREATE OR REPLACE FUNCTION public.get_booking_rent_cycle(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_today DATE := timezone('utc', now())::date;
    v_cycle_end DATE;
    v_status TEXT;
    v_can_pay BOOLEAN := FALSE;
    v_message TEXT := '';
    v_is_closed BOOLEAN := FALSE;
BEGIN
    v_booking := public.ensure_booking_rent_cycle_state(p_booking_id);

    IF auth.uid() IS NOT NULL
       AND NOT public.is_admin(auth.uid())
       AND v_booking.customer_id <> auth.uid()
       AND v_booking.owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_is_closed := public.is_booking_rent_cycle_closed(
        v_booking.status::text,
        v_booking.stay_status,
        v_booking.booking_status,
        v_booking.continue_status,
        v_booking.vacate_date,
        v_booking.rent_cycle_closed_at
    );

    v_cycle_end := COALESCE(
        v_booking.next_due_date,
        v_booking.current_cycle_start_date + GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30))
    );

    IF v_is_closed THEN
        v_status := 'closed';
        v_can_pay := FALSE;
        v_message := 'Rent cycle is closed.';
    ELSIF v_today > v_cycle_end THEN
        v_status := 'overdue';
        v_can_pay := TRUE;
    ELSIF v_today = v_cycle_end THEN
        v_status := 'due';
        v_can_pay := TRUE;
    ELSE
        v_status := 'active';
        v_can_pay := FALSE;
        v_message := format(
            'Your current rent cycle is active until %s.',
            to_char(v_cycle_end, 'DD Mon YYYY')
        );
    END IF;

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'current_cycle_start_date', v_booking.current_cycle_start_date,
        'cycle_end_date', v_cycle_end,
        'next_due_date', v_booking.next_due_date,
        'cycle_duration_days', v_booking.cycle_duration_days,
        'server_date', v_today,
        'status', v_status,
        'can_pay_rent', v_can_pay,
        'message', v_message
    );
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
      next_due_date = NULL,
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
      next_due_date = NULL,
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
CREATE OR REPLACE FUNCTION public.exit_booking_stay(
    p_booking_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay_type TEXT;
BEGIN
  SELECT lower(COALESCE(stay_type, ''))
  INTO v_stay_type
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_stay_type = 'days' THEN
    UPDATE public.bookings
    SET status = 'checked-out',
        stay_status = 'vacated',
        vacate_date = CURRENT_DATE,
        booking_status = 'COMPLETED',
        continue_status = 'exit_completed',
        portal_access = false,
        next_due_date = NULL,
        rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
        updated_at = NOW()
    WHERE id = p_booking_id;
  ELSE
    UPDATE public.bookings
    SET booking_status = 'ENDING',
        continue_status = 'exit_requested',
        stay_status = 'vacate_requested',
        portal_access = true,
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.expire_booking_stay(
    p_booking_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.bookings
    SET booking_status = 'EXPIRED',
        continue_status = COALESCE(continue_status, 'pending'),
        portal_access = false,
        next_due_date = NULL,
        rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
        updated_at = NOW()
    WHERE id = p_booking_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_booking_rent_cycle_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_booking_rent_cycle_state(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_rent_cycle(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_request_vacate(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_approve_vacate(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_check_out_booking(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exit_booking_stay(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_booking_stay(UUID) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
