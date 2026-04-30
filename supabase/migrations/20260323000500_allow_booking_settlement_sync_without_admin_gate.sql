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

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.admin_approved IS NOT DISTINCT FROM OLD.admin_approved THEN
        RETURN NEW;
    END IF;

    IF lower(COALESCE(NEW.status::text, '')) NOT IN ('approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing') THEN
        RETURN NEW;
    END IF;

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

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_payment_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    normalized_status TEXT := lower(COALESCE(NEW.status, NEW.payment_status, ''));
    previous_status TEXT := lower(COALESCE(OLD.status, OLD.payment_status, ''));
    booking_status TEXT;
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
        RETURN NEW;
    END IF;

    IF lower(COALESCE(NEW.provider, '')) <> 'cashfree' THEN
        RETURN NEW;
    END IF;

    IF normalized_status NOT IN ('completed', 'success', 'authorized') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND previous_status = normalized_status
       AND previous_status IN ('completed', 'success', 'authorized') THEN
        RETURN NEW;
    END IF;

    SELECT lower(status::text)
    INTO booking_status
    FROM bookings
    WHERE id = NEW.booking_id;

    IF booking_status IS NULL THEN
        RETURN NEW;
    END IF;

    IF booking_status NOT IN ('approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing') THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM settlements
        WHERE payment_id = NEW.id
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
            'bookingId', NEW.booking_id,
            'paymentId', NEW.id
        )
    );

    RETURN NEW;
END;
$$;
