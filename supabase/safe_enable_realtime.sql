-- =============================================================================
-- SAFE RE-ENABLE REALTIME FOR BOOKINGS (Updated)
-- =============================================================================
-- 1. Unsubscribe tables first (to avoid "already exists" error)
DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS bookings';
EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS payments';
EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS notifications';
EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS messages';
EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS chats';
EXCEPTION
WHEN OTHERS THEN -- If publication doesn't exist, ignore
NULL;
END $$;
-- 2. Add tables one by one (Ensures clean slate)
ALTER PUBLICATION supabase_realtime
ADD TABLE bookings;
ALTER PUBLICATION supabase_realtime
ADD TABLE payments;
ALTER PUBLICATION supabase_realtime
ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime
ADD TABLE messages;
ALTER PUBLICATION supabase_realtime
ADD TABLE chats;
-- 3. Ensure Replica Identity is 'FULL' for better tracking of old vs new data
ALTER TABLE bookings REPLICA IDENTITY FULL;
alter table payments REPLICA IDENTITY FULL;
-- 4. CONFIRMATION SELECT 
SELECT *
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';