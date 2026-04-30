BEGIN;
-- Fix ambiguous is_admin() call inside refund trigger by using explicit JWT check.
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
        IF (auth.jwt()->'user_metadata'->>'role') = 'admin' THEN
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
COMMIT;
