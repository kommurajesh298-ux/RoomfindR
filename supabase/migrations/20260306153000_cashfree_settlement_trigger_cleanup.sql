BEGIN;
CREATE OR REPLACE FUNCTION public.trigger_booking_settlement()
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

    IF (NEW.status IN ('accepted', 'approved')) AND OLD.status IS DISTINCT FROM NEW.status THEN
        IF EXISTS (
            SELECT 1
            FROM public.settlements
            WHERE booking_id = NEW.id
        ) THEN
            RETURN NEW;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.payments
            WHERE booking_id = NEW.id
              AND status IN ('completed', 'success', 'authorized')
        ) THEN
            RETURN NEW;
        END IF;

        SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
        SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

        IF supabase_url IS NULL OR service_key IS NULL THEN
            RAISE NOTICE 'Missing supabase_url or service key for settlement automation';
            RETURN NEW;
        END IF;

        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_key
        );

        PERFORM net.http_post(
            url := supabase_url || '/functions/v1/payoutAdvanceToOwner',
            headers := headers,
            body := jsonb_build_object('bookingId', NEW.id)
        );
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_settlement_trigger ON public.bookings;
CREATE TRIGGER bookings_settlement_trigger
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trigger_booking_settlement();
COMMIT;
