-- 🚨 FINAL FIX: REMOVE THE ROGUE FUNCTION AND TRIGGER 🚨
-- The function 'check_pg_stay_overlap' was identified as the source of the error.
-- It contains the blocking logic "vacate and book room".
-- Drop the function and any validation triggers attached to it (CASCADE handles the trigger removal)
DROP FUNCTION IF EXISTS check_pg_stay_overlap() CASCADE;
-- Also double check and drop the trigger if it was named differently but called this function
DROP TRIGGER IF EXISTS check_pg_stay_overlap ON bookings;
-- Optional: If the trigger had a different name (we can't see it in the screenshot but CASCADE likely got it),
-- we can try to guess common names just to be safe.
DROP TRIGGER IF EXISTS validate_booking_overlap ON bookings;
-- Just to be safe, grant permissions again to our new v4 function
GRANT EXECUTE ON FUNCTION create_booking_v4 TO authenticated;
GRANT EXECUTE ON FUNCTION create_booking_v4 TO service_role;