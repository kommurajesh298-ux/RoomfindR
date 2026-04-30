-- =============================================================================
-- ROOMFINDR MASTER SUPABASE SETUP SCRIPT
-- =============================================================================
-- This script consolidates all setup SQL in the correct execution order:
-- 1. Schema (Core Tables, Indexes, Triggers)
-- 2. Policies (Row Level Security)
-- 3. Storage (Buckets and Storage Policies)
-- 4. Seed Data (Settings, Offers, User Registration Triggers)
--
-- Execute this entire script in the Supabase SQL Editor
-- =============================================================================
-- =============================================================================
-- SECTION 1: SCHEMA (Core Tables, Indexes, Triggers)
-- =============================================================================
-- RoomFindR Database Schema for Supabase
-- This schema migrates Firestore collections to PostgreSQL tables
-- =============================================================================
-- CORE TABLES
-- =============================================================================
-- Accounts table (main user authentication and role management)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('customer', 'owner', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Customers table (customer-specific profile data)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    phone TEXT,
    email TEXT,
    city TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Owners table (property owner profiles)
CREATE TABLE IF NOT EXISTS owners (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    verified BOOLEAN DEFAULT FALSE,
    verification_status TEXT DEFAULT 'pending' CHECK (
        verification_status IN ('pending', 'approved', 'rejected')
    ),
    verification_documents TEXT [] DEFAULT '{}',
    bank_details JSONB DEFAULT '{}'::jsonb,
    account_holder_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- =============================================================================
-- PROPERTY TABLES
-- =============================================================================
-- Properties table (main property listings)
CREATE TABLE IF NOT EXISTS properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    property_type TEXT,
    -- 'pg', 'hostel', 'apartment'
    -- Location
    address JSONB,
    -- { street, city, state, pincode, coordinates }
    locality TEXT,
    city TEXT,
    state TEXT,
    -- Amenities and Features
    amenities JSONB DEFAULT '[]'::jsonb,
    rules JSONB DEFAULT '[]'::jsonb,
    food_available BOOLEAN DEFAULT FALSE,
    -- Images
    images TEXT [] DEFAULT ARRAY []::TEXT [],
    -- Pricing
    monthly_rent NUMERIC(10, 2) NOT NULL,
    advance_deposit NUMERIC(10, 2) NOT NULL,
    -- Availability
    total_rooms INTEGER NOT NULL DEFAULT 1,
    rooms_available INTEGER NOT NULL DEFAULT 1,
    -- Status
    status TEXT DEFAULT 'draft' CHECK (
        status IN ('draft', 'published', 'archived', 'inactive')
    ),
    published_at TIMESTAMPTZ,
    -- Metadata
    views INTEGER DEFAULT 0,
    favorites_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Rooms table (individual rooms within properties)
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    room_number TEXT NOT NULL,
    room_type TEXT,
    -- 'Single', 'Double', 'Triple', 'Shared'
    capacity INTEGER DEFAULT 1,
    booked_count INTEGER DEFAULT 0,
    price NUMERIC(10, 2) DEFAULT 0,
    amenities TEXT [] DEFAULT '{}',
    images TEXT [] DEFAULT '{}',
    is_available BOOLEAN DEFAULT TRUE,
    occupied_by UUID REFERENCES customers(id) ON DELETE
    SET NULL,
        occupancy_start_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(property_id, room_number)
);
-- Food menu (One row per property, weekly menu stored as JSONB)
CREATE TABLE IF NOT EXISTS food_menu (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
    weekly_menu JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- =============================================================================
-- BOOKING & PAYMENT TABLES
-- =============================================================================
-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE
    SET NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        -- Booking details
        status TEXT DEFAULT 'pending' CHECK (
            status IN (
                'pending',
                'approved',
                'rejected',
                'cancelled',
                'checked-in',
                'checked-out',
                'completed'
            )
        ),
        start_date DATE NOT NULL,
        end_date DATE,
        -- Pricing
        monthly_rent NUMERIC(10, 2) NOT NULL,
        advance_paid NUMERIC(10, 2) DEFAULT 0,
        -- Contact info
        customer_name TEXT,
        customer_phone TEXT,
        customer_email TEXT,
        -- Metadata
        rejection_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    payment_date TIMESTAMPTZ DEFAULT NOW(),
    payment_type TEXT CHECK (
        payment_type IN ('advance', 'monthly', 'refund', 'deposit')
    ),
    payment_method TEXT,
    -- 'upi', 'card', 'cash'
    status TEXT DEFAULT 'pending' CHECK (
        status IN ('pending', 'completed', 'failed', 'refunded')
    ),
    transaction_id TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- =============================================================================
-- CHAT & MESSAGING TABLES
-- =============================================================================
-- Chats table
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participants UUID [] NOT NULL,
    property_id UUID REFERENCES properties(id) ON DELETE
    SET NULL,
        last_message TEXT,
        last_message_time TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT,
    message_type TEXT DEFAULT 'text' CHECK (
        message_type IN ('text', 'image', 'offer', 'system')
    ),
    image_url TEXT,
    offer_data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    read_by UUID [],
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- =============================================================================
-- NOTIFICATION TABLES
-- =============================================================================
-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT,
    -- 'booking', 'message', 'property', 'system'
    data JSONB,
    -- Additional data like booking_id, property_id, etc.
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Notices table (property-specific announcements)
CREATE TABLE IF NOT EXISTS notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- =============================================================================
-- OFFER & FAVORITES TABLES
-- =============================================================================
-- Offers table (promotional offers)
CREATE TABLE IF NOT EXISTS offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC(10, 2),
    max_discount NUMERIC(10, 2),
    min_booking_amount NUMERIC(10, 2),
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    max_uses INTEGER,
    current_uses INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Claimed offers (tracking who claimed which offers)
CREATE TABLE IF NOT EXISTS claimed_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE
    SET NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW(),
        used_at TIMESTAMPTZ,
        UNIQUE(offer_id, user_id)
);
-- Favorites table (user favorite properties)
CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, property_id)
);
-- =============================================================================
-- ANALYTICS & REPORTING TABLES
-- =============================================================================
-- Analytics table
CREATE TABLE IF NOT EXISTS analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_type TEXT NOT NULL,
    metric_value NUMERIC,
    date DATE NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE
    SET NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id UUID,
        details JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
);
-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================
-- Accounts indexes
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone);
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
-- Properties indexes
CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_published_at ON properties(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_created_at ON properties(created_at DESC);
-- Bookings indexes
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_owner_id ON bookings(owner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_property_id ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
-- Chats indexes
CREATE INDEX IF NOT EXISTS idx_chats_participants ON chats USING GIN(participants);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
-- Favorites indexes
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_property_id ON favorites(property_id);
-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS update_accounts_updated_at ON accounts;
CREATE TRIGGER update_accounts_updated_at BEFORE
UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE
UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_owners_updated_at ON owners;
CREATE TRIGGER update_owners_updated_at BEFORE
UPDATE ON owners FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_properties_updated_at ON properties;
CREATE TRIGGER update_properties_updated_at BEFORE
UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at BEFORE
UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_chats_updated_at ON chats;
CREATE TRIGGER update_chats_updated_at BEFORE
UPDATE ON chats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_notices_updated_at ON notices;
CREATE TRIGGER update_notices_updated_at BEFORE
UPDATE ON notices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- =============================================================================
-- SECTION 2: ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================
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
            role = (
                SELECT role
                FROM accounts
                WHERE id = auth.uid()
            )
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
-- Admins table policies
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage all admin profiles" ON admins;
CREATE POLICY "Admins can manage all admin profiles" ON admins FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "Users can view own admin profile" ON admins;
CREATE POLICY "Users can view own admin profile" ON admins FOR
SELECT USING (
        auth.uid() = id
        OR is_admin()
    );
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
-- Owners can update own properties
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
CREATE POLICY "Admins can manage all properties" ON properties FOR ALL USING (is_admin()) WITH CHECK (is_admin());
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
-- =============================================================================
-- SECTION 3: STORAGE BUCKETS AND POLICIES
-- =============================================================================
-- =============================================================================
-- STORAGE BUCKETS SETUP
-- =============================================================================
-- 1. Create property-images bucket (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true) ON CONFLICT (id) DO NOTHING;
-- 2. Create profile-photos bucket (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true) ON CONFLICT (id) DO NOTHING;
-- 3. Create documents bucket (Public - for easy visibility)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true) ON CONFLICT (id) DO
UPDATE
SET public = true;
-- =============================================================================
-- STORAGE POLICIES
-- =============================================================================
-- POLICIES FOR property-images
DROP POLICY IF EXISTS "Public Read Access" ON storage.objects;
CREATE POLICY "Public Read Access" ON storage.objects FOR
SELECT USING (bucket_id = 'property-images');
DROP POLICY IF EXISTS "Authenticated Upload Access" ON storage.objects;
CREATE POLICY "Authenticated Upload Access" ON storage.objects FOR
INSERT WITH CHECK (
        bucket_id = 'property-images'
        AND auth.role() = 'authenticated'
    );
-- POLICIES FOR profile-photos
DROP POLICY IF EXISTS "Profile Photo Public Read" ON storage.objects;
CREATE POLICY "Profile Photo Public Read" ON storage.objects FOR
SELECT USING (bucket_id = 'profile-photos');
DROP POLICY IF EXISTS "Profile Photo Auth Upload" ON storage.objects;
CREATE POLICY "Profile Photo Auth Upload" ON storage.objects FOR
INSERT WITH CHECK (
        bucket_id = 'profile-photos'
        AND auth.role() = 'authenticated'
    );
-- POLICIES FOR documents (Owner Licenses/Proof)
-- Owners can upload to their own folder, Admins can read everything
DROP POLICY IF EXISTS "Owners can upload documents" ON storage.objects;
CREATE POLICY "Owners can upload documents" ON storage.objects FOR
INSERT WITH CHECK (
        bucket_id = 'documents'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name)) [1] = auth.uid()::text
    );
