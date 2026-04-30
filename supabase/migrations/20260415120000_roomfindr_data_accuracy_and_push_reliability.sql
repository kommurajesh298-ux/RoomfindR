BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_id_unique
  ON public.notifications (
    user_id,
    (data ->> 'event_id')
  )
  WHERE NULLIF(BTRIM(COALESCE(data ->> 'event_id', '')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.calculate_booking_duration_months(
  p_anchor DATE,
  p_end DATE
) RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_months INTEGER := 1;
BEGIN
  IF p_anchor IS NULL OR p_end IS NULL OR p_end <= p_anchor THEN
    RETURN 1;
  END IF;

  v_months := (
    (EXTRACT(YEAR FROM age(p_end, p_anchor))::INTEGER * 12)
    + EXTRACT(MONTH FROM age(p_end, p_anchor))::INTEGER
    + CASE
        WHEN EXTRACT(DAY FROM p_end) > EXTRACT(DAY FROM p_anchor) THEN 1
        ELSE 0
      END
  );

  RETURN GREATEST(1, COALESCE(v_months, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_booking_rent_coverage(p_booking_id UUID)
RETURNS TABLE (
  booking_id UUID,
  effective_cycle_start_date DATE,
  effective_next_due_date DATE,
  covered_through_date DATE,
  covered_through_month TEXT,
  current_cycle_month TEXT,
  is_current_cycle_settled BOOLEAN,
  is_prepaid_full_stay BOOLEAN,
  settled_monthly_payments INTEGER,
  rent_status TEXT,
  can_pay_rent BOOLEAN,
  recommended_rent_payment_status TEXT,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_today DATE := timezone('utc', now())::date;
  v_anchor DATE;
  v_cycle_duration INTEGER := 30;
  v_duration_months INTEGER := 1;
  v_is_closed BOOLEAN := FALSE;
  v_is_full_paid BOOLEAN := FALSE;
  v_settled_monthly_payments INTEGER := 0;
  v_effective_cycle_start DATE;
  v_effective_next_due DATE;
  v_covered_through DATE;
  v_status TEXT := 'due';
  v_can_pay BOOLEAN := TRUE;
  v_rent_payment_status TEXT := 'pending';
  v_message TEXT := '';
BEGIN
  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  v_anchor := COALESCE(v_booking.start_date, v_booking.current_cycle_start_date, v_today);
  v_cycle_duration := GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30));
  v_duration_months := public.calculate_booking_duration_months(v_anchor, v_booking.end_date);

  v_is_closed := lower(COALESCE(v_booking.status::text, '')) IN (
      'checked-out', 'checked_out', 'vacated', 'completed', 'cancelled',
      'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded'
    )
    OR lower(COALESCE(v_booking.stay_status, '')) = 'vacated'
    OR v_booking.vacate_date IS NOT NULL;

  SELECT COUNT(*)::INTEGER
  INTO v_settled_monthly_payments
  FROM public.payments p
  WHERE p.booking_id = v_booking.id
    AND lower(COALESCE(p.payment_type, '')) IN ('monthly', 'rent', 'monthly_rent')
    AND (
      lower(COALESCE(p.status::text, '')) IN ('paid', 'completed', 'success', 'authorized')
      OR lower(COALESCE(p.payment_status, '')) IN ('paid', 'completed', 'success', 'authorized')
    );

  v_is_full_paid := lower(COALESCE(v_booking.payment_type, '')) = 'full'
    AND lower(COALESCE(v_booking.payment_status, '')) IN ('paid', 'completed', 'success', 'authorized');

  IF v_is_closed THEN
    RETURN QUERY
    SELECT
      v_booking.id,
      NULL::DATE,
      NULL::DATE,
      NULL::DATE,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      FALSE,
      v_settled_monthly_payments,
      'closed'::TEXT,
      FALSE,
      'not_due'::TEXT,
      'Rent cycle is closed.'::TEXT;
    RETURN;
  END IF;

  IF v_is_full_paid THEN
    v_effective_cycle_start := v_anchor;
    v_effective_next_due := (v_anchor + make_interval(months => GREATEST(1, v_duration_months)))::date;
    v_covered_through := v_effective_next_due;

    IF v_today > v_effective_next_due THEN
      v_status := 'overdue';
      v_can_pay := TRUE;
      v_rent_payment_status := 'pending';
      v_message := format(
        'Full-stay coverage ended on %s. The next rent cycle is overdue.',
        to_char(v_effective_next_due, 'DD Mon YYYY')
      );
    ELSIF v_today = v_effective_next_due THEN
      v_status := 'due';
      v_can_pay := TRUE;
      v_rent_payment_status := 'pending';
      v_message := format(
        'Full-stay coverage ends today on %s. The next rent window is open.',
        to_char(v_effective_next_due, 'DD Mon YYYY')
      );
    ELSE
      v_status := 'active';
      v_can_pay := FALSE;
      v_rent_payment_status := 'not_due';
      v_message := format(
        'This booking is prepaid in full through %s.',
        to_char(v_effective_next_due, 'DD Mon YYYY')
      );
    END IF;

    RETURN QUERY
    SELECT
      v_booking.id,
      v_effective_cycle_start,
      v_effective_next_due,
      v_covered_through,
      to_char(v_effective_next_due - 1, 'YYYY-MM'),
      to_char(v_effective_cycle_start, 'YYYY-MM'),
      v_today < v_effective_next_due,
      TRUE,
      v_settled_monthly_payments,
      v_status,
      v_can_pay,
      v_rent_payment_status,
      v_message;
    RETURN;
  END IF;

  v_effective_cycle_start := (
    v_anchor
    + (GREATEST(v_settled_monthly_payments - 1, 0) * make_interval(days => v_cycle_duration))
  )::date;
  v_effective_next_due := (
    v_anchor
    + (GREATEST(v_settled_monthly_payments, 1) * make_interval(days => v_cycle_duration))
  )::date;
  v_covered_through := v_effective_next_due;

  IF v_today > v_effective_next_due THEN
    v_status := 'overdue';
    v_can_pay := TRUE;
    v_rent_payment_status := 'pending';
    v_message := format(
      'Rent payment is overdue since %s.',
      to_char(v_effective_next_due, 'DD Mon YYYY')
    );
  ELSIF v_today = v_effective_next_due THEN
    v_status := 'due';
    v_can_pay := TRUE;
    v_rent_payment_status := 'pending';
    v_message := format(
      'Rent payment is due today on %s.',
      to_char(v_effective_next_due, 'DD Mon YYYY')
    );
  ELSIF v_settled_monthly_payments > 0 THEN
    v_status := 'active';
    v_can_pay := FALSE;
    v_rent_payment_status := 'not_due';
    v_message := format(
      'The current rent cycle is settled through %s.',
      to_char(v_effective_next_due, 'DD Mon YYYY')
    );
  ELSE
    v_status := 'due';
    v_can_pay := TRUE;
    v_rent_payment_status := 'pending';
    v_message := format(
      'The first rent cycle is open and will be due on %s.',
      to_char(v_effective_next_due, 'DD Mon YYYY')
    );
  END IF;

  RETURN QUERY
  SELECT
    v_booking.id,
    v_effective_cycle_start,
    v_effective_next_due,
    v_covered_through,
    to_char(v_effective_next_due - 1, 'YYYY-MM'),
    to_char(v_effective_cycle_start, 'YYYY-MM'),
    (v_settled_monthly_payments > 0 AND v_today < v_effective_next_due),
    FALSE,
    v_settled_monthly_payments,
    v_status,
    v_can_pay,
    v_rent_payment_status,
    v_message;
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
  v_coverage RECORD;
BEGIN
  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF auth.uid() IS NOT NULL
     AND v_booking.customer_id <> auth.uid()
     AND v_booking.owner_id <> auth.uid()
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT *
  INTO v_coverage
  FROM public.resolve_booking_rent_coverage(p_booking_id);

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'current_cycle_start_date', v_booking.current_cycle_start_date,
    'cycle_end_date', v_coverage.effective_next_due_date,
    'next_due_date', v_booking.next_due_date,
    'effective_cycle_start_date', v_coverage.effective_cycle_start_date,
    'effective_next_due_date', v_coverage.effective_next_due_date,
    'covered_through_date', v_coverage.covered_through_date,
    'covered_through_month', v_coverage.covered_through_month,
    'current_cycle_month', v_coverage.current_cycle_month,
    'is_current_cycle_settled', v_coverage.is_current_cycle_settled,
    'is_prepaid_full_stay', v_coverage.is_prepaid_full_stay,
    'cycle_duration_days', GREATEST(1, COALESCE(v_booking.cycle_duration_days, 30)),
    'server_date', timezone('utc', now())::date,
    'status', v_coverage.rent_status,
    'can_pay_rent', v_coverage.can_pay_rent,
    'message', v_coverage.message
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
  v_coverage RECORD;
BEGIN
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF lower(COALESCE(v_payment.payment_type, '')) NOT IN ('rent', 'monthly', 'monthly_rent') THEN
    RAISE EXCEPTION 'PAYMENT_TYPE_NOT_RENT';
  END IF;

  IF NOT (
    lower(COALESCE(v_payment.status::text, '')) IN ('paid', 'completed', 'success', 'authorized')
    OR lower(COALESCE(v_payment.payment_status, '')) IN ('paid', 'completed', 'success', 'authorized')
  ) THEN
    RAISE EXCEPTION 'RENT_PAYMENT_NOT_SETTLED';
  END IF;

  SELECT *
  INTO v_coverage
  FROM public.resolve_booking_rent_coverage(v_payment.booking_id);

  UPDATE public.bookings
  SET
    current_cycle_start_date = v_coverage.effective_cycle_start_date,
    next_due_date = v_coverage.effective_next_due_date,
    rent_payment_status = v_coverage.recommended_rent_payment_status,
    rent_cycle_closed_at = NULL,
    updated_at = timezone('utc', now())
  WHERE id = v_payment.booking_id;

  UPDATE public.payments
  SET
    payment_status = lower(COALESCE(status::text, payment_status, 'completed')),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'cycle_covered_from', v_coverage.effective_cycle_start_date::text,
      'cycle_covered_to', v_coverage.effective_next_due_date::text,
      'cycle_start_date', v_coverage.effective_cycle_start_date::text,
      'cycle_end_date', v_coverage.effective_next_due_date::text,
      'cycle_advanced', true,
      'cycle_advanced_at', timezone('utc', now()),
      'cycle_next_due_date', v_coverage.effective_next_due_date::text
    ),
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'advanced', TRUE,
    'booking_id', v_payment.booking_id,
    'payment_id', v_payment.id,
    'new_cycle_start_date', v_coverage.effective_cycle_start_date,
    'new_next_due_date', v_coverage.effective_next_due_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_room_occupancy(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity INTEGER;
  v_property_id UUID;
  v_active_count INTEGER := 0;
  v_booked_count INTEGER := 0;
  v_room_rows INTEGER := 0;
BEGIN
  IF p_room_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    GREATEST(1, COALESCE(r.capacity, 1)),
    r.property_id
  INTO v_capacity, v_property_id
  FROM public.rooms r
  WHERE r.id = p_room_id
  LIMIT 1;

  IF v_capacity IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_active_count
  FROM public.bookings b
  WHERE b.room_id = p_room_id
    AND b.vacate_date IS NULL
    AND lower(COALESCE(b.status::TEXT, '')) NOT IN (
      'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded',
      'checked-out', 'checked_out', 'vacated', 'completed', 'expired', 'failed', 'payment_failed'
    )
    AND lower(COALESCE(b.status::TEXT, '')) IN (
      'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested', 'vacate-requested'
    );

  v_booked_count := LEAST(GREATEST(0, COALESCE(v_active_count, 0)), v_capacity);

  UPDATE public.rooms
  SET
    booked_count = v_booked_count,
    is_available = (v_booked_count < v_capacity)
  WHERE id = p_room_id;

  IF v_property_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_room_rows
  FROM public.rooms
  WHERE property_id = v_property_id;

  IF COALESCE(v_room_rows, 0) = 0 THEN
    UPDATE public.properties
    SET
      rooms_available = 0,
      total_rooms = 0
    WHERE id = v_property_id;
    RETURN;
  END IF;

  UPDATE public.properties p
  SET
    rooms_available = stats.total_available,
    total_rooms = stats.total_capacity
  FROM (
    SELECT
      r.property_id,
      COALESCE(SUM(GREATEST(1, COALESCE(r.capacity, 1))), 0)::INTEGER AS total_capacity,
      COALESCE(SUM(
        GREATEST(
          0,
          GREATEST(1, COALESCE(r.capacity, 1)) - LEAST(
            GREATEST(0, COALESCE(r.booked_count, 0)),
            GREATEST(1, COALESCE(r.capacity, 1))
          )
        )
      ), 0)::INTEGER AS total_available
    FROM public.rooms r
    WHERE r.property_id = v_property_id
    GROUP BY r.property_id
  ) stats
  WHERE p.id = stats.property_id;
END;
$$;

DO $$
DECLARE
  v_room_id UUID;
BEGIN
  FOR v_room_id IN (SELECT id FROM public.rooms) LOOP
    PERFORM public.recalculate_room_occupancy(v_room_id);
  END LOOP;
END;
$$;

-- Hosted projects can carry legacy booking triggers that reject bulk rent-cycle rewrites.
-- Runtime APIs now resolve effective coverage on demand, so this migration keeps the durable
-- computation logic while leaving any row-level backfill to targeted follow-up maintenance.

GRANT EXECUTE ON FUNCTION public.calculate_booking_duration_months(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_booking_rent_coverage(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_rent_cycle(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_rent_cycle_on_payment(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
