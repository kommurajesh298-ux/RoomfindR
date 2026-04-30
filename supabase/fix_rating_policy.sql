-- Fix RLS policy for ratings to allow 'checked-in' status
-- The previous policy only checked for 'checked_in' (underscore), but the app uses 'checked-in' (hyphen)
DROP POLICY IF EXISTS "Customers can create ratings for their own bookings" ON ratings;
CREATE POLICY "Customers can create ratings for their own bookings" ON ratings FOR
INSERT WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1
            FROM bookings
            WHERE id = booking_id
                AND customer_id = auth.uid()
                AND (
                    status = 'checked_in'
                    OR status = 'checked-in'
                )
        )
    );