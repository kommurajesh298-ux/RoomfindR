BEGIN;
-- Settlement approval + payout lifecycle fields
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS payout_status TEXT;
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS payout_attempts INTEGER NOT NULL DEFAULT 0;
UPDATE public.settlements
SET payout_status = CASE
    WHEN upper(coalesce(status::text, '')) IN ('COMPLETED', 'SETTLEMENT_PAID', 'PAID', 'SUCCESS') THEN 'SUCCESS'
    WHEN upper(coalesce(status::text, '')) IN ('FAILED', 'SETTLEMENT_FAILED') THEN 'FAILED'
    WHEN upper(coalesce(status::text, '')) IN ('PROCESSING', 'SETTLEMENT_PROCESSING') THEN 'PROCESSING'
    ELSE 'PENDING'
END
WHERE payout_status IS NULL;
ALTER TABLE public.settlements
    ALTER COLUMN payout_status SET DEFAULT 'PENDING';
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'settlements_payout_status_check'
          AND conrelid = 'public.settlements'::regclass
    ) THEN
        ALTER TABLE public.settlements
            ADD CONSTRAINT settlements_payout_status_check
            CHECK (payout_status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'));
    END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_settlements_payout_status ON public.settlements(payout_status);
CREATE INDEX IF NOT EXISTS idx_settlements_transaction_id ON public.settlements(transaction_id);
CREATE INDEX IF NOT EXISTS idx_settlements_approved_by ON public.settlements(approved_by);
-- Auditable transaction log for payouts/refunds
CREATE TABLE IF NOT EXISTS public.transaction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL DEFAULT 'settlement',
    entity_id UUID,
    settlement_id UUID REFERENCES public.settlements(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    status TEXT,
    transaction_id TEXT,
    message TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_settlement_id ON public.transaction_logs(settlement_id);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_owner_id ON public.transaction_logs(owner_id);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_created_at ON public.transaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_event_type ON public.transaction_logs(event_type);
ALTER TABLE public.transaction_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_transaction_logs_all ON public.transaction_logs;
CREATE POLICY admin_transaction_logs_all
ON public.transaction_logs
FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS owner_transaction_logs_select ON public.transaction_logs;
CREATE POLICY owner_transaction_logs_select
ON public.transaction_logs
FOR SELECT
USING (owner_id = auth.uid());
-- Retry-safe reserve: allow PENDING + FAILED to move to PROCESSING
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
BEGIN
    UPDATE public.settlements
    SET status = 'PROCESSING',
        payout_status = 'PROCESSING',
        provider = 'cashfree',
        provider_transfer_id = p_transfer_id,
        provider_reference = COALESCE(p_reference, provider_reference),
        processed_at = NULL,
        failure_reason = NULL,
        payout_attempts = COALESCE(payout_attempts, 0) + 1,
        approved_at = NOW()
    WHERE id = p_settlement_id
      AND status IN ('PENDING', 'FAILED')
    RETURNING * INTO v_settlement;

    RETURN v_settlement;
END;
$$;
-- Retry-safe wallet reservation: if a failed txn exists, move it back to pending.
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
BEGIN
    SELECT *
    INTO v_existing
    FROM public.wallet_transactions
    WHERE settlement_id = p_settlement_id
    LIMIT 1;

    IF FOUND THEN
        IF lower(coalesce(v_existing.status, '')) = 'failed' THEN
            UPDATE public.wallet_transactions
            SET status = 'pending',
                reference = p_reference,
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
        p_reference
    );

    UPDATE public.wallets
    SET pending_balance = pending_balance + p_amount
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
    v_wallet_id UUID;
    v_reference TEXT;
BEGIN
    SELECT owner_id, COALESCE(p_reference, provider_reference, provider_transfer_id)
    INTO v_owner_id, v_reference
    FROM public.settlements
    WHERE id = p_settlement_id;

    UPDATE public.settlements
    SET status = 'COMPLETED',
        payout_status = 'SUCCESS',
        processed_at = NOW(),
        provider_reference = COALESCE(p_reference, provider_reference),
        transaction_id = COALESCE(p_reference, transaction_id, provider_reference, provider_transfer_id),
        failure_reason = NULL
    WHERE id = p_settlement_id;

    UPDATE public.wallet_transactions
    SET status = 'completed'
    WHERE settlement_id = p_settlement_id
      AND status <> 'completed';

    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE owner_id = v_owner_id;

    IF v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET pending_balance = GREATEST(0, pending_balance - p_amount),
            available_balance = available_balance + p_amount
        WHERE id = v_wallet_id;
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
    VALUES (
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
            'reference', v_reference
        )
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
BEGIN
    SELECT owner_id INTO v_owner_id
    FROM public.settlements
    WHERE id = p_settlement_id;

    UPDATE public.settlements
    SET status = 'FAILED',
        payout_status = 'FAILED',
        failure_reason = COALESCE(p_failure_reason, failure_reason),
        processed_at = NOW()
    WHERE id = p_settlement_id;

    UPDATE public.wallet_transactions
    SET status = 'failed'
    WHERE settlement_id = p_settlement_id
      AND status <> 'failed';

    UPDATE public.wallets w
    SET pending_balance = GREATEST(0, pending_balance - p_amount)
    FROM public.settlements s
    WHERE s.id = p_settlement_id
      AND s.owner_id = w.owner_id;

    INSERT INTO public.transaction_logs (
        entity_type,
        entity_id,
        settlement_id,
        owner_id,
        event_type,
        status,
        message,
        payload
    )
    VALUES (
        'settlement',
        p_settlement_id,
        p_settlement_id,
        v_owner_id,
        'settlement_approval_failed',
        'FAILED',
        COALESCE(p_failure_reason, 'Settlement payout failed'),
        jsonb_build_object(
            'settlement_id', p_settlement_id,
            'amount', p_amount,
            'failure_reason', p_failure_reason
        )
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
GRANT EXECUTE ON FUNCTION public.reserve_settlement_for_payout(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_wallet_transaction(UUID, UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_success(UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC, TEXT) TO service_role;
COMMIT;