DROP POLICY IF EXISTS "Owners can view own documents" ON storage.objects;
CREATE POLICY "Owners can view own documents" ON storage.objects FOR
SELECT USING (
        bucket_id = 'documents'
        AND (
            auth.uid()::text = (storage.foldername(name)) [1]
            OR (
                EXISTS (
                    SELECT 1
                    FROM accounts
                    WHERE id = auth.uid()
                        AND role = 'admin'
                )
            )
        )
    );
-- =============================================================================
-- SECTION 4: SEED DATA, SETTINGS, AND USER REGISTRATION TRIGGERS
-- =============================================================================
-- =============================================================================
-- 1. Create Settings Table and Seed Data
-- =============================================================================
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);
-- Enable RLS for settings
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
-- Allow read access to anyone
DROP POLICY IF EXISTS "Allow public read access to settings" ON settings;
CREATE POLICY "Allow public read access to settings" ON settings FOR
SELECT USING (true);
-- Allow authenticated users to update settings (Placeholder: adjust policy based on your auth roles)
DROP POLICY IF EXISTS "Allow authenticated users to update settings" ON settings;
CREATE POLICY "Allow authenticated users to update settings" ON settings FOR
UPDATE USING (auth.role() = 'authenticated');
-- Seed site settings
INSERT INTO settings (id, value)
VALUES (
        'site',
        '{
        
        "maintenanceMode": false,
        "globalAdvanceAmount": 500,
        "taxRate": 10,
        "features": {
            "chat": true,
            "monthlyPayments": true,
            "foodMenu": true
        }
    }'::jsonb
    ) ON CONFLICT (id) DO
