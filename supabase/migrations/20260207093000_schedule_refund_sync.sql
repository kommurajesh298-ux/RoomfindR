-- Schedule refund reconciliation to keep apps in sync when webhooks are missed.
-- Uses pg_cron + pg_net to call the cashfree-refund-sync Edge Function.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE OR REPLACE FUNCTION public.run_refund_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE NOTICE 'Missing supabase_url or service key for refund sync';
        RETURN;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/cashfree-refund-sync',
        headers := headers,
        body := jsonb_build_object(
            'minAgeMinutes', 1,
            'limit', 200
        )
    );
END;
$$;
DO $$
DECLARE
    job_id INT;
BEGIN
    SELECT jobid INTO job_id
    FROM cron.job
    WHERE jobname = 'cashfree-refund-sync';

    IF job_id IS NOT NULL THEN
        PERFORM cron.unschedule(job_id);
    END IF;

    PERFORM cron.schedule(
        'cashfree-refund-sync',
        '*/10 * * * *',
        'SELECT public.run_refund_sync();'
    );
END;
$$;
