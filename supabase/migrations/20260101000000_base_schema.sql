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
-- Admins table (administrative profile data)
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
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
                'requested',
                'accepted',
                'approved',
                'confirmed',
                'rejected',
                'cancelled',
                'CANCELLED_BY_CUSTOMER',
                'checked-in',
                'checked_in',
                'checked-out',
                'checked_out',
                'completed',
                'PAID',
                'paid',
                'vacate_requested',
                'ACTIVE',
                'ONGOING',
                'active',
                'BOOKED',
                'VACATED',
                'payment_pending',
                'refunded'
            )
        ),
        stay_status TEXT DEFAULT 'ongoing',
        start_date DATE NOT NULL,
        end_date DATE,
        vacate_date DATE,
        -- Pricing
        monthly_rent NUMERIC(10, 2) NOT NULL,
        advance_paid NUMERIC(10, 2) DEFAULT 0,
        amount_paid NUMERIC(10, 2) DEFAULT 0,
        commission_amount NUMERIC(10, 2) DEFAULT 20.00,
        -- Payment details
        payment_status TEXT DEFAULT 'pending' CHECK (
            lower(payment_status) IN ('pending', 'paid', 'failed', 'refunded')
        ),
        transaction_id TEXT,
        payment_type TEXT,
        next_payment_date TIMESTAMPTZ,
        -- Contact info
        customer_name TEXT,
        customer_phone TEXT,
        customer_email TEXT,
        -- Metadata
        rejection_reason TEXT,
        cancelled_at TIMESTAMPTZ,
        room_number TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    customer_id UUID,
    amount NUMERIC(10, 2) NOT NULL,
    payment_date TIMESTAMPTZ DEFAULT NOW(),
    payment_type TEXT CHECK (
        payment_type IN (
            'advance',
            'monthly',
            'refund',
            'deposit',
            'booking',
            'full'
        )
    ),
    payment_method TEXT,
    -- 'upi', 'card', 'cash'
    status TEXT DEFAULT 'pending' CHECK (
        status IN ('created', 'pending', 'authorized', 'success', 'completed', 'failed', 'cancelled', 'refunded')
    ),
    verified_at TIMESTAMPTZ,
    webhook_received BOOLEAN DEFAULT FALSE,
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes for payments
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
-- Refunds table
CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    refund_amount NUMERIC(10, 2) NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending' CHECK (
        upper(status) IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'PROCESSED')
    ),
    -- pending, processing, success, failed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_refunds_booking_id ON refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_customer_id ON refunds(customer_id);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at DESC);
-- Config table (for platform fees and edge function callbacks)
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO config (key, value, description)
VALUES (
        'platform_fee_percentage',
        '5.0',
        'Default platform fee percentage for settlements'
    ) ON CONFLICT (key) DO NOTHING;
INSERT INTO config (key, value, description)
VALUES (
        'fixed_platform_fee',
        '50.00',
        'Flat fee deducted from refunds if configured'
    ) ON CONFLICT (key) DO NOTHING;
INSERT INTO config (key, value, description)
VALUES (
        'supabase_url',
        'REPLACE_WITH_SUPABASE_URL',
        'Supabase project URL used for edge function callbacks'
    ) ON CONFLICT (key) DO NOTHING;
INSERT INTO config (key, value, description)
  VALUES (
          'supabase_service_role_key',
          'REPLACE_WITH_SERVICE_ROLE_KEY',
          'Service role key used for edge function callbacks'
      ) ON CONFLICT (key) DO NOTHING;
-- Settings table (site-wide configuration)
  CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
  );
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access to settings" ON settings;
CREATE POLICY "Allow public read access to settings" ON settings FOR
  SELECT USING (true);
DROP POLICY IF EXISTS "Allow authenticated users to update settings" ON settings;
CREATE POLICY "Allow authenticated users to update settings" ON settings FOR
  UPDATE USING (auth.role() = 'authenticated');
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
  SET value = EXCLUDED.value,
      updated_at = now();
-- Settlements Table
CREATE TABLE IF NOT EXISTS settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,
    week_end_date DATE NOT NULL,
    total_amount NUMERIC(10, 2) DEFAULT 0,
    platform_fee NUMERIC(10, 2) DEFAULT 0,
    net_payable NUMERIC(10, 2) DEFAULT 0,
    status TEXT DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    ),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_settlement_per_booking UNIQUE (booking_id)
);
CREATE INDEX IF NOT EXISTS idx_settlements_owner_id ON settlements(owner_id);
CREATE INDEX IF NOT EXISTS idx_settlements_booking_id ON settlements(booking_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
CREATE INDEX IF NOT EXISTS idx_settlements_week_start ON settlements(week_start_date DESC);
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
-- Device tokens table (for Android push)
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT,
    app TEXT DEFAULT 'customer' CHECK (app IN ('customer', 'owner', 'admin')) ,
    platform TEXT DEFAULT 'android',
    token TEXT NOT NULL,
    device_id TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')) ,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_device_token UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_status ON device_tokens(status);
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
CREATE EXTENSION IF NOT EXISTS pg_net;
-- =============================================================================
-- NOTIFICATION PUSH TRIGGER
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM 'queued' THEN
        RETURN NEW;
    END IF;

    SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE NOTICE 'Missing supabase_url or service key for notification dispatch';
        RETURN NEW;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/notifications-dispatch',
        headers := headers,
        body := jsonb_build_object('notificationId', NEW.id)
    );

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notifications_push_trigger ON notifications;
CREATE TRIGGER notifications_push_trigger
AFTER INSERT ON notifications
FOR EACH ROW
EXECUTE FUNCTION trigger_notification_push();
