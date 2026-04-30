-- RoomFindR Full Reset (DROP + RECREATE ALL PUBLIC TABLES)
-- WARNING: This wipes ALL data in public schema.

BEGIN;

-- Drop and recreate public schema
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

SET search_path = public;

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Enums
DO $$ BEGIN
  CREATE TYPE booking_status_enum AS ENUM (
    'pending','requested','accepted','approved','rejected','cancelled','CANCELLED_BY_CUSTOMER',
    'checked-in','checked_in','checked-out','checked_out','completed','PAID','paid',
    'vacate_requested','ACTIVE','ONGOING','active','BOOKED','VACATED','payment_pending',
    'refunded','confirmed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE booking_payment_status_enum AS ENUM ('pending','paid','failed','refunded','payment_pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('created','pending','authorized','success','completed','failed','cancelled','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE refund_status_enum AS ENUM ('PENDING','PROCESSING','SUCCESS','FAILED','PROCESSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE settlement_status_enum AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_attempt_status_enum AS ENUM ('initiated','pending','success','failed','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_status_enum AS ENUM ('active','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_txn_type_enum AS ENUM ('credit','debit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_txn_status_enum AS ENUM ('pending','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_status_enum AS ENUM ('queued','sent','failed','read');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type_enum AS ENUM (
    'payment_success','booking_confirmed','booking_rejected',
    'refund_initiated','refund_completed','settlement_completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper: updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Core accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('customer','owner','admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE owners (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  verified BOOLEAN DEFAULT FALSE,
  verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected')),
  verification_documents TEXT[] DEFAULT '{}'::TEXT[],
  bank_details JSONB DEFAULT '{}'::jsonb,
  account_holder_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Properties
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  property_type TEXT,
  address JSONB,
  locality TEXT,
  city TEXT,
  state TEXT,
  amenities JSONB DEFAULT '[]'::jsonb,
  rules JSONB DEFAULT '[]'::jsonb,
  food_available BOOLEAN DEFAULT FALSE,
  images TEXT[] DEFAULT '{}'::TEXT[],
  monthly_rent NUMERIC(10,2) NOT NULL,
  advance_deposit NUMERIC(10,2) NOT NULL,
  total_rooms INTEGER NOT NULL DEFAULT 1,
  rooms_available INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','archived','inactive')),
  published_at TIMESTAMPTZ,
  views INTEGER DEFAULT 0,
  favorites_count INTEGER DEFAULT 0,
  tags TEXT[] DEFAULT '{}'::TEXT[],
  auto_offer JSONB,
  avg_rating NUMERIC(3,2) DEFAULT 0,
  total_ratings INTEGER DEFAULT 0,
  full_payment_discount JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  room_type TEXT,
  capacity INTEGER DEFAULT 1,
  booked_count INTEGER DEFAULT 0,
  price NUMERIC(10,2) DEFAULT 0,
  amenities TEXT[] DEFAULT '{}'::TEXT[],
  images TEXT[] DEFAULT '{}'::TEXT[],
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id, room_number)
);

CREATE TABLE food_menu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
  weekly_menu JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  status booking_status_enum DEFAULT 'pending',
  stay_status TEXT DEFAULT 'ongoing',
  start_date DATE NOT NULL,
  end_date DATE,
  vacate_date DATE,
  monthly_rent NUMERIC(10,2) NOT NULL,
  advance_paid NUMERIC(10,2) DEFAULT 0,
  amount_paid NUMERIC(10,2) DEFAULT 0,
  commission_amount NUMERIC(10,2) DEFAULT 20.00,
  payment_status booking_payment_status_enum DEFAULT 'pending',
  transaction_id TEXT,
  payment_type TEXT,
  next_payment_date TIMESTAMPTZ,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  rejection_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  room_number TEXT,
  payment_id UUID,
  payment_provider TEXT DEFAULT 'cashfree',
  payment_method TEXT,
  amount_due NUMERIC(10,2),
  currency TEXT DEFAULT 'INR',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  payment_date TIMESTAMPTZ DEFAULT NOW(),
  payment_type TEXT CHECK (payment_type IN ('advance','monthly','refund','deposit','booking','full')),
  payment_method TEXT,
  status payment_status_enum DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  webhook_received BOOLEAN DEFAULT FALSE,
  currency TEXT DEFAULT 'INR',
  provider TEXT DEFAULT 'cashfree',
  provider_order_id TEXT,
  provider_payment_id TEXT,
  provider_session_id TEXT,
  provider_reference TEXT,
  idempotency_key TEXT,
  failure_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  transaction_id TEXT,
  commission_amount NUMERIC(10,2) DEFAULT 0,
  net_amount NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment attempts
CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  status payment_attempt_status_enum NOT NULL DEFAULT 'initiated',
  provider TEXT NOT NULL DEFAULT 'cashfree',
  provider_order_id TEXT,
  provider_payment_id TEXT,
  provider_session_id TEXT,
  provider_event_id TEXT,
  upi_app TEXT,
  idempotency_key TEXT,
  failure_reason TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refunds
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  refund_amount NUMERIC(10,2) NOT NULL,
  reason TEXT,
  status refund_status_enum DEFAULT 'PENDING',
  provider TEXT DEFAULT 'cashfree',
  provider_refund_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settlements
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  total_amount NUMERIC(10,2) DEFAULT 0,
  platform_fee NUMERIC(10,2) DEFAULT 0,
  net_payable NUMERIC(10,2) DEFAULT 0,
  status settlement_status_enum DEFAULT 'PENDING',
  processed_at TIMESTAMPTZ,
  provider TEXT DEFAULT 'cashfree',
  provider_transfer_id TEXT,
  provider_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_settlement_per_booking UNIQUE (booking_id)
);

-- Wallets
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  available_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  status wallet_status_enum NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_owner_wallet UNIQUE (owner_id)
);

CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  settlement_id UUID REFERENCES settlements(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'INR',
  type wallet_txn_type_enum NOT NULL,
  status wallet_txn_status_enum NOT NULL DEFAULT 'pending',
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT,
  notification_type notification_type_enum,
  status notification_status_enum NOT NULL DEFAULT 'queued',
  role TEXT,
  data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Device tokens
CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT,
  app TEXT DEFAULT 'customer' CHECK (app IN ('customer','owner','admin')),
  platform TEXT DEFAULT 'android',
  token TEXT NOT NULL,
  device_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_device_token UNIQUE (user_id, token)
);

-- Chats
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participants UUID[] NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text','image','offer','system')),
  image_url TEXT,
  offer_data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  read_by UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notices
CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Offers
CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT CHECK (discount_type IN ('percentage','fixed')),
  discount_value NUMERIC(10,2),
  max_discount NUMERIC(10,2),
  min_booking_amount NUMERIC(10,2),
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE claimed_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  UNIQUE(offer_id, user_id)
);

-- Favorites
CREATE TABLE favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, property_id)
);

