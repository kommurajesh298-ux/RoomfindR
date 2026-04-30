BEGIN;
-- Ensure enums exist (safety)
DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('created','pending','authorized','success','completed','failed','cancelled','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE refund_status_enum AS ENUM ('PENDING','PROCESSING','SUCCESS','FAILED','PROCESSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Ensure pg_net extension for HTTP triggers
CREATE EXTENSION IF NOT EXISTS pg_net;
-- Add required alias columns
ALTER TABLE IF EXISTS payments
    ADD COLUMN IF NOT EXISTS payment_id UUID,
    ADD COLUMN IF NOT EXISTS payment_status payment_status_enum,
    ADD COLUMN IF NOT EXISTS gateway_reference TEXT;
ALTER TABLE IF EXISTS refunds
    ADD COLUMN IF NOT EXISTS refund_id TEXT,
    ADD COLUMN IF NOT EXISTS refund_status refund_status_enum,
    ADD COLUMN IF NOT EXISTS refund_reason TEXT,
    ADD COLUMN IF NOT EXISTS initiated_by TEXT;
-- Backfill aliases
UPDATE payments
SET payment_id = id
WHERE payment_id IS NULL;
UPDATE payments
SET payment_status = status
WHERE payment_status IS NULL;
UPDATE payments
SET gateway_reference = COALESCE(gateway_reference, provider_reference, provider_order_id, provider_payment_id)
WHERE gateway_reference IS NULL;
UPDATE refunds
SET refund_id = COALESCE(refund_id, id::text)
WHERE refund_id IS NULL;
UPDATE refunds
SET refund_status = COALESCE(refund_status, upper(status::text)::refund_status_enum)
WHERE refund_status IS NULL;
UPDATE refunds
SET refund_reason = COALESCE(refund_reason, reason)
WHERE refund_reason IS NULL;
UPDATE refunds
SET initiated_by = COALESCE(initiated_by, 'system')
WHERE initiated_by IS NULL;
-- Sync triggers for aliases
CREATE OR REPLACE FUNCTION sync_payment_aliases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.payment_id := COALESCE(NEW.payment_id, NEW.id);
    NEW.payment_status := NEW.status;
    NEW.gateway_reference := COALESCE(NEW.provider_reference, NEW.gateway_reference, NEW.provider_order_id, NEW.provider_payment_id);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payments_sync_aliases ON payments;
CREATE TRIGGER payments_sync_aliases
BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION sync_payment_aliases();
CREATE OR REPLACE FUNCTION sync_refund_aliases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.refund_id := COALESCE(NEW.refund_id, NEW.id::text);
    NEW.refund_status := COALESCE(NEW.refund_status, upper(NEW.status::text)::refund_status_enum);
    NEW.refund_reason := COALESCE(NEW.refund_reason, NEW.reason);
    NEW.initiated_by := COALESCE(NEW.initiated_by, 'system');
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS refunds_sync_aliases ON refunds;
CREATE TRIGGER refunds_sync_aliases
BEFORE INSERT OR UPDATE ON refunds
FOR EACH ROW
EXECUTE FUNCTION sync_refund_aliases();
-- Updated booking refund trigger to include cancellations and initiated_by
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
    status_lower TEXT;
    actor_id UUID;
    initiated_by TEXT := 'system';
    reason TEXT;
    reason_code TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    status_lower := lower(NEW.status::text);
    IF status_lower NOT IN ('rejected','cancelled','cancelled_by_customer','cancelled-by-customer') THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM refunds
        WHERE booking_id = NEW.id
          AND status IN ('PENDING','PROCESSING','SUCCESS','PROCESSED')
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

    actor_id := auth.uid();
    IF actor_id IS NOT NULL THEN
        IF public.is_admin(auth.uid()) THEN
            initiated_by := 'admin';
        ELSIF actor_id = NEW.owner_id THEN
            initiated_by := 'owner';
        ELSIF actor_id = NEW.customer_id THEN
            initiated_by := 'user';
        END IF;
    END IF;

    IF status_lower = 'rejected' THEN
        reason := COALESCE(NEW.rejection_reason, 'Booking rejected');
        reason_code := 'booking_rejected';
    ELSE
        reason := COALESCE(NEW.rejection_reason, 'Booking cancelled');
        reason_code := 'booking_cancelled';
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
            'reason', reason,
            'refundReason', reason_code,
            'initiatedBy', initiated_by
        )
    );

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_refund_trigger ON bookings;
CREATE TRIGGER bookings_refund_trigger
AFTER UPDATE OF status ON bookings
FOR EACH ROW
EXECUTE FUNCTION trigger_booking_refund();
-- Trigger refunds for duplicate/partial payments or paid bookings that later fail
CREATE OR REPLACE FUNCTION trigger_payment_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
    booking_status TEXT;
    booking_amount_due NUMERIC;
    booking_advance NUMERIC;
    booking_monthly NUMERIC;
    expected_amount NUMERIC;
    reason_code TEXT;
    reason TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF lower(NEW.status::text) NOT IN ('completed','success') THEN
        RETURN NEW;
    END IF;

    IF lower(OLD.status::text) IN ('completed','success') THEN
        RETURN NEW;
    END IF;

    IF lower(COALESCE(NEW.payment_type, '')) = 'monthly' THEN
        RETURN NEW;
    END IF;

    SELECT status, amount_due, advance_paid, monthly_rent
    INTO booking_status, booking_amount_due, booking_advance, booking_monthly
    FROM bookings
    WHERE id = NEW.booking_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF lower(booking_status::text) IN ('rejected','cancelled','cancelled_by_customer','cancelled-by-customer') THEN
        reason_code := 'booking_failed';
        reason := 'Payment received but booking failed';
    END IF;

    IF reason_code IS NULL AND EXISTS (
        SELECT 1 FROM payments
        WHERE booking_id = NEW.booking_id
          AND id <> NEW.id
          AND status IN ('completed','success','authorized')
          AND COALESCE(payment_type, '') = COALESCE(NEW.payment_type, '')
    ) THEN
        reason_code := 'duplicate_payment';
        reason := 'Duplicate payment detected';
    END IF;

    expected_amount := COALESCE(booking_amount_due, booking_advance, booking_monthly, NEW.amount);
    IF reason_code IS NULL AND expected_amount IS NOT NULL AND NEW.amount < (expected_amount - 0.01) THEN
        reason_code := 'partial_payment';
        reason := 'Partial payment detected';
    END IF;

    IF reason_code IS NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM refunds
        WHERE payment_id = NEW.id
          AND status IN ('PENDING','PROCESSING','SUCCESS','PROCESSED')
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
            'paymentId', NEW.id,
            'bookingId', NEW.booking_id,
            'reason', reason,
            'refundReason', reason_code,
            'initiatedBy', 'system'
        )
    );

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payments_refund_trigger ON payments;
CREATE TRIGGER payments_refund_trigger
AFTER UPDATE OF status ON payments
FOR EACH ROW
EXECUTE FUNCTION trigger_payment_refund();
COMMIT;
