-- =============================================================================
-- ENABLE REALTIME FOR BOOKINGS (Fixes Auto-Update Issue)
-- =============================================================================
-- 1. Enable Realtime on the bookings table
ALTER PUBLICATION supabase_realtime
ADD TABLE bookings;
-- 2. Also enable for payments and notifications for a complete live experience
ALTER PUBLICATION supabase_realtime
ADD TABLE payments;
ALTER PUBLICATION supabase_realtime
ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime
ADD TABLE messages;
ALTER PUBLICATION supabase_realtime
ADD TABLE chats;
-- 3. Ensure Replica Identity is 'FULL' for better tracking of old vs new data
-- (Needed for complex status updates)
ALTER TABLE bookings REPLICA IDENTITY FULL;
ALTER TABLE payments REPLICA IDENTITY FULL;
-- 4. Verify Publication Status (Run this to check)
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';