BEGIN;

ALTER TABLE public.settlements
  DROP CONSTRAINT IF EXISTS unique_settlement_per_booking;

DROP INDEX IF EXISTS public.idx_settlements_booking_id;

CREATE INDEX IF NOT EXISTS idx_settlements_booking_id
  ON public.settlements(booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_payment_id
  ON public.settlements(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.backfill_missing_monthly_settlement_automation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
    rec RECORD;
    queued_count INTEGER := 0;
BEGIN
    SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE NOTICE 'Missing supabase_url or service key for monthly settlement backfill';
        RETURN 0;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key,
        'x-supabase-auth', 'Bearer ' || service_key
    );

    FOR rec IN
        SELECT p.id AS payment_id, p.booking_id
        FROM public.payments p
        JOIN public.bookings b
          ON b.id = p.booking_id
        WHERE lower(COALESCE(p.payment_type, '')) IN ('monthly', 'rent')
          AND lower(COALESCE(p.payment_status, p.status, '')) IN ('paid', 'completed', 'success', 'authorized')
          AND lower(COALESCE(b.status::text, '')) IN ('approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing')
          AND NOT EXISTS (
              SELECT 1
              FROM public.settlements s
              WHERE s.payment_id = p.id
          )
        ORDER BY p.created_at ASC
    LOOP
        PERFORM net.http_post(
            url := rtrim(supabase_url, '/') || '/functions/v1/cashfree-settlement',
            headers := headers,
            body := jsonb_build_object(
                'bookingId', rec.booking_id,
                'paymentId', rec.payment_id,
                'createOnly', FALSE
            )
        );

        queued_count := queued_count + 1;
    END LOOP;

    RETURN queued_count;
END;
$$;

SELECT public.backfill_missing_monthly_settlement_automation();

GRANT EXECUTE ON FUNCTION public.backfill_missing_monthly_settlement_automation() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
