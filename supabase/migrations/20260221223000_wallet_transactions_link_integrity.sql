-- Ensure wallet_transactions always keep at least one concrete source link.
-- Backfills recoverable links, removes irrecoverable orphan rows, and guards future writes.

BEGIN;
DO $$
BEGIN
    IF to_regclass('public.wallet_transactions') IS NULL THEN
        RAISE NOTICE 'public.wallet_transactions does not exist; skipping migration.';
        RETURN;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.resolve_wallet_txn_payment_id(
    p_settlement_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_payment_id UUID;
BEGIN
    IF p_settlement_id IS NULL THEN
        RETURN NULL;
    END IF;

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
                WHEN lower(coalesce(p2.status::text, '')) IN ('completed', 'success', 'authorized', 'paid') THEN 0
                ELSE 1
            END,
            p2.created_at DESC NULLS LAST
        LIMIT 1
    ) p ON TRUE
    WHERE s.id = p_settlement_id
    LIMIT 1;

    RETURN v_payment_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.resolve_wallet_txn_settlement_id(
    p_payment_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_settlement_id UUID;
BEGIN
    IF p_payment_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT s.id
    INTO v_settlement_id
    FROM public.payments p
    JOIN public.settlements s
      ON s.booking_id = p.booking_id
    WHERE p.id = p_payment_id
    ORDER BY
        CASE
            WHEN upper(coalesce(s.payout_status, s.status::text, '')) IN ('PROCESSING', 'PENDING') THEN 0
            WHEN upper(coalesce(s.payout_status, s.status::text, '')) IN ('SUCCESS', 'COMPLETED') THEN 1
            WHEN upper(coalesce(s.payout_status, s.status::text, '')) = 'FAILED' THEN 2
            ELSE 3
        END,
        s.updated_at DESC NULLS LAST,
        s.created_at DESC NULLS LAST
    LIMIT 1;

    RETURN v_settlement_id;
END;
$$;
-- 1) Fill missing payment_id from settlement.
WITH resolved_payment AS (
    SELECT
        wt.id,
        public.resolve_wallet_txn_payment_id(wt.settlement_id) AS payment_id
    FROM public.wallet_transactions wt
    WHERE wt.payment_id IS NULL
      AND wt.settlement_id IS NOT NULL
)
UPDATE public.wallet_transactions wt
SET payment_id = rp.payment_id
FROM resolved_payment rp
WHERE wt.id = rp.id
  AND rp.payment_id IS NOT NULL;
-- 2) Fill missing settlement_id from payment.
WITH resolved_settlement AS (
    SELECT
        wt.id,
        public.resolve_wallet_txn_settlement_id(wt.payment_id) AS settlement_id
    FROM public.wallet_transactions wt
    WHERE wt.settlement_id IS NULL
      AND wt.payment_id IS NOT NULL
)
UPDATE public.wallet_transactions wt
SET settlement_id = rs.settlement_id
FROM resolved_settlement rs
WHERE wt.id = rs.id
  AND rs.settlement_id IS NOT NULL;
-- 3) Recover missing settlement_id using wallet reference values.
WITH unresolved AS (
    SELECT
        wt.id,
        wt.reference,
        (regexp_match(coalesce(wt.reference, ''), '^stl_([a-f0-9]{12})_'))[1] AS settlement_prefix
    FROM public.wallet_transactions wt
    WHERE wt.settlement_id IS NULL
),
match_by_reference AS (
    SELECT
        u.id,
        COALESCE(s_exact.id, s_prefix.id) AS settlement_id
    FROM unresolved u
    LEFT JOIN public.settlements s_exact
      ON u.reference IS NOT NULL
     AND (
        s_exact.provider_transfer_id = u.reference
        OR s_exact.provider_reference = u.reference
        OR s_exact.transaction_id = u.reference
     )
    LEFT JOIN LATERAL (
        SELECT s.id
        FROM public.settlements s
        WHERE u.settlement_prefix IS NOT NULL
          AND replace(s.id::text, '-', '') LIKE u.settlement_prefix || '%'
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT 1
    ) s_prefix ON s_exact.id IS NULL
)
UPDATE public.wallet_transactions wt
SET settlement_id = m.settlement_id
FROM match_by_reference m
WHERE wt.id = m.id
  AND m.settlement_id IS NOT NULL
  AND wt.settlement_id IS NULL;
