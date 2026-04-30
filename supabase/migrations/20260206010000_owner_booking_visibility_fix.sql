-- Relax owner booking visibility so owners see all their bookings
BEGIN;
DROP POLICY IF EXISTS "Booking visibility policy v3" ON bookings;
DROP POLICY IF EXISTS "Booking visibility policy v2" ON bookings;
CREATE POLICY "Booking visibility policy v3"
    ON bookings
    FOR SELECT
    USING (
        public.is_admin(auth.uid())
        OR customer_id = auth.uid()
        OR owner_id = auth.uid()
    );
DROP POLICY IF EXISTS "Booking update policy v3" ON bookings;
DROP POLICY IF EXISTS "Booking update policy v2" ON bookings;
CREATE POLICY "Booking update policy v3"
    ON bookings
    FOR UPDATE
    USING (
        public.is_admin(auth.uid())
        OR customer_id = auth.uid()
        OR owner_id = auth.uid()
    )
    WITH CHECK (
        public.is_admin(auth.uid())
        OR customer_id = auth.uid()
        OR owner_id = auth.uid()
    );
COMMIT;
