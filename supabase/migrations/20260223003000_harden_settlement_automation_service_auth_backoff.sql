BEGIN;
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
    service_key_is_jwt BOOLEAN := FALSE;
    min_retry_interval INTERVAL := INTERVAL '10 minutes';
    max_retry_attempts INTEGER := 2;
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

    service_key_is_jwt := service_key ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$';

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-service-role-key', service_key
    );

    IF service_key_is_jwt THEN
        headers := headers || jsonb_build_object(
            'Authorization', 'Bearer ' || service_key
        );
    END IF;

    FOR rec IN
        SELECT
            s.id,
            upper(coalesce(s.status::text, '')) AS status_u,
            upper(coalesce(s.payout_status, '')) AS payout_status_u,
            lower(coalesce(s.failure_reason, '')) AS failure_reason_l
        FROM public.settlements s
        WHERE coalesce(lower(s.provider), 'cashfree') = 'cashfree'
          AND s.approved_at IS NOT NULL
          AND s.approved_at >= now() - INTERVAL '30 days'
          AND (
            upper(coalesce(s.status::text, '')) = 'PROCESSING'
            OR upper(coalesce(s.payout_status, '')) = 'PROCESSING'
            OR (
                upper(coalesce(s.status::text, '')) = 'FAILED'
                AND upper(coalesce(s.payout_status, '')) = 'FAILED'
                AND coalesce(s.payout_attempts, 0) < max_retry_attempts
                AND coalesce(s.updated_at, s.created_at, now()) <= now() - min_retry_interval
                AND coalesce(s.failure_reason, '') NOT ILIKE '%await provider confirmation%'
                AND coalesce(s.failure_reason, '') !~* '(invalid ifsc|ifsc invalid|invalid account|account number invalid|beneficiary validation failed|invalid beneficiary|kyc|compliance|insufficient wallet balance|insufficient balance|insufficient funds)'
                AND (
                    coalesce(s.failure_reason, '') = ''
                    OR coalesce(s.failure_reason, '') ~* '(intermittent|partner bank|timeout|temporary|network|retry payout)'
                )
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
GRANT EXECUTE ON FUNCTION public.run_cashfree_settlement_automation() TO service_role;
COMMIT;
