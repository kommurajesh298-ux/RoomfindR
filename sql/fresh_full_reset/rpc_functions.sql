-- RoomFindR RPC Functions (run AFTER full_reset.sql)
-- Includes: create_booking_v4, cancel_booking_v2, get_resident_roommates

SET search_path = public;

-- Create booking (v4)
CREATE OR REPLACE FUNCTION create_booking_v4(
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
  p_override BOOLEAN DEFAULT FALSE
) RETURNS JSONB AS $$
DECLARE
  v_existing_id UUID;
  v_new_booking_id UUID;
BEGIN
  IF NOT p_override THEN
    SELECT id INTO v_existing_id
    FROM bookings
    WHERE customer_id = p_customer_id
      AND property_id = p_property_id
      AND status NOT IN ('checked-out','cancelled','rejected','refunded','checked_out')
      AND vacate_date IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'ACTIVE_PG_BOOKING_EXISTS: You are already staying in this PG. Please vacate your current room before booking another one.';
    END IF;
  END IF;

  INSERT INTO bookings (
    property_id,
    room_id,
    customer_id,
    owner_id,
    start_date,
    end_date,
    monthly_rent,
    advance_paid,
    customer_name,
    customer_phone,
    customer_email,
    status,
    stay_status,
    room_number,
    payment_status,
    transaction_id,
    amount_paid,
    payment_type,
    commission_amount,
    created_at,
    updated_at
  ) VALUES (
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
    'requested',
    'ongoing',
    p_room_number,
    'pending',
    p_transaction_id,
    p_amount_paid,
    p_payment_type,
    20.00,
    NOW(),
    NOW()
  ) RETURNING id INTO v_new_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', v_new_booking_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ACTIVE_PG_BOOKING_EXISTS: You are already staying in this PG. Please vacate your current room before booking another one.';
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_booking_v4 TO authenticated;
GRANT EXECUTE ON FUNCTION create_booking_v4 TO service_role;

-- Cancel booking (v2)
CREATE OR REPLACE FUNCTION cancel_booking_v2(
  p_booking_id UUID,
  p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  v_rowcount INTEGER;
BEGIN
  UPDATE bookings
  SET status = 'cancelled',
      cancelled_at = NOW(),
      rejection_reason = COALESCE(p_reason, 'Cancelled by user'),
      updated_at = NOW()
  WHERE id = p_booking_id
  RETURNING 1 INTO v_rowcount;

  IF v_rowcount IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cancel_booking_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_booking_v2 TO service_role;

-- Get roommates (safe bridge for client)
CREATE OR REPLACE FUNCTION get_resident_roommates(
  p_property_id UUID
) RETURNS TABLE (
  booking_id UUID,
  customer_id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  status TEXT,
  room_id UUID,
  room_number TEXT,
  property_id UUID
) AS $$
  SELECT
    b.id,
    b.customer_id,
    b.customer_name,
    b.customer_phone,
    b.status::TEXT,
    b.room_id,
    b.room_number,
    b.property_id
  FROM bookings b
  WHERE b.property_id = p_property_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_resident_roommates TO authenticated;
GRANT EXECUTE ON FUNCTION get_resident_roommates TO service_role;
