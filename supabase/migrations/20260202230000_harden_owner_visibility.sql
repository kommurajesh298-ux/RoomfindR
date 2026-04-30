-- Harden Booking Visibility for Owners
-- Owners should only see bookings after payment is confirmed
BEGIN;
-- 1. Redefine the SELECT policy for bookings
DROP POLICY IF EXISTS "Customers can view own bookings" ON bookings;
DROP POLICY IF EXISTS "Booking visibility policy v2" ON bookings;
CREATE POLICY "Booking visibility policy v2" ON bookings FOR
SELECT USING (
        -- Admins can see everything
        public.is_admin(auth.uid())
        OR -- Customers can see their own bookings (including unpaid ones so they can pay)
        customer_id = auth.uid()
        OR -- Owners can ONLY see bookings if they are PAID or in a confirmed state
        (
            owner_id = auth.uid()
            AND (
                status IN (
                    'approved',
                    'checked-in',
                    'checked-out',
                    'completed',
                    'PAID',
                    'requested'
                )
                OR LOWER(payment_status::text) = 'paid'
            )
        )
    );
-- 2. Ensure owners can't update bookings they can't see
DROP POLICY IF EXISTS "Users can update related bookings" ON bookings;
DROP POLICY IF EXISTS "Booking update policy v2" ON bookings;
CREATE POLICY "Booking update policy v2" ON bookings FOR
UPDATE USING (
        public.is_admin(auth.uid())
        OR customer_id = auth.uid()
        OR (
            owner_id = auth.uid()
            AND (
                status IN (
                    'approved',
                    'checked-in',
                    'checked-out',
                    'completed',
                    'PAID',
                    'requested'
                )
                OR LOWER(payment_status::text) = 'paid'
            )
        )
    ) WITH CHECK (
        public.is_admin(auth.uid())
        OR customer_id = auth.uid()
        OR owner_id = auth.uid()
    );
COMMIT;
