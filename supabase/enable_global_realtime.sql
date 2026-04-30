-- =============================================================================
-- GLOBAL REAL-TIME ENGINE ENABLE
-- =============================================================================
-- 1. Create or verify the publication
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
) THEN CREATE PUBLICATION supabase_realtime;
END IF;
END $$;
-- 2. Add ALL mandatory tables to the publication
-- This allows any change in these tables to be broadcasted to all connected clients
DO $$
DECLARE table_name TEXT;
target_tables TEXT [] := ARRAY [
        'accounts',
        'customers',
        'owners',
        'admins',
        'properties',
        'rooms',
        'bookings',
        'payments',
        'settlements',
        'wallets',
        'notifications',
        'messages',
        'chats',
        'notices',
        'food_menu'
    ];
BEGIN FOREACH table_name IN ARRAY target_tables LOOP -- Add to publication if not already there
IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = table_name
        AND table_schema = 'public'
) THEN BEGIN EXECUTE format(
    'ALTER PUBLICATION supabase_realtime ADD TABLE %I',
    table_name
);
EXCEPTION
WHEN duplicate_object THEN -- Table already in publication, ignore
END;
-- Set Replica Identity to FULL for ALL tables
-- This ensures we get both the OLD and NEW data in every event (crucial for state updates)
EXECUTE format(
    'ALTER TABLE %I REPLICA IDENTITY FULL',
    table_name
);
END IF;
END LOOP;
END $$;
-- 3. Verify Publication Status
SELECT *
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';