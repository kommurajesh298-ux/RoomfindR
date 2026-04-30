BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS current_cycle_start_date DATE,
  ADD COLUMN IF NOT EXISTS next_due_date DATE,
  ADD COLUMN IF NOT EXISTS cycle_duration_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rent_payment_status TEXT DEFAULT 'not_due';

UPDATE public.bookings
SET
  cycle_duration_days = COALESCE(cycle_duration_days, 30),
  current_cycle_start_date = COALESCE(current_cycle_start_date, start_date, timezone('utc', now())::date),
  next_due_date = COALESCE(
    next_due_date,
    COALESCE(current_cycle_start_date, start_date, timezone('utc', now())::date) + GREATEST(1, COALESCE(cycle_duration_days, 30))
  ),
  rent_payment_status = COALESCE(NULLIF(rent_payment_status, ''), 'not_due')
WHERE
  current_cycle_start_date IS NULL
  OR next_due_date IS NULL
  OR cycle_duration_days IS NULL
  OR rent_payment_status IS NULL
  OR rent_payment_status = '';

CREATE OR REPLACE FUNCTION public.ensure_booking_rent_cycle_state(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_cycle_start DATE;
  v_next_due DATE;
  v_cycle_duration INTEGER;
  v_today DATE := timezone('utc', now())::date;
  v_next_status TEXT;
  v_is_closed BOOLEAN;
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
  v_cycle_start := COALESCE(v_booking.current_cycle_start_date, v_booking.start_date, v_today);
  v_is_closed := lower(COALESCE(v_booking.status::text, '')) IN (
      'checked-out', 'checked_out', 'vacated', 'completed', 'cancelled',
      'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded'
    )
    OR v_booking.vacate_date IS NOT NULL;

  v_next_due := CASE
    WHEN v_is_closed THEN NULL
    ELSE COALESCE(v_booking.next_due_date, v_cycle_start + v_cycle_duration)
  END;

  v_next_status := CASE
    WHEN v_is_closed THEN COALESCE(NULLIF(v_booking.rent_payment_status, ''), 'not_due')
    WHEN COALESCE(v_booking.rent_payment_status, '') = 'failed' THEN 'failed'
    WHEN v_next_due IS NOT NULL AND v_next_due <= v_today THEN 'pending'
    ELSE 'not_due'
  END;

  IF v_booking.current_cycle_start_date IS DISTINCT FROM v_cycle_start
     OR v_booking.next_due_date IS DISTINCT FROM v_next_due
     OR v_booking.cycle_duration_days IS DISTINCT FROM v_cycle_duration
     OR COALESCE(v_booking.rent_payment_status, '') IS DISTINCT FROM v_next_status THEN
    UPDATE public.bookings
    SET
      current_cycle_start_date = v_cycle_start,
      next_due_date = v_next_due,
      cycle_duration_days = v_cycle_duration,
      rent_payment_status = v_next_status,
      updated_at = timezone('utc', now())
    WHERE id = v_booking.id
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
  v_has_verified_monthly_payment BOOLEAN := FALSE;
  v_is_closed BOOLEAN := FALSE;
BEGIN
  v_booking := public.ensure_booking_rent_cycle_state(p_booking_id);

  IF auth.uid() IS NOT NULL
     AND v_booking.customer_id <> auth.uid()
     AND v_booking.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_is_closed := lower(COALESCE(v_booking.status::text, '')) IN (
      'checked-out', 'checked_out', 'vacated', 'completed', 'cancelled',
      'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded'
    )
    OR v_booking.vacate_date IS NOT NULL;

  v_cycle_end := COALESCE(
    v_booking.next_due_date,
    v_booking.current_cycle_start_date + GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30))
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = v_booking.id
      AND lower(COALESCE(p.payment_type, '')) IN ('monthly', 'rent')
      AND lower(COALESCE(p.payment_status, p.status::text, '')) IN ('paid', 'completed', 'success', 'authorized')
  )
  INTO v_has_verified_monthly_payment;

  IF v_is_closed THEN
    v_status := 'closed';
    v_can_pay := FALSE;
    v_message := 'Rent cycle is closed.';
  ELSIF v_today > v_cycle_end THEN
    v_status := 'overdue';
    v_can_pay := TRUE;
    v_message := format(
      'This rent cycle is overdue since %s. Complete payment now to keep the next cycle in sync.',
      to_char(v_cycle_end, 'DD Mon YYYY')
    );
  ELSIF v_today = v_cycle_end THEN
    v_status := 'due';
    v_can_pay := TRUE;
    v_message := format(
      'Rent payment is due today for the cycle ending %s.',
      to_char(v_cycle_end, 'DD Mon YYYY')
    );
  ELSIF NOT v_has_verified_monthly_payment THEN
    v_status := 'due';
    v_can_pay := TRUE;
    v_message := format(
      'Your first rent cycle started on %s. You can pay this cycle now, and the next due date will move automatically after verification.',
      to_char(v_booking.current_cycle_start_date, 'DD Mon YYYY')
    );
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

