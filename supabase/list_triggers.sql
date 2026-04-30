-- 🔍 DIAGNOSTIC SCRIPT: List All Triggers on Bookings Table
-- Run this in Supabase SQL Editor to see what triggers are active.
SELECT trigger_schema,
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'bookings';
-- Also check for any unusual functions that might be called
SELECT proname as function_name,
    prosrc as source_code
FROM pg_proc
WHERE prosrc ILIKE '%vacate and book room%';