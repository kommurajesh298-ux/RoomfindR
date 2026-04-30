BEGIN;

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

  v_is_closed := lower(NULLIF(BTRIM(COALESCE(v_booking.status::text, '')), '')) IN (
      'checked-out', 'checked_out', 'vacated', 'completed', 'cancelled',
      'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded'
    )
    OR lower(NULLIF(BTRIM(COALESCE(v_booking.stay_status::text, '')), '')) = 'vacated'
    OR v_booking.vacate_date IS NOT NULL;

  SELECT COUNT(*)::INTEGER
  INTO v_settled_monthly_payments
  FROM public.payments p
  WHERE p.booking_id = v_booking.id
    AND lower(NULLIF(BTRIM(COALESCE(p.payment_type::text, '')), '')) IN ('monthly', 'rent', 'monthly_rent')
    AND (
      lower(NULLIF(BTRIM(COALESCE(p.status::text, '')), '')) IN ('paid', 'completed', 'success', 'authorized')
      OR lower(NULLIF(BTRIM(COALESCE(p.payment_status::text, '')), '')) IN ('paid', 'completed', 'success', 'authorized')
    );

  v_is_full_paid := lower(NULLIF(BTRIM(COALESCE(v_booking.payment_type::text, '')), '')) = 'full'
    AND lower(NULLIF(BTRIM(COALESCE(v_booking.payment_status::text, '')), '')) IN ('paid', 'completed', 'success', 'authorized');

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

  IF lower(NULLIF(BTRIM(COALESCE(v_payment.payment_type::text, '')), '')) NOT IN ('rent', 'monthly', 'monthly_rent') THEN
    RAISE EXCEPTION 'PAYMENT_TYPE_NOT_RENT';
  END IF;

  IF NOT (
    lower(NULLIF(BTRIM(COALESCE(v_payment.status::text, '')), '')) IN ('paid', 'completed', 'success', 'authorized')
    OR lower(NULLIF(BTRIM(COALESCE(v_payment.payment_status::text, '')), '')) IN ('paid', 'completed', 'success', 'authorized')
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
    payment_status = lower(COALESCE(status::text, payment_status::text, 'completed')),
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

GRANT EXECUTE ON FUNCTION public.resolve_booking_rent_coverage(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_rent_cycle_on_payment(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
