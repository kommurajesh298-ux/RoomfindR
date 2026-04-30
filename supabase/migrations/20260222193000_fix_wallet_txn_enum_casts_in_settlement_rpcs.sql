BEGIN;
-- Fix enum-cast crash in settlement RPCs.
-- lower(coalesce(status, '')) attempts to cast '' to wallet_txn_status_enum and fails.
-- Use status::text consistently before coalesce/lower comparisons.

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
        SELECT amount, lower(coalesce(status::text, '')) AS status_u
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
      AND lower(coalesce(status::text, '')) <> 'completed';

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

    IF v_is_already_success THEN
        RETURN;
    END IF;

    WITH locked_wallet_txns AS (
        SELECT amount, lower(coalesce(status::text, '')) AS status_u
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
      AND lower(coalesce(status::text, '')) = 'pending';

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
-- Keep one canonical signature to avoid RPC ambiguity.
DROP FUNCTION IF EXISTS public.apply_settlement_failure(UUID, NUMERIC);
GRANT EXECUTE ON FUNCTION public.apply_settlement_success(UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC, TEXT) TO service_role;
COMMIT;
