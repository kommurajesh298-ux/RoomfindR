BEGIN;

CREATE OR REPLACE FUNCTION public.create_booking_v4(
  p_property_id UUID,
  p_room_id UUID,
  p_customer_id UUID,
  p_owner_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_monthly_rent NUMERIC,
  p_advance_paid NUMERIC,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_room_number TEXT,
  p_payment_type TEXT,
  p_transaction_id TEXT,
  p_amount_paid NUMERIC,
  p_duration_months INTEGER,
  p_amount_due NUMERIC,
  p_booking_key TEXT,
  p_override BOOLEAN,
  p_stay_type TEXT,
  p_selected_months INTEGER,
  p_selected_days INTEGER,
  p_total_rent NUMERIC,
  p_valid_till DATE,
  p_booking_status TEXT,
  p_portal_access BOOLEAN,
  p_continue_status TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_key TEXT := NULLIF(trim(COALESCE(p_booking_key, '')), '');
  v_existing_id UUID;
  v_result JSONB;
  v_booking_id UUID;
  v_capacity INTEGER;
  v_active_count INTEGER;
BEGIN
  IF v_booking_key IS NULL AND NULLIF(trim(COALESCE(p_transaction_id, '')), '') IS NOT NULL THEN
    v_booking_key := trim(p_transaction_id);
  END IF;

  IF v_booking_key IS NOT NULL THEN
    SELECT id
    INTO v_existing_id
    FROM public.bookings
    WHERE booking_key = v_booking_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_existing_id,
        'idempotent', true
      );
    END IF;
  END IF;

  IF p_room_id IS NOT NULL THEN
    SELECT capacity
    INTO v_capacity
    FROM public.rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF v_capacity IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;

    SELECT COUNT(*)
    INTO v_active_count
    FROM public.bookings
    WHERE room_id = p_room_id
      AND vacate_date IS NULL
      AND lower(COALESCE(status::text, '')) NOT IN (
        'cancelled',
        'cancelled_by_customer',
        'cancelled-by-customer',
        'rejected',
        'refunded',
        'checked-out',
        'checked_out',
        'vacated',
        'completed'
      );

    IF v_active_count >= GREATEST(1, COALESCE(v_capacity, 1)) THEN
      RAISE EXCEPTION 'ROOM_FULL';
    END IF;
  END IF;

  v_result := public.create_booking_v4_legacy(
    p_property_id,
    p_room_id,
    p_customer_id,
    p_owner_id,
    p_start_date,
    p_end_date,
    p_monthly_rent,
    p_advance_paid,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_room_number,
    p_payment_type,
    p_transaction_id,
    p_amount_paid,
    p_duration_months,
    p_override
  );

  v_booking_id := NULLIF(v_result ->> 'booking_id', '')::UUID;

  IF v_booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET
      amount_due = COALESCE(p_amount_due, amount_due, p_advance_paid, p_monthly_rent),
      booking_key = COALESCE(v_booking_key, booking_key),
      stay_type = COALESCE(NULLIF(trim(COALESCE(p_stay_type, '')), ''), stay_type),
      selected_months = COALESCE(p_selected_months, selected_months),
      selected_days = COALESCE(p_selected_days, selected_days),
      total_rent = COALESCE(p_total_rent, total_rent),
      valid_till = COALESCE(p_valid_till, valid_till),
      booking_status = COALESCE(NULLIF(trim(COALESCE(p_booking_status, '')), ''), booking_status),
      portal_access = COALESCE(p_portal_access, portal_access, FALSE),
      continue_status = COALESCE(NULLIF(trim(COALESCE(p_continue_status, '')), ''), continue_status),
      updated_at = NOW()
    WHERE id = v_booking_id;
  END IF;

  RETURN COALESCE(v_result, jsonb_build_object('success', false));
EXCEPTION
WHEN unique_violation THEN
  IF v_booking_key IS NOT NULL THEN
    SELECT id
    INTO v_existing_id
    FROM public.bookings
    WHERE booking_key = v_booking_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_existing_id,
        'idempotent', true
      );
    END IF;
  END IF;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_v4(
  UUID,
  UUID,
  UUID,
  UUID,
  DATE,
  DATE,
  NUMERIC,
  NUMERIC,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  INTEGER,
  NUMERIC,
  TEXT,
  BOOLEAN,
  TEXT,
  INTEGER,
  INTEGER,
  NUMERIC,
  DATE,
  TEXT,
  BOOLEAN,
  TEXT
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
