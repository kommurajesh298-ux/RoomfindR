BEGIN;
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_booking_active_payout_unique
    ON public.settlements(booking_id)
    WHERE booking_id IS NOT NULL
      AND upper(coalesce(payout_status, 'PENDING')) IN ('PENDING', 'PROCESSING', 'SUCCESS');
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
          AND lower(coalesce(p.status::text, p.payment_status::text, '')) IN ('completed', 'success', 'paid', 'authorized')
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
        approved_at = coalesce(approved_at, now()) ,
        updated_at = now()
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
CREATE OR REPLACE FUNCTION public.ensure_wallet_transaction(
    p_wallet_id UUID,
    p_settlement_id UUID,
    p_amount NUMERIC,
    p_reference TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_existing public.wallet_transactions%ROWTYPE;
    v_reference TEXT;
    v_payment_id UUID;
BEGIN
    IF p_settlement_id IS NULL THEN
        RAISE EXCEPTION 'p_settlement_id is required';
    END IF;

    v_reference := NULLIF(trim(COALESCE(p_reference, '')), '');

    SELECT COALESCE(b.payment_id, p.id)
    INTO v_payment_id
    FROM public.settlements s
    LEFT JOIN public.bookings b
      ON b.id = s.booking_id
    LEFT JOIN LATERAL (
        SELECT p2.id
        FROM public.payments p2
        WHERE p2.booking_id = s.booking_id
        ORDER BY
            CASE
                WHEN lower(coalesce(p2.status::text, p2.payment_status::text, '')) IN ('completed', 'success', 'authorized', 'paid') THEN 0
                ELSE 1
            END,
            p2.created_at DESC NULLS LAST
        LIMIT 1
    ) p ON TRUE
    WHERE s.id = p_settlement_id
    LIMIT 1;

    SELECT *
    INTO v_existing
    FROM public.wallet_transactions
    WHERE settlement_id = p_settlement_id
    LIMIT 1;

    IF FOUND THEN
        IF lower(coalesce(v_existing.status::text, '')) = 'failed' THEN
            UPDATE public.wallet_transactions
            SET status = 'pending',
                reference = coalesce(v_reference, v_existing.reference),
                amount = p_amount,
                payment_id = coalesce(v_existing.payment_id, v_payment_id),
                updated_at = now()
            WHERE id = v_existing.id;

            UPDATE public.wallets
            SET pending_balance = pending_balance + p_amount,
                updated_at = now()
            WHERE id = p_wallet_id;

            RETURN TRUE;
        END IF;

        RETURN FALSE;
    END IF;

    INSERT INTO public.wallet_transactions (
        wallet_id,
        settlement_id,
        payment_id,
        amount,
        type,
        status,
        reference
    )
    VALUES (
        p_wallet_id,
        p_settlement_id,
        v_payment_id,
        p_amount,
        'credit',
        'pending',
        v_reference
    );

    UPDATE public.wallets
    SET pending_balance = pending_balance + p_amount,
        updated_at = now()
    WHERE id = p_wallet_id;

    RETURN TRUE;
END;
$$;
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
        failure_reason = NULL,
        updated_at = now()
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
    v_pending_total NUMERIC := 0;
    v_is_already_success BOOLEAN := FALSE;
BEGIN
    SELECT
        owner_id,
        (
            upper(coalesce(payout_status, '')) = 'SUCCESS'
            OR upper(coalesce(status::text, '')) = 'COMPLETED'
        )
    INTO v_owner_id, v_is_already_success
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
    SELECT coalesce(sum(amount) FILTER (WHERE status_u = 'pending'), 0)
    INTO v_pending_total
    FROM locked_wallet_txns;

    UPDATE public.settlements
    SET status = 'FAILED',
        payout_status = 'FAILED',
        failure_reason = coalesce(nullif(p_failure_reason, ''), failure_reason, 'Settlement payout failed'),
        processed_at = now(),
        updated_at = now()
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
END;
$$;
DROP FUNCTION IF EXISTS public.apply_settlement_failure(UUID, NUMERIC);
GRANT EXECUTE ON FUNCTION public.reserve_settlement_for_payout(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_wallet_transaction(UUID, UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_success(UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC, TEXT) TO service_role;
COMMIT;
