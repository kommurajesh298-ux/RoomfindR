-- Row Level Security (RLS) Policies for RoomFindR
-- These policies replace Firebase Security Rules
-- =============================================================================
-- ENABLE RLS ON ALL TABLES
-- =============================================================================
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimed_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================
-- Get user role (Security Definer to bypass RLS and prevent recursion)
CREATE OR REPLACE FUNCTION get_user_role(user_id UUID) RETURNS TEXT AS $$ BEGIN RETURN (
        SELECT role
        FROM public.accounts
        WHERE id = user_id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- Check if user is admin (Non-recursive)
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$ BEGIN RETURN get_user_role(auth.uid()) = 'admin';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- Check if user is owner (Non-recursive)
CREATE OR REPLACE FUNCTION is_owner() RETURNS BOOLEAN AS $$ BEGIN RETURN get_user_role(auth.uid()) = 'owner';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- Check if user is customer (Non-recursive)
CREATE OR REPLACE FUNCTION is_customer() RETURNS BOOLEAN AS $$ BEGIN RETURN get_user_role(auth.uid()) = 'customer';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- =============================================================================
-- ACCOUNTS TABLE POLICIES
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own account" ON accounts;
CREATE POLICY "Users can view own account" ON accounts FOR
SELECT USING (
        auth.uid() = id
        OR is_admin()
    );
DROP POLICY IF EXISTS "Users can create own account" ON accounts;
CREATE POLICY "Users can create own account" ON accounts FOR
INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own account" ON accounts;
CREATE POLICY "Users can update own account" ON accounts FOR
UPDATE USING (auth.uid() = id) WITH CHECK (
        auth.uid() = id
        AND (
            role = get_user_role(auth.uid())
            OR is_admin()
        )
    );
DROP POLICY IF EXISTS "Admins can manage all accounts" ON accounts;
CREATE POLICY "Admins can manage all accounts" ON accounts FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "Authenticated users can view customers" ON customers;
CREATE POLICY "Authenticated users can view customers" ON customers FOR
SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Users can manage own customer profile" ON customers;
CREATE POLICY "Users can manage own customer profile" ON customers FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Authenticated users can view owners" ON owners;
CREATE POLICY "Authenticated users can view owners" ON owners FOR
SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Users can manage own owner profile" ON owners;
CREATE POLICY "Users can manage own owner profile" ON owners FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Admins can manage all owners" ON owners;
CREATE POLICY "Admins can manage all owners" ON owners FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "Anyone can view published properties" ON properties;
CREATE POLICY "Anyone can view published properties" ON properties FOR
SELECT USING (
        status = 'published'
        OR owner_id = auth.uid()
        OR is_admin()
    );
-- Owners can create properties
DROP POLICY IF EXISTS "Owners can create properties" ON properties;
CREATE POLICY "Owners can create properties" ON properties FOR
INSERT WITH CHECK (
        owner_id = auth.uid()
        AND (
            is_owner()
            OR is_admin()
        )
    );
-- Owners can update own properties (Can only publish if status is 'approved' in owners table)
DROP POLICY IF EXISTS "Owners can update own properties" ON properties;
CREATE POLICY "Owners can update own properties" ON properties FOR
UPDATE USING (owner_id = auth.uid()) WITH CHECK (
        owner_id = auth.uid()
        AND (
            (
                status = 'published'
                AND EXISTS (
                    SELECT 1
                    FROM owners
                    WHERE id = auth.uid()
                        AND verification_status = 'approved'
                )
            )
            OR (status != 'published')
        )
    );
DROP POLICY IF EXISTS "Owners can delete own properties" ON properties;
CREATE POLICY "Owners can delete own properties" ON properties FOR DELETE USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Admins can manage all properties" ON properties;
CREATE POLICY "Admins can manage all properties" ON properties FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "Users can view rooms" ON rooms;
CREATE POLICY "Users can view rooms" ON rooms FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM properties
            WHERE properties.id = rooms.property_id
                AND (
                    properties.status = 'published'
                    OR properties.owner_id = auth.uid()
                    OR is_admin()
                )
        )
    );
DROP POLICY IF EXISTS "Owners can manage own property rooms" ON rooms;
CREATE POLICY "Owners can manage own property rooms" ON rooms FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM properties
        WHERE properties.id = rooms.property_id
            AND properties.owner_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Users can view food menu" ON food_menu;
CREATE POLICY "Users can view food menu" ON food_menu FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM properties
            WHERE properties.id = food_menu.property_id
                AND (
                    properties.status = 'published'
                    OR properties.owner_id = auth.uid()
                )
        )
    );
DROP POLICY IF EXISTS "Owners can manage own property food menu" ON food_menu;
CREATE POLICY "Owners can manage own property food menu" ON food_menu FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM properties
        WHERE properties.id = food_menu.property_id
            AND properties.owner_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Customers can view own bookings" ON bookings;
