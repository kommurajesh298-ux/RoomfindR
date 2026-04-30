BEGIN;
-- Allow customers/owners to read refund status for their related bookings
DROP POLICY IF EXISTS "Users can view related refunds" ON refunds;
CREATE POLICY "Users can view related refunds"
    ON refunds
    FOR SELECT
    USING (
        public.is_admin(auth.uid())
        OR customer_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM bookings
            WHERE bookings.id = refunds.booking_id
              AND (
                bookings.customer_id = auth.uid()
                OR bookings.owner_id = auth.uid()
              )
        )
    );
COMMIT;
