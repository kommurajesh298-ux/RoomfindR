SET search_path = public;

CREATE OR REPLACE FUNCTION public.ensure_missing_refund_requests(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rec RECORD;
    linked_order_id UUID;
    linked_attempt_id UUID;
    effective_customer_id UUID;
    requester_id UUID;
    initiator_role TEXT;
    order_type TEXT;
    refund_reason_code TEXT;
    refund_reason_text TEXT;
    inserted_count INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT
            b.id AS booking_id,
            b.status AS booking_status,
            b.rejection_reason,
            b.customer_id AS booking_customer_id,
            b.owner_id,
            b.admin_reviewed_by,
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
        JOIN LATERAL (
            SELECT p.*
            FROM public.payments p
            WHERE p.booking_id = b.id
              AND lower(COALESCE(p.provider, 'cashfree')) = 'cashfree'
              AND lower(COALESCE(p.status::text, p.payment_status::text, '')) IN (
                  'completed',
                  'success',
                  'authorized',
                  'paid'
              )
            ORDER BY COALESCE(p.verified_at, p.created_at) DESC, p.created_at DESC
            LIMIT 1
        ) p ON TRUE
        WHERE lower(COALESCE(b.status::text, '')) IN (
            'rejected',
            'cancelled',
            'cancelled_by_customer',
            'cancelled-by-customer'
        )
          AND NOT EXISTS (
              SELECT 1
              FROM public.refunds r
              WHERE r.payment_id = p.id
          )
        ORDER BY COALESCE(b.updated_at, b.created_at) DESC, b.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 200), 1)
    LOOP
        effective_customer_id := COALESCE(rec.payment_customer_id, rec.booking_customer_id);
        requester_id := COALESCE(rec.admin_reviewed_by, rec.owner_id);
        initiator_role := CASE
            WHEN rec.admin_reviewed_by IS NOT NULL THEN 'admin'
            WHEN rec.owner_id IS NOT NULL THEN 'owner'
            ELSE 'system'
        END;

        IF effective_customer_id IS NULL OR rec.owner_id IS NULL THEN
            CONTINUE;
        END IF;

        order_type := CASE
            WHEN lower(COALESCE(rec.payment_type, 'advance')) IN ('monthly', 'rent')
                THEN 'rent'
            ELSE 'advance'
        END;

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
                    'source', 'ensure_missing_refund_requests',
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
                    'source', 'ensure_missing_refund_requests',
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
                    'source', 'ensure_missing_refund_requests'
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

        BEGIN
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
                requester_id,
                jsonb_build_object(
                    'source', 'ensure_missing_refund_requests',
                    'prepared_by', 'database_repair'
                ),
                rec.payment_id,
                rec.booking_id,
                effective_customer_id,
                rec.amount,
                refund_reason_code,
                'PENDING',
                initiator_role,
                'cashfree',
                left('RF' || replace(rec.payment_id::text, '-', ''), 40),
                0
            );

            inserted_count := inserted_count + 1;
        EXCEPTION
            WHEN unique_violation THEN
                NULL;
        END;
    END LOOP;

    RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_missing_refund_requests(integer) TO service_role;

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
    PERFORM public.ensure_missing_refund_requests(200);

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

SELECT public.ensure_missing_refund_requests(500);

NOTIFY pgrst, 'reload schema';
