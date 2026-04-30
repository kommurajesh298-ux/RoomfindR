BEGIN;
-- Keep at most one active/successful payout state per booking.
-- (A broader unique constraint on booking_id may already exist; this adds explicit intent.)
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_booking_active_payout_unique
    ON public.settlements(booking_id)
    WHERE booking_id IS NOT NULL
      AND upper(coalesce(payout_status, 'PENDING')) IN ('PENDING', 'PROCESSING', 'SUCCESS');
-- Reserve settlement only when payment is confirmed and state is retry-safe.
CREATE OR REPLACE FUNCTION public.reserve_settlement_for_payout(
    p_settlement_id UUID,
    p_transfer_id TEXT,
    p_reference TEXT DEFAULT NULL
) RETURNS public.settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_settlement public.settlements%ROWTYPE;
    v_booking_id UUID;
    v_payment_confirmed BOOLEAN := FALSE;
BEGIN
    SELECT booking_id
    INTO v_booking_id
    FROM public.settlements
    WHERE id = p_settlement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_booking_id IS NULL THEN
        RAISE EXCEPTION 'SETTLEMENT_BOOKING_MISSING'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.booking_id = v_booking_id
          AND lower(coalesce(p.status, p.payment_status, '')) IN ('completed', 'success', 'paid', 'authorized')
          AND (
              p.verified_at IS NOT NULL
              OR coalesce(p.webhook_received, FALSE) = TRUE
              OR nullif(coalesce(p.provider_payment_id, ''), '') IS NOT NULL
          )
    ) INTO v_payment_confirmed;

    IF NOT v_payment_confirmed THEN
        RAISE EXCEPTION 'PAYMENT_NOT_CONFIRMED'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.settlements
    SET status = 'PROCESSING',
        payout_status = 'PROCESSING',
        provider = 'cashfree',
        provider_transfer_id = coalesce(nullif(p_transfer_id, ''), provider_transfer_id),
        provider_reference = coalesce(nullif(p_reference, ''), provider_reference),
        transaction_id = coalesce(
            nullif(p_reference, ''),
            transaction_id,
            provider_reference,
            provider_transfer_id,
            nullif(p_transfer_id, '')
        ),
        processed_at = NULL,
        failure_reason = NULL,
        payout_attempts = coalesce(payout_attempts, 0) + 1,
        initiated_at = now(),
        approved_at = coalesce(approved_at, now())
    WHERE id = p_settlement_id
      AND (
        upper(coalesce(payout_status, status::text, 'PENDING')) = 'PENDING'
        OR (
            upper(coalesce(payout_status, status::text, '')) = 'FAILED'
            AND upper(coalesce(status::text, '')) = 'FAILED'
        )
      )
    RETURNING * INTO v_settlement;

    RETURN v_settlement;
