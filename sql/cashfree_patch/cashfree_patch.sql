-- RoomFindR Cashfree PG + Payouts Patch (idempotent)
-- Safe to run multiple times in Supabase SQL Editor.

SET search_path = public;

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Enums (create if missing)
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

-- Ensure enum values exist (safe even if already present)
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'requested';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'CANCELLED_BY_CUSTOMER';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'checked-in';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'checked_in';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'checked-out';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'checked_out';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'vacate_requested';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'ONGOING';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'BOOKED';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'VACATED';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'payment_pending';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE booking_status_enum ADD VALUE IF NOT EXISTS 'confirmed';

ALTER TYPE booking_payment_status_enum ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE booking_payment_status_enum ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE booking_payment_status_enum ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE booking_payment_status_enum ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE booking_payment_status_enum ADD VALUE IF NOT EXISTS 'payment_pending';

ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'created';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'authorized';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'success';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'refunded';

ALTER TYPE refund_status_enum ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE refund_status_enum ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE refund_status_enum ADD VALUE IF NOT EXISTS 'SUCCESS';
ALTER TYPE refund_status_enum ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE refund_status_enum ADD VALUE IF NOT EXISTS 'PROCESSED';

ALTER TYPE settlement_status_enum ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE settlement_status_enum ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE settlement_status_enum ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE settlement_status_enum ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TYPE payment_attempt_status_enum ADD VALUE IF NOT EXISTS 'initiated';
ALTER TYPE payment_attempt_status_enum ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE payment_attempt_status_enum ADD VALUE IF NOT EXISTS 'success';
ALTER TYPE payment_attempt_status_enum ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE payment_attempt_status_enum ADD VALUE IF NOT EXISTS 'expired';

ALTER TYPE wallet_status_enum ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE wallet_status_enum ADD VALUE IF NOT EXISTS 'blocked';

ALTER TYPE wallet_txn_type_enum ADD VALUE IF NOT EXISTS 'credit';
ALTER TYPE wallet_txn_type_enum ADD VALUE IF NOT EXISTS 'debit';

ALTER TYPE wallet_txn_status_enum ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE wallet_txn_status_enum ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE wallet_txn_status_enum ADD VALUE IF NOT EXISTS 'failed';

ALTER TYPE notification_status_enum ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE notification_status_enum ADD VALUE IF NOT EXISTS 'sent';
ALTER TYPE notification_status_enum ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE notification_status_enum ADD VALUE IF NOT EXISTS 'read';

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_success';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'booking_confirmed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'booking_rejected';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'refund_initiated';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'refund_completed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'settlement_completed';

-- Config for triggers
CREATE TABLE IF NOT EXISTS config (
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

-- Ensure bookings columns exist
ALTER TABLE IF EXISTS bookings
  ADD COLUMN IF NOT EXISTS payment_id UUID,
  ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS amount_due NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';

-- Ensure payments columns exist
ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_session_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Ensure refunds columns exist
ALTER TABLE IF EXISTS refunds
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS provider_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure settlements columns exist
ALTER TABLE IF EXISTS settlements
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS provider_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure notifications columns exist
ALTER TABLE IF EXISTS notifications
  ADD COLUMN IF NOT EXISTS status notification_status_enum NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$ BEGIN
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type notification_type_enum;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Payment attempts table
CREATE TABLE IF NOT EXISTS payment_attempts (
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

ALTER TABLE IF EXISTS payment_attempts
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_session_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT,
  ADD COLUMN IF NOT EXISTS upi_app TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
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

CREATE TABLE IF NOT EXISTS wallet_transactions (
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

-- Device tokens
CREATE TABLE IF NOT EXISTS device_tokens (
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

-- Foreign key: bookings.payment_id -> payments.id
DO $$ BEGIN
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Normalize statuses and enforce enum types (safe updates first)
DO $$
BEGIN
  IF to_regclass('public.bookings') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='status') THEN
      UPDATE bookings
        SET status = 'pending'
      WHERE status IS NULL OR status::text NOT IN (
        'pending','requested','accepted','approved','rejected','cancelled','CANCELLED_BY_CUSTOMER',
        'checked-in','checked_in','checked-out','checked_out','completed','PAID','paid',
        'vacate_requested','ACTIVE','ONGOING','active','BOOKED','VACATED','payment_pending',
        'refunded','confirmed'
      );
      ALTER TABLE bookings ALTER COLUMN status TYPE booking_status_enum USING status::booking_status_enum;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='payment_status') THEN
      UPDATE bookings
        SET payment_status = 'pending'
      WHERE payment_status IS NULL OR lower(payment_status::text) NOT IN ('pending','paid','failed','refunded','payment_pending');
      ALTER TABLE bookings ALTER COLUMN payment_status TYPE booking_payment_status_enum USING lower(payment_status::text)::booking_payment_status_enum;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='status') THEN
      UPDATE payments
        SET status = 'pending'
      WHERE status IS NULL OR status::text NOT IN ('created','pending','authorized','success','completed','failed','cancelled','refunded');
      ALTER TABLE payments ALTER COLUMN status TYPE payment_status_enum USING status::payment_status_enum;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.refunds') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='refunds' AND column_name='status') THEN
      UPDATE refunds
        SET status = 'PENDING'
      WHERE status IS NULL OR upper(status::text) NOT IN ('PENDING','PROCESSING','SUCCESS','FAILED','PROCESSED');
      ALTER TABLE refunds ALTER COLUMN status TYPE refund_status_enum USING upper(status::text)::refund_status_enum;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.settlements') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='settlements' AND column_name='status') THEN
      UPDATE settlements
        SET status = 'PENDING'
      WHERE status IS NULL OR upper(status::text) NOT IN ('PENDING','PROCESSING','COMPLETED','FAILED');
      ALTER TABLE settlements ALTER COLUMN status TYPE settlement_status_enum USING upper(status::text)::settlement_status_enum;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.payment_attempts') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_attempts' AND column_name='status') THEN
      UPDATE payment_attempts
        SET status = 'initiated'
      WHERE status IS NULL OR status::text NOT IN ('initiated','pending','success','failed','expired');
      ALTER TABLE payment_attempts ALTER COLUMN status TYPE payment_attempt_status_enum USING status::payment_attempt_status_enum;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.wallets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallets' AND column_name='status') THEN
      UPDATE wallets
        SET status = 'active'
      WHERE status IS NULL OR status::text NOT IN ('active','blocked');
      ALTER TABLE wallets ALTER COLUMN status TYPE wallet_status_enum USING status::wallet_status_enum;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='type') THEN
      UPDATE wallet_transactions
        SET type = 'credit'
      WHERE type IS NULL OR type::text NOT IN ('credit','debit');
      ALTER TABLE wallet_transactions ALTER COLUMN type TYPE wallet_txn_type_enum USING type::wallet_txn_type_enum;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='status') THEN
      UPDATE wallet_transactions
        SET status = 'pending'
      WHERE status IS NULL OR status::text NOT IN ('pending','completed','failed');
      ALTER TABLE wallet_transactions ALTER COLUMN status TYPE wallet_txn_status_enum USING status::wallet_txn_status_enum;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='status') THEN
      UPDATE notifications
        SET status = 'queued'
      WHERE status IS NULL OR status::text NOT IN ('queued','sent','failed','read');
      ALTER TABLE notifications ALTER COLUMN status TYPE notification_status_enum USING status::notification_status_enum;
    END IF;
  END IF;