CREATE POLICY "Customers can view own bookings" ON bookings FOR
SELECT USING (
        customer_id = auth.uid()
        OR owner_id = auth.uid()
        OR is_admin()
    );
-- Customers can create bookings
DROP POLICY IF EXISTS "Customers can create bookings" ON bookings;
CREATE POLICY "Customers can create bookings" ON bookings FOR
INSERT WITH CHECK (
        customer_id = auth.uid()
        AND (
            is_customer()
            OR is_admin()
        )
    );
DROP POLICY IF EXISTS "Users can update related bookings" ON bookings;
CREATE POLICY "Users can update related bookings" ON bookings FOR
UPDATE USING (
        customer_id = auth.uid()
        OR owner_id = auth.uid()
        OR is_admin()
    ) WITH CHECK (
        customer_id = auth.uid()
        OR owner_id = auth.uid()
        OR is_admin()
    );
DROP POLICY IF EXISTS "Admins can manage all bookings" ON bookings;
CREATE POLICY "Admins can manage all bookings" ON bookings FOR ALL USING (is_admin());
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
                    OR is_admin()
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
DROP POLICY IF EXISTS "Users can view own chats" ON chats;
CREATE POLICY "Users can view own chats" ON chats FOR
SELECT USING (auth.uid() = ANY(participants));
DROP POLICY IF EXISTS "Users can create chats" ON chats;
CREATE POLICY "Users can create chats" ON chats FOR
INSERT WITH CHECK (auth.uid() = ANY(participants));
DROP POLICY IF EXISTS "Users can update own chats" ON chats;
CREATE POLICY "Users can update own chats" ON chats FOR
UPDATE USING (auth.uid() = ANY(participants)) WITH CHECK (auth.uid() = ANY(participants));
DROP POLICY IF EXISTS "Users can view messages in own chats" ON messages;
CREATE POLICY "Users can view messages in own chats" ON messages FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM chats
            WHERE chats.id = messages.chat_id
                AND auth.uid() = ANY(chats.participants)
        )
    );
DROP POLICY IF EXISTS "Users can send messages in own chats" ON messages;
CREATE POLICY "Users can send messages in own chats" ON messages FOR
INSERT WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM chats
            WHERE chats.id = messages.chat_id
                AND auth.uid() = ANY(chats.participants)
        )
    );
DROP POLICY IF EXISTS "Users can update own messages" ON messages;
CREATE POLICY "Users can update own messages" ON messages FOR
UPDATE USING (
        EXISTS (
            SELECT 1
            FROM chats
            WHERE chats.id = messages.chat_id
                AND auth.uid() = ANY(chats.participants)
        )
    );
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
CREATE POLICY "Users can view own notifications" ON notifications FOR
SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "System can create notifications" ON notifications;
CREATE POLICY "System can create notifications" ON notifications FOR
INSERT WITH CHECK (true);
-- Will be restricted by Edge Functions
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" ON notifications FOR
UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications" ON notifications FOR DELETE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can view property notices" ON notices;
CREATE POLICY "Users can view property notices" ON notices FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM properties
            WHERE properties.id = notices.property_id
                AND (
                    properties.status = 'published'
                    OR properties.owner_id = auth.uid()
                )
        )
    );
DROP POLICY IF EXISTS "Owners can manage own property notices" ON notices;
CREATE POLICY "Owners can manage own property notices" ON notices FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM properties
        WHERE properties.id = notices.property_id
            AND properties.owner_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Anyone can view active offers" ON offers;
CREATE POLICY "Anyone can view active offers" ON offers FOR
SELECT USING (
        is_active = true
        OR is_admin()
    );
DROP POLICY IF EXISTS "Admins can manage offers" ON offers;
CREATE POLICY "Admins can manage offers" ON offers FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "Users can view own claimed offers" ON claimed_offers;
CREATE POLICY "Users can view own claimed offers" ON claimed_offers FOR
SELECT USING (
        user_id = auth.uid()
        OR is_admin()
    );
DROP POLICY IF EXISTS "Users can claim offers" ON claimed_offers;
CREATE POLICY "Users can claim offers" ON claimed_offers FOR
INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can view own favorites" ON favorites;
CREATE POLICY "Users can view own favorites" ON favorites FOR
SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can manage own favorites" ON favorites;
CREATE POLICY "Users can manage own favorites" ON favorites FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can view analytics" ON analytics;
CREATE POLICY "Admins can view analytics" ON analytics FOR
SELECT USING (is_admin());
DROP POLICY IF EXISTS "System can insert analytics" ON analytics;
CREATE POLICY "System can insert analytics" ON analytics FOR
INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
CREATE POLICY "Admins can view audit logs" ON audit_logs FOR
SELECT USING (is_admin());
DROP POLICY IF EXISTS "System can create audit logs" ON audit_logs;
CREATE POLICY "System can create audit logs" ON audit_logs FOR
INSERT WITH CHECK (true);