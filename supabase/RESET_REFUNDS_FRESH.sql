-- FORCE RESET DATA (Handles "Unique Constraint" Errors)
-- Run this in Supabase SQL Editor.
BEGIN;
-- 1. Clear all existing refund records
DELETE FROM refunds;
-- 2. Smart Reset: Remove conflicts before resetting rejected bookings
DO $$
DECLARE r RECORD;
BEGIN -- Loop through all currently rejected bookings
FOR r IN
SELECT *
FROM bookings
WHERE status = 'rejected' LOOP -- Delete ANY other active booking for this user/property that blocks the reset
    -- (e.g. if you made a new request after the rejection)
DELETE FROM bookings
WHERE customer_id = r.customer_id
    AND property_id = r.property_id
    AND status IN (
        'requested',
        'approved',
        'payment_pending',
        'paid'
    )
    AND id != r.id;
-- Now reset the rejected booking back to requested
UPDATE bookings
SET status = 'requested',
    rejection_reason = NULL
WHERE id = r.id;
END LOOP;
END $$;
COMMIT;