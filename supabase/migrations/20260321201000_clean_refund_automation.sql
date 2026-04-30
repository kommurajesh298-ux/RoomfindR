SET search_path = public;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DROP TRIGGER IF EXISTS bookings_refund_trigger ON public.bookings;
DROP TRIGGER IF EXISTS payments_refund_trigger ON public.payments;

DROP FUNCTION IF EXISTS public.trigger_booking_refund();
DROP FUNCTION IF EXISTS public.trigger_payment_refund();

DO $$
DECLARE
    rec RECORD;
    linked_order_id UUID;
    linked_attempt_id UUID;
    refund_reason_code TEXT;
    refund_reason_text TEXT;
    effective_customer_id UUID;
    order_type TEXT;
BEGIN
    FOR rec IN
        SELECT
            b.id AS booking_id,
            b.status AS booking_status,
            b.rejection_reason,
            b.customer_id AS booking_customer_id,
            b.owner_id,
            COALESCE(b.commission_amount, 0) AS booking_commission_amount,
            p.id AS payment_id,
            p.customer_id AS payment_customer_id,
            p.amount,
            p.payment_type,
            p.payment_method,
            p.provider,
            p.provider_order_id,
            p.provider_payment_id,
            p.provider_session_id,
            p.verified_at
        FROM public.bookings b
        JOIN public.payments p
            ON p.booking_id = b.id
        WHERE lower(COALESCE(b.status::text, '')) IN (
            'rejected',
            'cancelled',
            'cancelled_by_customer',
            'cancelled-by-customer'
        )
          AND lower(COALESCE(p.provider, 'cashfree')) = 'cashfree'
          AND lower(COALESCE(p.status::text, p.payment_status::text, '')) IN (
              'completed',
              'success',
              'authorized',
              'paid'
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.refunds r
              WHERE r.payment_id = p.id
          )
        ORDER BY p.created_at ASC
    LOOP
        effective_customer_id := COALESCE(rec.payment_customer_id, rec.booking_customer_id);
        IF effective_customer_id IS NULL OR rec.owner_id IS NULL THEN
            RAISE NOTICE 'Skipping refund backfill for booking %, payment % due to missing owner/customer link.',
                rec.booking_id, rec.payment_id;
            CONTINUE;
        END IF;

        IF lower(COALESCE(rec.payment_type, 'advance')) IN ('monthly', 'rent') THEN
            order_type := 'rent';
        ELSE
            order_type := 'advance';
        END IF;

        SELECT o.id
        INTO linked_order_id
        FROM public.orders o
        WHERE o.booking_id = rec.booking_id
           OR (
               rec.provider_order_id IS NOT NULL
               AND o.cashfree_order_id = rec.provider_order_id
           )
        ORDER BY
            CASE
                WHEN o.booking_id = rec.booking_id THEN 0
                ELSE 1
            END,
            o.created_at DESC
        LIMIT 1;

        IF linked_order_id IS NULL THEN
            INSERT INTO public.orders (
                customer_id,
                owner_id,
                amount_total,
                amount_advance,
                commission_amount,
                status,
                metadata,
                paid_at,
                booking_id,
                order_type,
                cashfree_order_id,
                cf_payment_id
            )
            VALUES (
                effective_customer_id,
                rec.owner_id,
                rec.amount,
                CASE WHEN order_type = 'advance' THEN rec.amount ELSE 0 END,
                rec.booking_commission_amount,
                'paid',
                jsonb_build_object(
                    'source', 'refund_cleanup_backfill',
                    'booking_id', rec.booking_id,
                    'payment_id', rec.payment_id
                ),
                COALESCE(rec.verified_at, now()),
                rec.booking_id,
                order_type,
                rec.provider_order_id,
                rec.provider_payment_id
            )
            RETURNING id INTO linked_order_id;
        END IF;

        SELECT pa.id
        INTO linked_attempt_id
        FROM public.payment_attempts pa
        WHERE pa.payment_id = rec.payment_id
        ORDER BY pa.created_at DESC
        LIMIT 1;

        IF linked_attempt_id IS NULL THEN
            INSERT INTO public.payment_attempts (
                order_id,
                idempotency_key,
                gateway_order_id,
                gateway_payment_id,
                gateway_payment_session_id,
                amount,
                method,
                status,
                webhook_verified,
                gateway_payload,
                booking_id,
                payment_id,
                provider,
                provider_order_id,
                provider_payment_id,
                provider_session_id,
                raw_payload
            )
            VALUES (
                linked_order_id,
                'refund_backfill_attempt_' || replace(rec.payment_id::text, '-', ''),
                rec.provider_order_id,
                rec.provider_payment_id,
                rec.provider_session_id,
                rec.amount,
                COALESCE(NULLIF(rec.payment_method, ''), 'upi'),
                'success',
                TRUE,
                jsonb_build_object(
                    'source', 'refund_cleanup_backfill',
                    'payment_id', rec.payment_id,
                    'booking_id', rec.booking_id
                ),
                rec.booking_id,
                rec.payment_id,
                COALESCE(NULLIF(rec.provider, ''), 'cashfree'),
                rec.provider_order_id,
                rec.provider_payment_id,
                rec.provider_session_id,
                jsonb_build_object(
                    'source', 'refund_cleanup_backfill'
                )
            )
            RETURNING id INTO linked_attempt_id;
        END IF;

        UPDATE public.orders
        SET latest_payment_attempt_id = linked_attempt_id
        WHERE id = linked_order_id
          AND latest_payment_attempt_id IS DISTINCT FROM linked_attempt_id;

        IF lower(COALESCE(rec.booking_status::text, '')) = 'rejected' THEN
            refund_reason_code := 'booking_rejected';
            refund_reason_text := COALESCE(NULLIF(rec.rejection_reason, ''), 'Booking rejected');
        ELSE
            refund_reason_code := 'booking_cancelled';
            refund_reason_text := COALESCE(NULLIF(rec.rejection_reason, ''), 'Booking cancelled');
        END IF;

        INSERT INTO public.refunds (
            payment_attempt_id,
            idempotency_key,
            amount,
            reason,
            status,
            webhook_verified,
            requested_by,
            metadata,
            payment_id,
            booking_id,
            customer_id,
            refund_amount,
            refund_reason,
            refund_status,
            initiated_by,
            provider,
            refund_id,
            commission_amount
        )
        VALUES (
            linked_attempt_id,
            gen_random_uuid()::text,
            rec.amount,
            refund_reason_text,
            'pending',
            FALSE,
            NULL,
            jsonb_build_object(
                'source', 'refund_cleanup_backfill',
                'prepared_by', 'migration'
            ),
            rec.payment_id,
            rec.booking_id,
            effective_customer_id,
            rec.amount,
            refund_reason_code,
            'PENDING',
            'system',
            'cashfree',
            left('RF' || replace(rec.payment_id::text, '-', ''), 40),
            0
        );
    END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS refunds_payment_id_uk
    ON public.refunds(payment_id)
    WHERE payment_id IS NOT NULL;

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

    PERFORM net.http_post(
        url := rtrim(supabase_url, '/') || '/functions/v1/cashfree-refund-sync',
        headers := headers,
        body := jsonb_build_object(
            'limit', 100,
            'minAgeMinutes', 1,
            'trigger', 'pg_cron',
            'internal_key', service_key
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_refund_sync() TO service_role;

DO $$
DECLARE
    existing_job RECORD;
BEGIN
    FOR existing_job IN
        SELECT jobid
        FROM cron.job
        WHERE jobname IN ('cashfree-refund-sync', 'cashfree-refund-sync-every-minute')
           OR command = 'SELECT public.run_refund_sync();'
    LOOP
        PERFORM cron.unschedule(existing_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
        'cashfree-refund-sync-every-minute',
        '* * * * *',
        'SELECT public.run_refund_sync();'
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
