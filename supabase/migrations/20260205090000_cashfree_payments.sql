-- Cashfree Payments & Payouts schema reset (non-destructive)
-- Phase 1: enums + tables + realtime + idempotency

-- =============================
-- ENUMS
-- =============================
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
-- =============================
-- LEGACY CLEANUP
-- =============================
DROP TABLE IF EXISTS owner_settlements CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
-- =============================
-- BOOKINGS (align statuses + payment linkage)
-- =============================
DROP TRIGGER IF EXISTS bookings_settlement_trigger ON bookings;
DROP TRIGGER IF EXISTS bookings_refund_trigger ON bookings;
DROP POLICY IF EXISTS "Booking visibility policy v2" ON bookings;
DROP POLICY IF EXISTS "Booking update policy v2" ON bookings;
DROP POLICY IF EXISTS "Booking visibility policy v3" ON bookings;
DROP POLICY IF EXISTS "Booking update policy v3" ON bookings;
DROP POLICY IF EXISTS "Customers can view own bookings" ON bookings;
DROP POLICY IF EXISTS "Customers can create bookings" ON bookings;
DROP POLICY IF EXISTS "Users can update related bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can manage all bookings" ON bookings;
ALTER TABLE bookings
    ALTER COLUMN status TYPE booking_status_enum USING status::booking_status_enum;
ALTER TABLE bookings
    ALTER COLUMN payment_status TYPE booking_payment_status_enum USING lower(payment_status::text)::booking_payment_status_enum;
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS payment_id UUID,
    ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'cashfree',
    ADD COLUMN IF NOT EXISTS payment_method TEXT,
    ADD COLUMN IF NOT EXISTS amount_due NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
DO $$ BEGIN
    ALTER TABLE bookings
        ADD CONSTRAINT bookings_payment_id_fkey
        FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- =============================
-- PAYMENTS
-- =============================
DROP TRIGGER IF EXISTS payments_refund_trigger ON payments;
ALTER TABLE payments
    ALTER COLUMN status TYPE payment_status_enum USING status::payment_status_enum;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR',
    ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
    ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_session_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_reference TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS failure_reason TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
-- =============================
-- PAYMENT ATTEMPTS (new)
-- =============================
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
-- =============================
-- REFUNDS
-- =============================
ALTER TABLE refunds
    ALTER COLUMN status TYPE refund_status_enum USING upper(status::text)::refund_status_enum;
ALTER TABLE refunds
    ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
    ADD COLUMN IF NOT EXISTS provider_refund_id TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- =============================
-- SETTLEMENTS
-- =============================
ALTER TABLE settlements
    ALTER COLUMN status TYPE settlement_status_enum USING status::settlement_status_enum;
ALTER TABLE settlements
    ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
    ADD COLUMN IF NOT EXISTS provider_transfer_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_reference TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE settlements DROP CONSTRAINT IF EXISTS unique_settlement_per_week;
-- =============================
-- WALLETS (new)
-- =============================
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    available_balance NUMERIC(10, 2) NOT NULL DEFAULT 0,
    pending_balance NUMERIC(10, 2) NOT NULL DEFAULT 0,
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
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT DEFAULT 'INR',
    type wallet_txn_type_enum NOT NULL,
    status wallet_txn_status_enum NOT NULL DEFAULT 'pending',
    reference TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- =============================
-- NOTIFICATIONS (expanded)
-- =============================
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS status notification_status_enum NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS role TEXT,
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DO $$ BEGIN
    ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS notification_type notification_type_enum;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- =============================
-- DEVICE TOKENS (Android push)
-- =============================
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
-- =============================
-- INDEXES (Realtime + lookups)
-- =============================
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
-- =============================
-- UPDATED_AT TRIGGERS
-- =============================
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_payment_attempts_updated_at ON payment_attempts;
CREATE TRIGGER update_payment_attempts_updated_at BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_refunds_updated_at ON refunds;
CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_settlements_updated_at ON settlements;
CREATE TRIGGER update_settlements_updated_at BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_wallet_transactions_updated_at ON wallet_transactions;
CREATE TRIGGER update_wallet_transactions_updated_at BEFORE UPDATE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_device_tokens_updated_at ON device_tokens;
CREATE TRIGGER update_device_tokens_updated_at BEFORE UPDATE ON device_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications;
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- =============================
-- REALTIME (PUBLICATION)
-- =============================
ALTER TABLE payments REPLICA IDENTITY FULL;
ALTER TABLE bookings REPLICA IDENTITY FULL;
ALTER TABLE refunds REPLICA IDENTITY FULL;
ALTER TABLE settlements REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'payments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE payments;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'bookings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'refunds'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE refunds;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'settlements'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE settlements;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    END IF;
END $$;
-- =============================
-- AUTOMATION TRIGGERS (Refunds + Settlements)
-- =============================
CREATE EXTENSION IF NOT EXISTS pg_net;
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
            body := jsonb_build_object(
                'bookingId', NEW.id
            )
        );
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_refund_trigger ON bookings;
CREATE TRIGGER bookings_refund_trigger
AFTER UPDATE OF status ON bookings
FOR EACH ROW
EXECUTE FUNCTION trigger_booking_refund();
DROP TRIGGER IF EXISTS bookings_settlement_trigger ON bookings;
CREATE TRIGGER bookings_settlement_trigger
AFTER UPDATE OF status ON bookings
FOR EACH ROW
EXECUTE FUNCTION trigger_booking_settlement();
-- =============================
-- NOTIFICATION PUSH TRIGGER
-- =============================
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
