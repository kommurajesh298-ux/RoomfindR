-- Helper RPCs for RoomFindR
-- Run this to fix missing check-in/out functionality
-- Function to increment room booked count
CREATE OR REPLACE FUNCTION increment_room_occupancy(room_id UUID) RETURNS VOID AS $$ BEGIN
UPDATE rooms
SET booked_count = booked_count + 1,
    is_available = CASE
        WHEN booked_count + 1 >= capacity THEN FALSE
        ELSE TRUE
    END
WHERE id = room_id;
END;
$$ LANGUAGE plpgsql;
-- Function to decrement room booked count
CREATE OR REPLACE FUNCTION decrement_room_occupancy(room_id UUID) RETURNS VOID AS $$ BEGIN
UPDATE rooms
SET booked_count = GREATEST(0, booked_count - 1),
    is_available = TRUE
WHERE id = room_id;
END;
$$ LANGUAGE plpgsql;
-- Grant execute permissions (if needed, usually public by default in supabase for authenticated)
GRANT EXECUTE ON FUNCTION increment_room_occupancy TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_room_occupancy TO authenticated;
GRANT EXECUTE ON FUNCTION increment_room_occupancy TO service_role;
GRANT EXECUTE ON FUNCTION decrement_room_occupancy TO service_role;