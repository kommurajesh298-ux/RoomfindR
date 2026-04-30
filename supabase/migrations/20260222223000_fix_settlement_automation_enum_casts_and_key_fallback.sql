BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
-- Fix enum/text cast issues in automation query and support either service key config key.
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
    SELECT value
    INTO supabase_url
    FROM public.config
    WHERE key = 'supabase_url';

    SELECT value
    INTO service_key
    FROM public.config
    WHERE key IN ('service_role_key', 'supabase_service_role_key')
      AND nullif(trim(coalesce(value, '')), '') IS NOT NULL
    ORDER BY CASE WHEN key = 'service_role_key' THEN 0 ELSE 1 END
    LIMIT 1;

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
            upper(coalesce(s.status::text, '')) AS status_u,
            upper(coalesce(s.payout_status, '')) AS payout_status_u
        FROM public.settlements s
        WHERE coalesce(lower(s.provider), 'cashfree') = 'cashfree'
          AND s.approved_at IS NOT NULL
          AND s.approved_at >= now() - INTERVAL '7 days'
          AND (
            upper(coalesce(s.status::text, '')) = 'PROCESSING'
            OR upper(coalesce(s.payout_status, '')) = 'PROCESSING'
            OR (
                upper(coalesce(s.status::text, '')) = 'FAILED'
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
                ELSE jsonb_build_object('settlementId', rec.id, 'manualRetry', true)
            END
        );
    END LOOP;
END;
$$;
DO $$
DECLARE
    existing_job_id INTEGER;
BEGIN
    SELECT jobid
    INTO existing_job_id
    FROM cron.job
    WHERE jobname = 'cashfree-settlement-automation';

    IF existing_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(existing_job_id);
    END IF;

    PERFORM cron.schedule(
        'cashfree-settlement-automation',
        '* * * * *',
        'SELECT public.run_cashfree_settlement_automation();'
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_cashfree_settlement_automation() TO service_role;
COMMIT;
