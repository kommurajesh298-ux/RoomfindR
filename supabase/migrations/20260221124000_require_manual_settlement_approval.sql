BEGIN;
-- Booking status changes should only prepare pending settlements.
-- Never start payout from DB triggers.
CREATE OR REPLACE FUNCTION public.trigger_booking_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF lower(coalesce(NEW.status::text, '')) IN ('accepted', 'approved') THEN
            PERFORM public.prepare_settlement_for_booking(NEW.id);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_settlement_trigger ON public.bookings;
CREATE TRIGGER bookings_settlement_trigger
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trigger_booking_settlement();
-- Auto-sync/auto-retry is allowed only for settlements already approved by admin.
CREATE OR REPLACE FUNCTION public.run_cashfree_settlement_automation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
    rec RECORD;
    should_sync_only BOOLEAN;
    min_retry_interval INTERVAL := INTERVAL '45 seconds';
    max_retry_attempts INTEGER := 5;
BEGIN
    SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL
       OR service_key IS NULL
       OR supabase_url LIKE 'REPLACE_WITH_%'
       OR service_key LIKE 'REPLACE_WITH_%' THEN
        RAISE NOTICE 'Missing supabase_url or service key for settlement automation';
        RETURN;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    FOR rec IN
        SELECT
            s.id,
            upper(coalesce(s.status, '')) AS status_u,
            upper(coalesce(s.payout_status, '')) AS payout_status_u
        FROM public.settlements s
        WHERE coalesce(lower(s.provider), 'cashfree') = 'cashfree'
          AND s.approved_at IS NOT NULL
          AND s.approved_at >= now() - INTERVAL '7 days'
          AND (
            upper(coalesce(s.status, '')) = 'PROCESSING'
            OR upper(coalesce(s.payout_status, '')) = 'PROCESSING'
            OR (
                upper(coalesce(s.status, '')) = 'FAILED'
                AND upper(coalesce(s.payout_status, '')) = 'FAILED'
                AND coalesce(s.failure_reason, '') ILIKE '%retry payout%'
                AND coalesce(s.failure_reason, '') NOT ILIKE '%await provider confirmation%'
                AND coalesce(s.payout_attempts, 0) < max_retry_attempts
                AND coalesce(s.updated_at, s.created_at, now()) <= now() - min_retry_interval
            )
          )
        ORDER BY coalesce(s.updated_at, s.created_at, now()) ASC
        LIMIT 30
    LOOP
        should_sync_only := (rec.status_u = 'PROCESSING' OR rec.payout_status_u = 'PROCESSING');

        PERFORM net.http_post(
            url := supabase_url || '/functions/v1/cashfree-settlement',
            headers := headers,
            body := CASE
                WHEN should_sync_only
                    THEN jsonb_build_object('settlementId', rec.id, 'syncOnly', true)
                ELSE jsonb_build_object('settlementId', rec.id, 'autoRetry', true)
            END
        );
    END LOOP;
END;
$$;
COMMIT;
