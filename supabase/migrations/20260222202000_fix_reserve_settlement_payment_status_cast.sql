BEGIN;
-- Fix enum/text COALESCE mismatch in reserve_settlement_for_payout.
-- payments.status and payments.payment_status are enums, so fallback literals
-- must compare against text-cast values.
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
GRANT EXECUTE ON FUNCTION public.reserve_settlement_for_payout(UUID, TEXT, TEXT) TO service_role;
COMMIT;