-- Ratings
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tickets
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  sender_name TEXT,
  sender_email TEXT,
  sender_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ticket_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics
CREATE TABLE analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type TEXT NOT NULL,
  metric_value NUMERIC,
  date DATE NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings
CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access to settings" ON settings;
CREATE POLICY "Allow public read access to settings" ON settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow authenticated users to update settings" ON settings;
CREATE POLICY "Allow authenticated users to update settings" ON settings FOR UPDATE USING (auth.role() = 'authenticated');

-- Config (for pg_net triggers)
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO config (key, value, description)
VALUES ('platform_fee_percentage','5.0','Default platform fee percentage for settlements')
ON CONFLICT (key) DO NOTHING;
INSERT INTO config (key, value, description)
VALUES ('fixed_platform_fee','50.00','Flat fee deducted from refunds if configured')
ON CONFLICT (key) DO NOTHING;
INSERT INTO config (key, value, description)
VALUES ('supabase_url','REPLACE_WITH_SUPABASE_URL','Supabase project URL for pg_net triggers')
ON CONFLICT (key) DO NOTHING;
INSERT INTO config (key, value, description)
VALUES ('supabase_service_role_key','REPLACE_WITH_SERVICE_ROLE_KEY','Service role key for pg_net triggers')
ON CONFLICT (key) DO NOTHING;

-- Foreign key: bookings.payment_id -> payments.id
DO $$ BEGIN
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes
CREATE INDEX idx_accounts_email ON accounts(email);
CREATE INDEX idx_accounts_phone ON accounts(phone);
CREATE INDEX idx_accounts_role ON accounts(role);

CREATE INDEX idx_properties_owner_id ON properties(owner_id);
CREATE INDEX idx_properties_status ON properties(status);
CREATE INDEX idx_properties_city ON properties(city);
CREATE INDEX idx_properties_published_at ON properties(published_at DESC);
CREATE INDEX idx_properties_created_at ON properties(created_at DESC);

CREATE INDEX idx_rooms_property_id ON rooms(property_id);

CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX idx_bookings_owner_id ON bookings(owner_id);
CREATE INDEX idx_bookings_property_id ON bookings(property_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_created_at ON bookings(created_at DESC);

CREATE INDEX idx_payments_booking_id ON payments(booking_id);
CREATE INDEX idx_payments_customer_id ON payments(customer_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_provider_order_id ON payments(provider_order_id);
CREATE INDEX idx_payments_provider_payment_id ON payments(provider_payment_id);

CREATE INDEX idx_payment_attempts_payment_id ON payment_attempts(payment_id);
CREATE INDEX idx_payment_attempts_booking_id ON payment_attempts(booking_id);
CREATE INDEX idx_payment_attempts_status ON payment_attempts(status);
CREATE UNIQUE INDEX idx_payment_attempts_idem ON payment_attempts(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_payment_attempts_event ON payment_attempts(provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE INDEX idx_refunds_booking_id ON refunds(booking_id);
CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX idx_refunds_customer_id ON refunds(customer_id);
CREATE INDEX idx_refunds_status ON refunds(status);
CREATE INDEX idx_refunds_created_at ON refunds(created_at DESC);
CREATE UNIQUE INDEX idx_refunds_provider_refund_id ON refunds(provider_refund_id) WHERE provider_refund_id IS NOT NULL;

CREATE INDEX idx_settlements_owner_id ON settlements(owner_id);
CREATE UNIQUE INDEX idx_settlements_booking_id ON settlements(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_settlements_status ON settlements(status);
CREATE UNIQUE INDEX idx_settlements_provider_transfer_id ON settlements(provider_transfer_id) WHERE provider_transfer_id IS NOT NULL;

CREATE INDEX idx_wallets_owner_id ON wallets(owner_id);
CREATE INDEX idx_wallet_txn_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_txn_settlement_id ON wallet_transactions(settlement_id);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX idx_device_tokens_status ON device_tokens(status);

CREATE INDEX idx_chats_participants ON chats USING GIN(participants);
CREATE INDEX idx_chats_updated_at ON chats(updated_at DESC);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

CREATE INDEX idx_notices_property_id ON notices(property_id);
CREATE INDEX idx_notices_created_at ON notices(created_at DESC);

CREATE INDEX idx_offers_code ON offers(code);
CREATE INDEX idx_claimed_offers_user_id ON claimed_offers(user_id);
CREATE INDEX idx_claimed_offers_offer_id ON claimed_offers(offer_id);

CREATE INDEX idx_favorites_user_id ON favorites(user_id);
CREATE INDEX idx_favorites_property_id ON favorites(property_id);

CREATE INDEX idx_ratings_property_id ON ratings(property_id);
CREATE INDEX idx_ratings_booking_id ON ratings(booking_id);

CREATE INDEX idx_tickets_creator_id ON tickets(creator_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_ticket_replies_ticket_id ON ticket_replies(ticket_id);

CREATE INDEX idx_analytics_date ON analytics(date);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- Updated_at triggers
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_owners_updated_at BEFORE UPDATE ON owners FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_admins_updated_at BEFORE UPDATE ON admins FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payment_attempts_updated_at BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_settlements_updated_at BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_wallet_transactions_updated_at BEFORE UPDATE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_device_tokens_updated_at BEFORE UPDATE ON device_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON chats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notices_updated_at BEFORE UPDATE ON notices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Realtime
ALTER TABLE payments REPLICA IDENTITY FULL;
ALTER TABLE bookings REPLICA IDENTITY FULL;
ALTER TABLE refunds REPLICA IDENTITY FULL;
ALTER TABLE settlements REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'payments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'bookings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'refunds') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE refunds;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'settlements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE settlements;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

-- Automation: refund + settlement triggers
CREATE OR REPLACE FUNCTION trigger_booking_refund()
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
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF EXISTS (
      SELECT 1 FROM refunds
      WHERE booking_id = NEW.id
        AND status IN ('PENDING','PROCESSING','SUCCESS')
    ) THEN
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM payments
      WHERE booking_id = NEW.id
        AND status IN ('completed','success','authorized')
    ) THEN
      RETURN NEW;
    END IF;

    SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
      RAISE NOTICE 'Missing supabase_url or service key for refund automation';
      RETURN NEW;
    END IF;

    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/cashfree-refund',
      headers := headers,
      body := jsonb_build_object(
        'bookingId', NEW.id,
        'reason', COALESCE(NEW.rejection_reason, 'Booking rejected')
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_booking_settlement()
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
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF (NEW.status IN ('accepted','approved')) AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF EXISTS (
      SELECT 1 FROM settlements
      WHERE booking_id = NEW.id
    ) THEN
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM payments
      WHERE booking_id = NEW.id
        AND status IN ('completed','success','authorized')
    ) THEN
      RETURN NEW;
    END IF;

    SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
      RAISE NOTICE 'Missing supabase_url or service key for settlement automation';
      RETURN NEW;
    END IF;

    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/cashfree-settlement',
      headers := headers,
      body := jsonb_build_object('bookingId', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_refund_trigger ON bookings;
CREATE TRIGGER bookings_refund_trigger
AFTER UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION trigger_booking_refund();

DROP TRIGGER IF EXISTS bookings_settlement_trigger ON bookings;
CREATE TRIGGER bookings_settlement_trigger
AFTER UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION trigger_booking_settlement();

-- Notification push trigger
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
FOR EACH ROW EXECUTE FUNCTION trigger_notification_push();

COMMIT;