UPDATE
SET value = EXCLUDED.value;
-- =============================================================================
-- 2. Create RAJESH123 Offer
-- =============================================================================
INSERT INTO offers (
        code,
        title,
        description,
        discount_type,
        discount_value,
        min_booking_amount,
        max_discount,
        max_uses,
        current_uses,
        is_active,
        valid_until
    )
VALUES (
        'RAJESH123',
        'Welcome Offer',
        'Flat ₹50 discount on your first booking!',
        'fixed',
        50,
        500,
        50,
        100,
        0,
        true,
        now() + interval '30 days'
    ) ON CONFLICT (code) DO
UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description,
    discount_type = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    min_booking_amount = EXCLUDED.min_booking_amount,
    max_discount = EXCLUDED.max_discount,
    is_active = EXCLUDED.is_active,
    valid_until = EXCLUDED.valid_until;
-- =============================================================================
-- 3. Registration Trigger (Fixes RLS/401 during Signup)
-- =============================================================================
-- Trigger function to automatically create a profile row in accounts and owners/customers
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ BEGIN -- Insert into accounts
INSERT INTO public.accounts (id, email, phone, role)
VALUES (
        new.id,
        new.email,
        new.phone,
        COALESCE(new.raw_user_meta_data->>'role', 'owner')
    ) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
IF (
    COALESCE(new.raw_user_meta_data->>'role', 'owner') = 'admin'
) THEN
INSERT INTO public.admins (id, name, email)
VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'name', 'Admin'),
        new.email
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    updated_at = NOW();
ELSIF (
    COALESCE(new.raw_user_meta_data->>'role', 'owner') = 'owner'
) THEN
INSERT INTO public.owners (
        id,
        name,
        email,
        phone,
        bank_details,
        account_holder_name
    )
VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'name', 'Owner'),
        new.email,
        COALESCE(
            new.phone,
            new.raw_user_meta_data->>'phone'
        ),
        COALESCE(
            (new.raw_user_meta_data->'bank_details')::jsonb,
            '{}'::jsonb
        ),
        new.raw_user_meta_data->>'account_holder_name'
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    bank_details = EXCLUDED.bank_details,
    account_holder_name = EXCLUDED.account_holder_name,
    updated_at = NOW();
ELSE -- Insert into customers
INSERT INTO public.customers (id, name, email, phone, city)
VALUES (
        new.id,
        new.raw_user_meta_data->>'name',
        new.email,
        COALESCE(new.phone, new.raw_user_meta_data->>'phone'),
        new.raw_user_meta_data->>'city'
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    city = EXCLUDED.city,
    updated_at = NOW();
END IF;
RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Create the trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- =============================================================================
-- END OF MASTER SETUP SCRIPT
-- =============================================================================
-- You can now execute this entire script in the Supabase SQL Editor
-- Verify setup by checking:
-- 1. All tables created (accounts, customers, owners, properties, etc.)
-- 2. RLS enabled on all tables
-- 3. Storage buckets created (property-images, profile-photos, documents)
-- 4. Settings table seeded with site configuration
-- 5. RAJESH123 offer created
-- 6. User registration trigger active
-- =============================================================================