CREATE OR REPLACE FUNCTION public.advance_rent_cycle_on_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_today DATE := timezone('utc', now())::date;
  v_cycle_start DATE;
  v_next_due DATE;
  v_new_start DATE;
  v_new_next_due DATE;
  v_has_prior_verified_monthly_payment BOOLEAN := FALSE;
BEGIN
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF lower(COALESCE(v_payment.payment_type, '')) NOT IN ('rent', 'monthly') THEN
    RAISE EXCEPTION 'PAYMENT_TYPE_NOT_RENT';
  END IF;

  IF lower(COALESCE(v_payment.payment_status, v_payment.status::text, '')) NOT IN ('paid', 'completed', 'success', 'authorized') THEN
    RAISE EXCEPTION 'RENT_PAYMENT_NOT_SETTLED';
  END IF;

  v_booking := public.ensure_booking_rent_cycle_state(v_payment.booking_id);

  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = v_payment.booking_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = v_payment.booking_id
      AND p.id <> v_payment.id
      AND lower(COALESCE(p.payment_type, '')) IN ('monthly', 'rent')
      AND lower(COALESCE(p.payment_status, p.status::text, '')) IN ('paid', 'completed', 'success', 'authorized')
  )
  INTO v_has_prior_verified_monthly_payment;

  IF v_today < v_booking.next_due_date AND v_has_prior_verified_monthly_payment THEN
    RAISE EXCEPTION 'RENT_CYCLE_NOT_DUE';
  END IF;

  v_cycle_start := v_booking.current_cycle_start_date;
  v_next_due := v_booking.next_due_date;
  v_new_start := v_next_due;
  v_new_next_due := v_new_start + GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30));

  UPDATE public.bookings
  SET
    current_cycle_start_date = v_new_start,
    next_due_date = v_new_next_due,
    rent_payment_status = CASE
      WHEN v_new_next_due > v_today THEN 'not_due'
      ELSE 'paid'
    END,
    updated_at = timezone('utc', now())
  WHERE id = v_booking.id;

  UPDATE public.payments
  SET
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'cycle_covered_from', v_cycle_start::text,
      'cycle_covered_to', v_next_due::text,
      'cycle_start_date', v_cycle_start::text,
      'cycle_end_date', v_next_due::text,
      'cycle_duration_days', v_booking.cycle_duration_days,
      'next_due_date', v_next_due::text,
      'cycle_advanced', true,
      'cycle_advanced_at', timezone('utc', now()),
      'cycle_next_due_date', v_new_next_due::text
    ),
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'advanced', TRUE,
    'booking_id', v_booking.id,
    'payment_id', v_payment.id,
    'cycle_covered_from', v_cycle_start,
    'cycle_covered_to', v_next_due,
    'new_cycle_start_date', v_new_start,
    'new_next_due_date', v_new_next_due
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_due_rent_cycles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_today DATE := timezone('utc', now())::date;
  v_updated INTEGER := 0;
BEGIN
  UPDATE public.bookings
  SET
    rent_payment_status = CASE
      WHEN lower(COALESCE(status::text, '')) IN (
        'checked-out', 'checked_out', 'vacated', 'completed', 'cancelled',
        'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded'
      ) OR vacate_date IS NOT NULL
        THEN COALESCE(rent_payment_status, 'not_due')
      WHEN COALESCE(next_due_date, v_today + 1) <= v_today
        AND lower(COALESCE(rent_payment_status, '')) <> 'failed'
        THEN 'pending'
      WHEN COALESCE(next_due_date, v_today + 1) > v_today
        THEN 'not_due'
      ELSE COALESCE(rent_payment_status, 'not_due')
    END,
    updated_at = timezone('utc', now())
  WHERE lower(COALESCE(status::text, '')) IN ('accepted', 'approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN COALESCE(v_updated, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_booking_rent_cycle_state(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_rent_cycle(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_rent_cycle_on_payment(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_due_rent_cycles() TO authenticated, service_role;

SELECT public.sync_due_rent_cycles();

NOTIFY pgrst, 'reload schema';

COMMIT;
