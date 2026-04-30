-- List all triggers on the 'properties' table
SELECT trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'properties';