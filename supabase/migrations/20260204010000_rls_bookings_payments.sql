-- Enable RLS and enforce booking/payment access controls
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
-- Bookings: customers/owners/admins visibility
DROP POLICY IF EXISTS "Customers can view own bookings" ON bookings;
CREATE POLICY "Customers can view own bookings" ON bookings FOR
SELECT USING (
        customer_id = auth.uid()
        OR owner_id = auth.uid()
        OR public.is_admin(auth.uid())
    );
DROP POLICY IF EXISTS "Customers can create bookings" ON bookings;
CREATE POLICY "Customers can create bookings" ON bookings FOR
INSERT WITH CHECK (
        customer_id = auth.uid()
        AND (
            is_customer()
            OR public.is_admin(auth.uid())
        )
    );
DROP POLICY IF EXISTS "Users can update related bookings" ON bookings;
CREATE POLICY "Users can update related bookings" ON bookings FOR
UPDATE USING (
        customer_id = auth.uid()
        OR owner_id = auth.uid()
        OR public.is_admin(auth.uid())
    ) WITH CHECK (
        customer_id = auth.uid()
        OR owner_id = auth.uid()
        OR public.is_admin(auth.uid())
    );
DROP POLICY IF EXISTS "Admins can manage all bookings" ON bookings;
CREATE POLICY "Admins can manage all bookings" ON bookings FOR ALL USING (public.is_admin(auth.uid()));
-- Payments: only related customer/owner/admin
DROP POLICY IF EXISTS "Users can view related payments" ON payments;
CREATE POLICY "Users can view related payments" ON payments FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM bookings
            WHERE bookings.id = payments.booking_id
                AND (
                    bookings.customer_id = auth.uid()
                    OR bookings.owner_id = auth.uid()
                    OR public.is_admin(auth.uid())
                )
        )
    );
DROP POLICY IF EXISTS "System can create payments" ON payments;
CREATE POLICY "System can create payments" ON payments FOR
INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM bookings
            WHERE bookings.id = payments.booking_id
                AND (
                    bookings.customer_id = auth.uid()
                    OR bookings.owner_id = auth.uid()
                )
        )
    );
-- Enable realtime for bookings table (safe if already enabled)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_publication p ON p.oid = pr.prpubid
        WHERE p.pubname = 'supabase_realtime'
          AND c.relname = 'bookings'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE bookings';
    END IF;
END $$;
