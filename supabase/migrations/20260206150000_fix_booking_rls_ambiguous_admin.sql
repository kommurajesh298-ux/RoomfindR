BEGIN;
-- Stabilize role helpers to avoid ambiguous function resolution and RLS recursion.
-- Note: We use CREATE OR REPLACE to avoid dropping dependent policies.

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    RETURN (auth.jwt()->'user_metadata'->>'role') = 'admin';
END;
$$;
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    RETURN (auth.jwt()->'user_metadata'->>'role') = 'owner';
END;
$$;
CREATE OR REPLACE FUNCTION public.is_customer() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    RETURN (auth.jwt()->'user_metadata'->>'role') = 'customer'
        OR (auth.jwt()->'user_metadata'->>'role') IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_customer() TO authenticated, service_role;
-- Rebuild booking policies using the stable helpers.
DROP POLICY IF EXISTS "Booking update policy v4" ON bookings;
DROP POLICY IF EXISTS "Booking update policy v3" ON bookings;
DROP POLICY IF EXISTS "Booking update policy v2" ON bookings;
DROP POLICY IF EXISTS "Users can update related bookings" ON bookings;
CREATE POLICY "Booking update policy v4"
    ON bookings
    FOR UPDATE
    USING (
        public.is_admin(auth.uid())
        OR owner_id = auth.uid()
        OR customer_id = auth.uid()
    )
    WITH CHECK (
        public.is_admin(auth.uid())
        OR owner_id = auth.uid()
        OR customer_id = auth.uid()
    );
DROP POLICY IF EXISTS "Booking visibility policy v4" ON bookings;
DROP POLICY IF EXISTS "Booking visibility policy v3" ON bookings;
DROP POLICY IF EXISTS "Customers can view own bookings" ON bookings;
CREATE POLICY "Booking visibility policy v4"
    ON bookings
    FOR SELECT
    USING (
        public.is_admin(auth.uid())
        OR owner_id = auth.uid()
        OR customer_id = auth.uid()
    );
DROP POLICY IF EXISTS "Customers can create bookings" ON bookings;
CREATE POLICY "Customers can create bookings"
    ON bookings
    FOR INSERT
    WITH CHECK (
        customer_id = auth.uid()
        AND (
            (auth.jwt()->'user_metadata'->>'role') = 'customer'
            OR (auth.jwt()->'user_metadata'->>'role') IS NULL
            OR public.is_admin(auth.uid())
        )
    );
-- Rebuild payments visibility policy to use stable helpers.
DROP POLICY IF EXISTS "Users can view related payments" ON payments;
CREATE POLICY "Users can view related payments"
    ON payments
    FOR SELECT
    USING (
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
COMMIT;