END;
$$;
-- Idempotent settlement success:
-- never double-credit wallet balances when same callback/event is replayed.
CREATE OR REPLACE FUNCTION public.apply_settlement_success(
    p_settlement_id UUID,
    p_amount NUMERIC,
    p_reference TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_owner_id UUID;
    v_reference TEXT;
    v_pending_total NUMERIC := 0;
    v_failed_total NUMERIC := 0;
    v_is_already_success BOOLEAN := FALSE;
BEGIN
    SELECT
        owner_id,
        coalesce(nullif(p_reference, ''), provider_reference, provider_transfer_id, transaction_id),
        (
            upper(coalesce(payout_status, '')) = 'SUCCESS'
            OR upper(coalesce(status::text, '')) = 'COMPLETED'
        )
    INTO v_owner_id, v_reference, v_is_already_success
    FROM public.settlements
    WHERE id = p_settlement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_is_already_success THEN
        RETURN;
    END IF;

    WITH locked_wallet_txns AS (
        SELECT amount, lower(coalesce(status, '')) AS status_u
        FROM public.wallet_transactions
        WHERE settlement_id = p_settlement_id
        FOR UPDATE
    )
    SELECT
        coalesce(sum(amount) FILTER (WHERE status_u = 'pending'), 0),
        coalesce(sum(amount) FILTER (WHERE status_u = 'failed'), 0)
    INTO v_pending_total, v_failed_total
    FROM locked_wallet_txns;

    UPDATE public.settlements
    SET status = 'COMPLETED',
        payout_status = 'SUCCESS',
        processed_at = now(),
        provider = 'cashfree',
        provider_reference = coalesce(nullif(p_reference, ''), provider_reference, provider_transfer_id),
        transaction_id = coalesce(nullif(p_reference, ''), transaction_id, provider_reference, provider_transfer_id),
        failure_reason = NULL
    WHERE id = p_settlement_id;

    UPDATE public.wallet_transactions
    SET status = 'completed',
        updated_at = now()
    WHERE settlement_id = p_settlement_id
      AND lower(coalesce(status, '')) <> 'completed';

    IF v_owner_id IS NOT NULL AND (v_pending_total > 0 OR v_failed_total > 0) THEN
        UPDATE public.wallets
        SET pending_balance = greatest(0, pending_balance - v_pending_total),
            available_balance = available_balance + v_pending_total + v_failed_total,
            updated_at = now()
        WHERE owner_id = v_owner_id;
    END IF;

    INSERT INTO public.transaction_logs (
        entity_type,
        entity_id,
        settlement_id,
        owner_id,
        event_type,
        status,
        transaction_id,
        message,
        payload
    )
    SELECT
        'settlement',
        p_settlement_id,
        p_settlement_id,
        v_owner_id,
        'settlement_approved',
        'SUCCESS',
        v_reference,
        'Settlement payout completed',
        jsonb_build_object(
            'settlement_id', p_settlement_id,
            'amount', p_amount,
            'reference', v_reference,
            'source', 'apply_settlement_success'
        )
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.transaction_logs tl
        WHERE tl.settlement_id = p_settlement_id
          AND tl.event_type = 'settlement_approved'
          AND upper(coalesce(tl.status, '')) = 'SUCCESS'
          AND coalesce(tl.transaction_id, '') = coalesce(v_reference, '')
    );
END;
$$;
-- Idempotent settlement failure:
-- never double-debit pending wallet amounts and never downgrade successful settlement.
CREATE OR REPLACE FUNCTION public.apply_settlement_failure(
    p_settlement_id UUID,
    p_amount NUMERIC,
    p_failure_reason TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_owner_id UUID;
    v_reference TEXT;
    v_pending_total NUMERIC := 0;
    v_is_already_success BOOLEAN := FALSE;
BEGIN
    SELECT
        owner_id,
        coalesce(transaction_id, provider_reference, provider_transfer_id),
        (
            upper(coalesce(payout_status, '')) = 'SUCCESS'
            OR upper(coalesce(status::text, '')) = 'COMPLETED'
        )
    INTO v_owner_id, v_reference, v_is_already_success
    FROM public.settlements
    WHERE id = p_settlement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'
            USING ERRCODE = 'P0001';
    END IF;

    -- Never override terminal success due to stale/out-of-order failure callbacks.
    IF v_is_already_success THEN
        RETURN;
    END IF;

    WITH locked_wallet_txns AS (
        SELECT amount, lower(coalesce(status, '')) AS status_u
        FROM public.wallet_transactions
        WHERE settlement_id = p_settlement_id
        FOR UPDATE
    )
    SELECT
        coalesce(sum(amount) FILTER (WHERE status_u = 'pending'), 0)
    INTO v_pending_total
    FROM locked_wallet_txns;

    UPDATE public.settlements
    SET status = 'FAILED',
        payout_status = 'FAILED',
        failure_reason = coalesce(nullif(p_failure_reason, ''), failure_reason),
        processed_at = now()
    WHERE id = p_settlement_id;

    UPDATE public.wallet_transactions
    SET status = 'failed',
        updated_at = now()
    WHERE settlement_id = p_settlement_id
      AND lower(coalesce(status, '')) = 'pending';

    IF v_owner_id IS NOT NULL AND v_pending_total > 0 THEN
        UPDATE public.wallets
        SET pending_balance = greatest(0, pending_balance - v_pending_total),
            updated_at = now()
        WHERE owner_id = v_owner_id;
    END IF;

    INSERT INTO public.transaction_logs (
        entity_type,
        entity_id,
        settlement_id,
        owner_id,
        event_type,
        status,
        transaction_id,
        message,
        payload
    )
    SELECT
        'settlement',
        p_settlement_id,
        p_settlement_id,
        v_owner_id,
        'settlement_approval_failed',
        'FAILED',
        v_reference,
        coalesce(nullif(p_failure_reason, ''), 'Settlement payout failed'),
        jsonb_build_object(
            'settlement_id', p_settlement_id,
            'amount', p_amount,
            'failure_reason', p_failure_reason,
            'source', 'apply_settlement_failure'
        )
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.transaction_logs tl
        WHERE tl.settlement_id = p_settlement_id
          AND tl.event_type = 'settlement_approval_failed'
          AND upper(coalesce(tl.status, '')) = 'FAILED'
          AND coalesce(tl.message, '') = coalesce(nullif(p_failure_reason, ''), 'Settlement payout failed')
    );