-- 4) Re-fill payment_id after settlement recovery.
WITH resolved_payment_retry AS (
    SELECT
        wt.id,
        public.resolve_wallet_txn_payment_id(wt.settlement_id) AS payment_id
    FROM public.wallet_transactions wt
    WHERE wt.payment_id IS NULL
      AND wt.settlement_id IS NOT NULL
)
UPDATE public.wallet_transactions wt
SET payment_id = rp.payment_id
FROM resolved_payment_retry rp
WHERE wt.id = rp.id
  AND rp.payment_id IS NOT NULL;
-- 5) Log and remove rows that still cannot be linked to either payment or settlement.
-- Use audit_logs (generic) instead of transaction_logs (settlement/refund-centric),
-- so we don't create synthetic NULLs in settlement_id/refund_id columns.
INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details
)
SELECT
    NULL::uuid,
    'wallet_txn_orphan_cleanup',
    'wallet_transaction',
    wt.id,
    jsonb_build_object(
        'message', 'Removed orphan wallet transaction with no payment_id/settlement_id',
        'owner_id', w.owner_id,
        'wallet_transaction_id', wt.id,
        'wallet_id', wt.wallet_id,
        'reference', wt.reference,
        'amount', wt.amount,
        'type', wt.type,
        'status', wt.status,
        'created_at', wt.created_at
    )
FROM public.wallet_transactions wt
JOIN public.wallets w
  ON w.id = wt.wallet_id
WHERE wt.settlement_id IS NULL
  AND wt.payment_id IS NULL;
DELETE FROM public.wallet_transactions
WHERE settlement_id IS NULL
  AND payment_id IS NULL;
CREATE OR REPLACE FUNCTION public.fill_and_guard_wallet_transaction_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF NEW.settlement_id IS NOT NULL AND NEW.payment_id IS NULL THEN
        NEW.payment_id := public.resolve_wallet_txn_payment_id(NEW.settlement_id);
    END IF;

    IF NEW.payment_id IS NOT NULL AND NEW.settlement_id IS NULL THEN
        NEW.settlement_id := public.resolve_wallet_txn_settlement_id(NEW.payment_id);
    END IF;

    IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
        IF NEW.settlement_id IS NOT NULL THEN
            SELECT COALESCE(s.transaction_id, s.provider_reference, s.provider_transfer_id)
            INTO NEW.reference
            FROM public.settlements s
            WHERE s.id = NEW.settlement_id;
        ELSIF NEW.payment_id IS NOT NULL THEN
            SELECT COALESCE(p.provider_payment_id, p.provider_order_id, p.idempotency_key)
            INTO NEW.reference
            FROM public.payments p
            WHERE p.id = NEW.payment_id;
        END IF;
    END IF;

    IF NEW.settlement_id IS NULL AND NEW.payment_id IS NULL THEN
        RAISE EXCEPTION 'wallet_transactions requires settlement_id or payment_id';
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wallet_transactions_fill_guard ON public.wallet_transactions;
CREATE TRIGGER wallet_transactions_fill_guard
BEFORE INSERT OR UPDATE ON public.wallet_transactions
FOR EACH ROW
EXECUTE FUNCTION public.fill_and_guard_wallet_transaction_links();
ALTER TABLE public.wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_source_link_chk;
ALTER TABLE public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_source_link_chk
    CHECK (settlement_id IS NOT NULL OR payment_id IS NOT NULL);
-- Ensure new settlement wallet credits keep payment_id attached.
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
    v_payment_id := public.resolve_wallet_txn_payment_id(p_settlement_id);

    SELECT *
    INTO v_existing
    FROM public.wallet_transactions
    WHERE settlement_id = p_settlement_id
    LIMIT 1;

    IF FOUND THEN
        IF lower(COALESCE(v_existing.status::text, '')) = 'failed' THEN
            UPDATE public.wallet_transactions
            SET status = 'pending',
                reference = COALESCE(v_reference, v_existing.reference),
                amount = p_amount,
                payment_id = COALESCE(v_existing.payment_id, v_payment_id),
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
    SET pending_balance = pending_balance + p_amount
    WHERE id = p_wallet_id;

    RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_wallet_txn_payment_id(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_wallet_txn_settlement_id(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_wallet_transaction(UUID, UUID, NUMERIC, TEXT) TO service_role;
COMMIT;
