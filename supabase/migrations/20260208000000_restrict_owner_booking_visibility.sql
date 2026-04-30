-- Update bookings RLS policy to restrict owner visibility to paid bookings only
-- This ensures owners don't see bookings until payment is confirmed
DROP POLICY IF EXISTS "Customers can view own bookings" ON bookings;
CREATE POLICY "Customers can view own bookings" ON bookings FOR
SELECT USING (
        customer_id = auth.uid()
        OR (
            owner_id = auth.uid()
            AND (
                payment_status::text = 'paid'
                OR payment_status::text = 'refunded'
            )
        )
        OR public.is_admin(auth.uid())
    );
-- Note: We use ::text because payment_status is an enum in the latest schema;
