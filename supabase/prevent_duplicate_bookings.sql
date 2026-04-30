-- Migration: Prevent Multiple Active Bookings in Same PG (Robust Version)
-- Role: Senior Backend Engineer & System Architect
-- 1. ENSURE ALL COLUMNS EXIST
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS vacate_date DATE;
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS stay_status TEXT DEFAULT 'ongoing';
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS room_number TEXT;
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(10, 2) DEFAULT 20.00;
-- 2. UPDATE STATUS CONSTRAINT
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings
ADD CONSTRAINT bookings_status_check CHECK (
        status IN (
            'pending',
            'approved',
            'rejected',
            'cancelled',
            'checked-in',
            'checked-out',
            'completed',
            'BOOKED',
            'ACTIVE',
            'ONGOING',
            'requested',
            'checked_in',
            'checked_out'
        )
    );
-- 3. UNIQUE INDEX FOR CONFLICT PREVENTION
DROP INDEX IF EXISTS unique_active_pg_booking;
CREATE UNIQUE INDEX unique_active_pg_booking ON bookings (customer_id, property_id)
WHERE (
        vacate_date IS NULL
        AND status IN (
            'pending',
            'approved',
            'checked-in',
            'checked_in',
            'BOOKED',
            'ACTIVE',
            'ONGOING',
            'requested'
        )
    );
-- 4. ATOMIC BOOKING FUNCTION (SAFE)
CREATE OR REPLACE FUNCTION create_booking_safe_v3(
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
IF NOT p_override THEN
SELECT id INTO v_existing_id
FROM bookings
WHERE customer_id = p_customer_id
    AND property_id = p_property_id
    AND vacate_date IS NULL
    AND status IN (
        'pending',
        'approved',
        'checked-in',
        'checked_in',
        'BOOKED',
        'ACTIVE',
        'ONGOING',
        'requested'
    )
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
        'paid',
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
-- PERMISSIONS
GRANT EXECUTE ON FUNCTION create_booking_safe_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION create_booking_safe_v3 TO service_role;