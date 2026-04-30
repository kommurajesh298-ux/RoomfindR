-- Reconcile pending owner signup bank verification transfers via pg_cron.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_owner_signup_bank_verification_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url TEXT;
  service_key TEXT;
  headers JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
  SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

  IF supabase_url IS NULL
     OR service_key IS NULL
     OR supabase_url LIKE 'REPLACE_WITH_%'
     OR service_key LIKE 'REPLACE_WITH_%' THEN
    RAISE NOTICE 'Missing supabase_url or service key for owner signup bank verification sync.';
    RETURN;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || service_key
  );

  PERFORM net.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/sync-owner-signup-bank-verifications',
    headers := headers,
    body := jsonb_build_object(
      'limit', 50,
      'trigger', 'pg_cron'
    )
  );
END;
$$;

DO $$
DECLARE
  existing_job_id INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO existing_job_id
    FROM cron.job
    WHERE jobname = 'owner-signup-bank-verification-sync-every-5m';

    IF existing_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(existing_job_id);
    END IF;

    PERFORM cron.schedule(
      'owner-signup-bank-verification-sync-every-5m',
      '*/5 * * * *',
      'SELECT public.run_owner_signup_bank_verification_sync();'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_owner_signup_bank_verification_sync() TO service_role;