END $$;

-- Indexes (safe)
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_order_id ON payments(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_id ON payment_attempts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_booking_id ON payment_attempts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_idem ON payment_attempts(idempotency_key)
WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_event ON payment_attempts(provider_event_id)
WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refunds_booking_id ON refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_customer_id ON refunds(customer_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_provider_refund_id ON refunds(provider_refund_id)
WHERE provider_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlements_owner_id ON settlements(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_booking_id ON settlements(booking_id)
WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_provider_transfer_id ON settlements(provider_transfer_id)
WHERE provider_transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallets_owner_id ON wallets(owner_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_settlement_id ON wallet_transactions(settlement_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_status ON device_tokens(status);

-- Updated_at helper
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Updated_at triggers (guarded)
DO $$
BEGIN
  IF to_regclass('public.bookings') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings';
    EXECUTE 'CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_payments_updated_at ON payments';
    EXECUTE 'CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.payment_attempts') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_payment_attempts_updated_at ON payment_attempts';
    EXECUTE 'CREATE TRIGGER update_payment_attempts_updated_at BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.refunds') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_refunds_updated_at ON refunds';
    EXECUTE 'CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.settlements') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_settlements_updated_at ON settlements';
    EXECUTE 'CREATE TRIGGER update_settlements_updated_at BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.wallets') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets';
    EXECUTE 'CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_wallet_transactions_updated_at ON wallet_transactions';
    EXECUTE 'CREATE TRIGGER update_wallet_transactions_updated_at BEFORE UPDATE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.device_tokens') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_device_tokens_updated_at ON device_tokens';
    EXECUTE 'CREATE TRIGGER update_device_tokens_updated_at BEFORE UPDATE ON device_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications';
    EXECUTE 'CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

-- Realtime (guarded)
DO $$
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE payments REPLICA IDENTITY FULL';
  END IF;
  IF to_regclass('public.bookings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE bookings REPLICA IDENTITY FULL';
  END IF;
  IF to_regclass('public.refunds') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE refunds REPLICA IDENTITY FULL';
  END IF;
  IF to_regclass('public.settlements') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE settlements REPLICA IDENTITY FULL';
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE notifications REPLICA IDENTITY FULL';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.payments') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'payments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE payments';
  END IF;
  IF to_regclass('public.bookings') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'bookings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE bookings';
  END IF;
  IF to_regclass('public.refunds') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'refunds'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE refunds';
  END IF;
  IF to_regclass('public.settlements') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'settlements'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE settlements';
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE notifications';
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

DO $$
BEGIN
  IF to_regclass('public.bookings') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS bookings_refund_trigger ON bookings';
    EXECUTE 'CREATE TRIGGER bookings_refund_trigger AFTER UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION trigger_booking_refund()';

    EXECUTE 'DROP TRIGGER IF EXISTS bookings_settlement_trigger ON bookings';
    EXECUTE 'CREATE TRIGGER bookings_settlement_trigger AFTER UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION trigger_booking_settlement()';
  END IF;
END $$;

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

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS notifications_push_trigger ON notifications';
    EXECUTE 'CREATE TRIGGER notifications_push_trigger AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION trigger_notification_push()';
  END IF;
END $$;