END;
$$;
-- Backward-compatible wrapper for existing 2-arg callers.
CREATE OR REPLACE FUNCTION public.apply_settlement_failure(
    p_settlement_id UUID,
    p_amount NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    PERFORM public.apply_settlement_failure(p_settlement_id, p_amount, NULL::TEXT);
END;
$$;
-- Automation should only sync in-flight payouts.
-- Failed settlement retries must be explicit/manual from admin action.
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
        SELECT s.id
        FROM public.settlements s
        WHERE coalesce(lower(s.provider), 'cashfree') = 'cashfree'
          AND (
            upper(coalesce(s.status, '')) = 'PROCESSING'
            OR upper(coalesce(s.payout_status, '')) = 'PROCESSING'
          )
          AND coalesce(s.approved_at, s.created_at, now()) >= now() - INTERVAL '7 days'
        ORDER BY coalesce(s.updated_at, s.created_at, now()) ASC
        LIMIT 30
    LOOP
        PERFORM net.http_post(
            url := supabase_url || '/functions/v1/cashfree-settlement',
            headers := headers,
            body := jsonb_build_object(
                'settlementId', rec.id,
                'syncOnly', true
            )
        );
    END LOOP;
END;
$$;
-- Verification helper for post-deploy checks.
CREATE OR REPLACE FUNCTION public.cashfree_payout_integrity_report()
RETURNS TABLE(check_name TEXT, issue_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public AS $$
    SELECT
        'duplicate_provider_event_id'::TEXT AS check_name,
        count(*)::BIGINT AS issue_count
    FROM (
        SELECT provider_event_id
        FROM public.payment_attempts
        WHERE provider_event_id IS NOT NULL
        GROUP BY provider_event_id
        HAVING count(*) > 1
    ) dup_events

    UNION ALL

    SELECT
        'duplicate_settlement_transfer_id'::TEXT AS check_name,
        count(*)::BIGINT AS issue_count
    FROM (
        SELECT provider_transfer_id
        FROM public.settlements
        WHERE nullif(trim(coalesce(provider_transfer_id, '')), '') IS NOT NULL
        GROUP BY provider_transfer_id
        HAVING count(*) > 1
    ) dup_transfers

    UNION ALL

    SELECT
        'duplicate_active_booking_settlement'::TEXT AS check_name,
        count(*)::BIGINT AS issue_count
    FROM (
        SELECT booking_id
        FROM public.settlements
        WHERE booking_id IS NOT NULL
          AND upper(coalesce(payout_status, 'PENDING')) IN ('PENDING', 'PROCESSING', 'SUCCESS')
        GROUP BY booking_id
        HAVING count(*) > 1
    ) dup_active_booking

    UNION ALL

    SELECT
        'duplicate_monthly_payout_booking_month'::TEXT AS check_name,
        count(*)::BIGINT AS issue_count
    FROM (
        SELECT booking_id, month_token
        FROM public.payouts
        GROUP BY booking_id, month_token
        HAVING count(*) > 1
    ) dup_monthly;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_settlement_for_payout(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_success(UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_cashfree_settlement_automation() TO service_role;
GRANT EXECUTE ON FUNCTION public.cashfree_payout_integrity_report() TO authenticated, service_role;
COMMIT;
