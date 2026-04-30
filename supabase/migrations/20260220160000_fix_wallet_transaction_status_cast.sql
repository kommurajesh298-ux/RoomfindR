BEGIN;
-- Fix enum cast crash in ensure_wallet_transaction:
-- lower(coalesce(v_existing.status, '')) tries to cast '' to wallet_txn_status_enum
-- and fails with: invalid input value for enum wallet_txn_status_enum: "".
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
BEGIN
    v_reference := NULLIF(trim(COALESCE(p_reference, '')), '');

    SELECT *
    INTO v_existing
    FROM public.wallet_transactions
    WHERE settlement_id = p_settlement_id
    LIMIT 1;

    IF FOUND THEN
        IF lower(COALESCE(v_existing.status::text, '')) = 'failed' THEN
            UPDATE public.wallet_transactions
            SET status = 'pending',
                reference = v_reference,
                amount = p_amount,
                updated_at = NOW()
            WHERE id = v_existing.id;

            UPDATE public.wallets
            SET pending_balance = pending_balance + p_amount
            WHERE id = p_wallet_id;

            RETURN TRUE;
        END IF;

        RETURN FALSE;
    END IF;

    INSERT INTO public.wallet_transactions (
        wallet_id,
        settlement_id,
        amount,
        type,
        status,
        reference
    )
    VALUES (
        p_wallet_id,
        p_settlement_id,
        p_amount,
        'credit',
        'pending',
        v_reference
    );

    UPDATE public.wallets
    SET pending_balance = pending_balance + p_amount
    WHERE id = p_wallet_id;

    RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_wallet_transaction(UUID, UUID, NUMERIC, TEXT) TO service_role;
COMMIT;
