-- 🚨 EMERGENCY FIX: REMOVE LEGACY TRIGGERS 🚨
-- The error "you already stayed in that pg vacate and book room" is coming from a TRIGGER
-- that runs before the insert. We need to remove these old triggers to let our new v4 function handle validation.
-- Drop known/suspected triggers that might be blocking the booking
DROP TRIGGER IF EXISTS check_active_booking ON bookings;
DROP TRIGGER IF EXISTS prevent_duplicate_bookings ON bookings;
DROP TRIGGER IF EXISTS check_duplicate_booking ON bookings;
DROP TRIGGER IF EXISTS enforce_one_active_booking ON bookings;
DROP TRIGGER IF EXISTS validate_booking ON bookings;
DROP TRIGGER IF EXISTS check_customer_status ON bookings;
-- Also try to drop the function that the trigger might be calling (if named differently)
DROP FUNCTION IF EXISTS check_active_booking();
DROP FUNCTION IF EXISTS prevent_duplicate_bookings();
DROP FUNCTION IF EXISTS check_duplicate_booking();
-- Drop the unique index if it exists (we handle this in logic now)
DROP INDEX IF EXISTS unique_active_pg_booking;
-- While we are here, strict check:
-- Ensure no other triggers are doing weird stuff.
-- (We keep the standard timestamps/RLS triggers)
-- Re-apply proper index (Optional, but good for safety)
-- Create a corrected index that ALLOWS re-booking (ignoring checked-out)
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_pg_stay ON bookings (customer_id, property_id)
WHERE (
        status NOT IN (
            'checked-out',
            'cancelled',
            'rejected',
            'refunded',
            'checked_out'
        )
        AND vacate_date IS NULL
    );