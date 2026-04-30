-- Keep Cashfree settlements fully automated after admin approval.
-- 1) Poll PROCESSING settlements even if admin UI is closed.
-- 2) Auto-retry eligible FAILED settlements (bounded attempts + cooldown).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
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
            upper(coalesce(s.payout_status, '')) AS payout_status_u,
            coalesce(s.failure_reason, '') AS failure_reason,
            coalesce(s.payout_attempts, 0) AS payout_attempts,
            coalesce(s.updated_at, s.created_at, now()) AS updated_at
        FROM public.settlements s
        WHERE coalesce(lower(s.provider), 'cashfree') = 'cashfree'
          AND (
            -- Always sync active processing records.
            upper(coalesce(s.status, '')) = 'PROCESSING'
            OR upper(coalesce(s.payout_status, '')) = 'PROCESSING'
            -- Retry only explicit retryable failed records (not awaiting provider).
            OR (
                upper(coalesce(s.status, '')) = 'FAILED'
                AND upper(coalesce(s.payout_status, '')) = 'FAILED'
                AND coalesce(s.failure_reason, '') ILIKE '%retry payout%'
                AND coalesce(s.failure_reason, '') NOT ILIKE '%await provider confirmation%'
                AND coalesce(s.payout_attempts, 0) < max_retry_attempts
                AND coalesce(s.updated_at, s.created_at, now()) <= now() - min_retry_interval
            )
          )
          AND coalesce(s.approved_at, s.created_at, now()) >= now() - INTERVAL '7 days'
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
                ELSE jsonb_build_object('settlementId', rec.id)
            END
        );
    END LOOP;
END;
$$;
DO $$
DECLARE
    job_id INT;
BEGIN
    SELECT jobid INTO job_id
    FROM cron.job
    WHERE jobname = 'cashfree-settlement-automation';

    IF job_id IS NOT NULL THEN
        PERFORM cron.unschedule(job_id);
    END IF;

    PERFORM cron.schedule(
        'cashfree-settlement-automation',
        '* * * * *',
        'SELECT public.run_cashfree_settlement_automation();'
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_cashfree_settlement_automation() TO service_role;
