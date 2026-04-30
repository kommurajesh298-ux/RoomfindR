SET search_path = public;

CREATE OR REPLACE FUNCTION public.run_refund_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
    refund_row RECORD;
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
        RAISE NOTICE 'Missing supabase_url or service key for refund sync automation.';
        RETURN;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key,
        'x-supabase-auth', 'Bearer ' || service_key,
        'apikey', service_key
    );

    FOR refund_row IN
        SELECT
            r.id,
            r.booking_id,
            r.payment_id
        FROM public.refunds r
        WHERE (
            upper(COALESCE(r.refund_status, r.status, '')) IN ('PENDING', 'PROCESSING', 'ONHOLD')
            OR (
                upper(COALESCE(r.refund_status, r.status, '')) = 'FAILED'
                AND COALESCE(NULLIF(r.refund_id, ''), NULLIF(r.provider_refund_id, '')) IS NOT NULL
                AND r.processed_at IS NULL
            )
        )
          AND COALESCE(r.updated_at, r.created_at) <= (now() - interval '1 minute')
        ORDER BY COALESCE(r.updated_at, r.created_at) ASC, r.created_at ASC
        LIMIT 50
    LOOP
        PERFORM net.http_post(
            url := rtrim(supabase_url, '/') || '/functions/v1/cashfree-refund',
            headers := headers,
            body := jsonb_build_object(
                'action', 'sync',
                'refundRowId', refund_row.id,
                'bookingId', refund_row.booking_id,
                'paymentId', refund_row.payment_id,
                'initiatedBy', 'system',
                'internal_key', service_key
            )
        );
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_refund_sync() TO service_role;
