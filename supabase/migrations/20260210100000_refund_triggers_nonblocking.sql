BEGIN;
-- Make refund triggers non-blocking so booking status updates don't rollback on HTTP failures.
CREATE OR REPLACE FUNCTION public.trigger_booking_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

    BEGIN
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
    EXCEPTION
        WHEN OTHERS THEN
            -- Never block booking updates if refund dispatch fails.
            RETURN NEW;
    END;

    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.trigger_payment_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

    IF lower(NEW.status::text) NOT IN ('completed','success','authorized') THEN
        RETURN NEW;
    END IF;

    IF lower(OLD.status::text) IN ('completed','success','authorized') THEN
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

    BEGIN
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
    EXCEPTION
        WHEN OTHERS THEN
            -- Never block payment updates if refund dispatch fails.
            RETURN NEW;
    END;

    RETURN NEW;
END;
$$;
COMMIT;
