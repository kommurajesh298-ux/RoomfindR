-- v4: FINAL FIX for Booking Logic
-- We renamed the function to 'create_booking_v4' to avoid any conflicts with old versions.
-- This function correctly handles re-booking by ignoring 'checked-out' records.
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
DECLARE v_existing_id UUID;
v_new_booking_id UUID;
BEGIN -- 🧠 CONFLICT CHECK
-- Only block if there is an ACTIVE stay.
-- An active stay is defined as:
-- 1. Same Customer + Same Property
-- 2. Status is NOT 'checked-out', 'cancelled', 'rejected'
-- 3. Vacate Date is NULL 
IF NOT p_override THEN
SELECT id INTO v_existing_id
FROM bookings
WHERE customer_id = p_customer_id
    AND property_id = p_property_id -- CRITICAL FIX: Explicitly exclude checked-out/cancelled
    AND status NOT IN (
        'checked-out',
        'cancelled',
        'rejected',
        'refunded',
        'checked_out'
    ) -- AND ensure they haven't set a vacate date
    AND vacate_date IS NULL
LIMIT 1;
IF v_existing_id IS NOT NULL THEN RAISE EXCEPTION 'ACTIVE_PG_BOOKING_EXISTS: You are already staying in this PG. Please vacate your current room before booking another one.';
END IF;
END IF;
-- 🔁 INSERTION
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
    )
VALUES (
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
    )
RETURNING id INTO v_new_booking_id;
RETURN jsonb_build_object(
    'success',
    true,
    'booking_id',
    v_new_booking_id
);
EXCEPTION
WHEN unique_violation THEN RAISE EXCEPTION 'ACTIVE_PG_BOOKING_EXISTS: You are already staying in this PG. Please vacate your current room before booking another one.';
WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Grant permissions to ensure the app can call it
GRANT EXECUTE ON FUNCTION create_booking_v4 TO authenticated;
GRANT EXECUTE ON FUNCTION create_booking_v4 TO service_role;