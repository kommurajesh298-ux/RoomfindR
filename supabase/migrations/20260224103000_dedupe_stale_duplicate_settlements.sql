BEGIN;
-- Permanently remove stale duplicate settlement rows created for the same
-- owner/property/period/customer/room signature.
--
-- Safety rules:
-- 1) Keep the highest-priority row (completed > processing > pending > failed,
--    then wallet/provider references, then newest/highest amount).
-- 2) Delete only stale rows in pending/failed state with no wallet transaction.
-- 3) Re-point settlement transaction logs to the kept row before delete.
-- 4) Persist an audit trail for every removed row.

ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS payout_status TEXT,
    ADD COLUMN IF NOT EXISTS provider_transfer_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_reference TEXT,
    ADD COLUMN IF NOT EXISTS transaction_id TEXT,
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10, 2) DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.settlement_dedupe_audit (
    id BIGSERIAL PRIMARY KEY,
    old_settlement_id UUID NOT NULL,
    kept_settlement_id UUID NOT NULL,
    signature TEXT NOT NULL,
    dedupe_reason TEXT NOT NULL DEFAULT 'stale_duplicate_same_customer_room_period',
    old_booking_id UUID,
    kept_booking_id UUID,
    old_status TEXT,
    kept_status TEXT,
    old_payout_status TEXT,
    kept_payout_status TEXT,
    old_total_amount NUMERIC(10, 2),
    kept_total_amount NUMERIC(10, 2),
    old_net_payable NUMERIC(10, 2),
    kept_net_payable NUMERIC(10, 2),
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_dedupe_audit_deleted_at
    ON public.settlement_dedupe_audit(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_dedupe_audit_old_id
    ON public.settlement_dedupe_audit(old_settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlement_dedupe_audit_kept_id
    ON public.settlement_dedupe_audit(kept_settlement_id);
CREATE TEMP TABLE tmp_settlement_dedupe_map (
    old_id UUID PRIMARY KEY,
    keep_id UUID NOT NULL,
    signature TEXT NOT NULL
) ON COMMIT DROP;
WITH base AS (
    SELECT
        s.id,
        s.booking_id,
        s.owner_id,
        COALESCE(s.period_type::text, 'WEEKLY') AS period_type,
        s.week_start_date,
        s.week_end_date,
        b.property_id,
        regexp_replace(lower(COALESCE(b.customer_name, '')), '[^a-z0-9]', '', 'g') AS customer_token,
        regexp_replace(lower(COALESCE(b.room_number::text, '')), '[^a-z0-9]', '', 'g') AS room_token,
        CASE
            WHEN upper(COALESCE(s.payout_status, '')) = 'SUCCESS'
              OR upper(COALESCE(s.status::text, '')) = 'COMPLETED'
                THEN 'COMPLETED'
            WHEN upper(COALESCE(s.payout_status, '')) = 'FAILED'
              OR upper(COALESCE(s.status::text, '')) = 'FAILED'
                THEN 'FAILED'
            WHEN upper(COALESCE(s.payout_status, '')) = 'PROCESSING'
              OR upper(COALESCE(s.status::text, '')) = 'PROCESSING'
                THEN 'PROCESSING'
            ELSE 'PENDING'
        END AS resolved_status,
        EXISTS (
            SELECT 1
            FROM public.wallet_transactions wt
            WHERE wt.settlement_id = s.id
        ) AS has_wallet_txn,
        (
            NULLIF(trim(COALESCE(s.transaction_id, '')), '') IS NOT NULL
            OR NULLIF(trim(COALESCE(s.provider_reference, '')), '') IS NOT NULL
            OR NULLIF(trim(COALESCE(s.provider_transfer_id, '')), '') IS NOT NULL
        ) AS has_provider_reference,
        COALESCE(s.updated_at, s.created_at) AS effective_updated_at,
        COALESCE(s.created_at, s.updated_at, NOW()) AS effective_created_at,
        GREATEST(0, COALESCE(s.net_payable, 0) - COALESCE(s.refunded_amount, 0)) AS effective_net_payable,
        COALESCE(s.total_amount, 0) AS effective_total_amount
    FROM public.settlements s
    JOIN public.bookings b
      ON b.id = s.booking_id
    WHERE s.booking_id IS NOT NULL
      AND b.property_id IS NOT NULL
),
grouped AS (
    SELECT
        b.*,
        (
            b.owner_id::text
            || '|' || b.property_id::text
            || '|' || b.period_type
            || '|' || b.week_start_date::text
            || '|' || b.week_end_date::text
            || '|' || b.customer_token
            || '|' || b.room_token
        ) AS signature
    FROM base b
    WHERE b.customer_token <> ''
      AND b.room_token <> ''
),
ranked AS (
    SELECT
        g.*,
        first_value(g.id) OVER (
            PARTITION BY g.signature
            ORDER BY
                CASE g.resolved_status
                    WHEN 'COMPLETED' THEN 0
                    WHEN 'PROCESSING' THEN 1
                    WHEN 'PENDING' THEN 2
                    WHEN 'FAILED' THEN 3
                    ELSE 4
                END,
                CASE WHEN g.has_wallet_txn THEN 1 ELSE 0 END DESC,
                CASE WHEN g.has_provider_reference THEN 1 ELSE 0 END DESC,
                g.effective_updated_at DESC NULLS LAST,
                g.effective_net_payable DESC,
                g.effective_total_amount DESC,
                g.effective_created_at DESC NULLS LAST,
                g.id DESC
        ) AS keep_id,
        row_number() OVER (
            PARTITION BY g.signature
            ORDER BY
                CASE g.resolved_status
                    WHEN 'COMPLETED' THEN 0
                    WHEN 'PROCESSING' THEN 1
                    WHEN 'PENDING' THEN 2
                    WHEN 'FAILED' THEN 3
                    ELSE 4
                END,
                CASE WHEN g.has_wallet_txn THEN 1 ELSE 0 END DESC,
                CASE WHEN g.has_provider_reference THEN 1 ELSE 0 END DESC,
                g.effective_updated_at DESC NULLS LAST,
                g.effective_net_payable DESC,
                g.effective_total_amount DESC,
                g.effective_created_at DESC NULLS LAST,
                g.id DESC
        ) AS rn
    FROM grouped g
)
INSERT INTO tmp_settlement_dedupe_map (old_id, keep_id, signature)
SELECT
    r.id AS old_id,
    r.keep_id,
    r.signature
FROM ranked r
WHERE r.rn > 1
  AND r.id <> r.keep_id
  AND r.resolved_status IN ('PENDING', 'FAILED')
  AND r.has_wallet_txn = FALSE;
INSERT INTO public.settlement_dedupe_audit (
    old_settlement_id,
    kept_settlement_id,
    signature,
    old_booking_id,
    kept_booking_id,
    old_status,
    kept_status,
    old_payout_status,
    kept_payout_status,
    old_total_amount,
    kept_total_amount,
    old_net_payable,
    kept_net_payable
)
SELECT
    m.old_id,
    m.keep_id,
    m.signature,
    old_row.booking_id,
    keep_row.booking_id,
    old_row.status::text,
    keep_row.status::text,
    old_row.payout_status,
    keep_row.payout_status,
    old_row.total_amount,
    keep_row.total_amount,
    old_row.net_payable,
    keep_row.net_payable
FROM tmp_settlement_dedupe_map m
JOIN public.settlements old_row
  ON old_row.id = m.old_id
JOIN public.settlements keep_row
  ON keep_row.id = m.keep_id;
DO $$
BEGIN
    IF to_regclass('public.transaction_logs') IS NOT NULL THEN
        UPDATE public.transaction_logs tl
        SET
            settlement_id = m.keep_id,
            entity_id = CASE
                WHEN lower(COALESCE(tl.entity_type, '')) = 'settlement'
                  AND tl.entity_id = m.old_id
                    THEN m.keep_id
                ELSE tl.entity_id
            END
        FROM tmp_settlement_dedupe_map m
        WHERE tl.settlement_id = m.old_id;
    END IF;
END;
$$;
DELETE FROM public.settlements s
USING tmp_settlement_dedupe_map m
WHERE s.id = m.old_id;
COMMIT;
