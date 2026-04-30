-- =============================================================================
-- DASHBOARD REALTIME & VACANCY SYNC UPGRADE
-- =============================================================================
-- 1. ADD PROPERTIES & ROOMS TO REALTIME PUBLICATION
-- This ensures the Dashboard auto-updates when properties or rooms change
DO $$ BEGIN -- Add properties if not exists
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND tablename = 'properties'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE properties;
END IF;
-- Add rooms if not exists
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND tablename = 'rooms'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE rooms;
END IF;
END $$;
-- 2. SET REPLICA IDENTITY TO FULL
ALTER TABLE properties REPLICA IDENTITY FULL;
ALTER TABLE rooms REPLICA IDENTITY FULL;
-- 3. AUTO-SYNC VACANCIES TRIGGER
-- This automatically updates the 'rooms_available' count in the properties table
-- whenever a room's occupancy changes.
CREATE OR REPLACE FUNCTION sync_property_vacancies() RETURNS TRIGGER AS $$ BEGIN -- Update the parent property's rooms_available and total_rooms
UPDATE properties
SET rooms_available = (
        SELECT COALESCE(SUM(capacity - booked_count), 0)
        FROM rooms
        WHERE property_id = COALESCE(NEW.property_id, OLD.property_id)
    ),
    total_rooms = (
        SELECT COALESCE(SUM(capacity), 0)
        FROM rooms
        WHERE property_id = COALESCE(NEW.property_id, OLD.property_id)
    )
WHERE id = COALESCE(NEW.property_id, OLD.property_id);
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Apply trigger to rooms table
DROP TRIGGER IF EXISTS trigger_sync_vacancies ON rooms;
CREATE TRIGGER trigger_sync_vacancies
AFTER
INSERT
    OR
UPDATE
    OR DELETE ON rooms FOR EACH ROW EXECUTE FUNCTION sync_property_vacancies();
-- 4. INITIAL SYNC (Run once to fix existing data)
UPDATE properties p
SET rooms_available = (
        SELECT COALESCE(SUM(capacity - booked_count), 0)
        FROM rooms
        WHERE property_id = p.id
    ),
    total_rooms = (
        SELECT COALESCE(SUM(capacity), 0)
        FROM rooms
        WHERE property_id = p.id
    );