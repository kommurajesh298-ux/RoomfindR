BEGIN;
-- =========================================================
-- Deduplicate payments before adding unique constraints
-- =========================================================
CREATE TEMP TABLE payment_dedupe_map (
    old_id UUID PRIMARY KEY,
    keep_id UUID NOT NULL
);
WITH ranked AS (
    SELECT
        id,
        provider_payment_id,
        FIRST_VALUE(id) OVER (
            PARTITION BY provider_payment_id
            ORDER BY
                CASE
                    WHEN lower(status::text) = 'refunded' THEN 0
                    WHEN lower(status::text) IN ('completed', 'success', 'authorized') THEN 1
                    WHEN lower(status::text) IN ('pending', 'created') THEN 2
                    WHEN lower(status::text) IN ('failed', 'cancelled') THEN 3
                    ELSE 4
                END,
                created_at DESC NULLS LAST,
                id DESC
        ) AS keep_id
    FROM payments
    WHERE provider_payment_id IS NOT NULL
)
INSERT INTO payment_dedupe_map (old_id, keep_id)
SELECT id, keep_id
FROM ranked
WHERE id <> keep_id;
WITH ranked AS (
    SELECT
        p.id,
        p.provider_order_id,
        FIRST_VALUE(p.id) OVER (
            PARTITION BY p.provider_order_id
            ORDER BY
                CASE
                    WHEN lower(p.status::text) = 'refunded' THEN 0
                    WHEN lower(p.status::text) IN ('completed', 'success', 'authorized') THEN 1
                    WHEN lower(p.status::text) IN ('pending', 'created') THEN 2
                    WHEN lower(p.status::text) IN ('failed', 'cancelled') THEN 3
                    ELSE 4
                END,
                p.created_at DESC NULLS LAST,
                p.id DESC
        ) AS ranked_keep,
        MIN(m.keep_id::text) OVER (PARTITION BY p.provider_order_id) AS mapped_keep
    FROM payments p
    LEFT JOIN payment_dedupe_map m ON p.id = m.keep_id
    WHERE p.provider_order_id IS NOT NULL
)
INSERT INTO payment_dedupe_map (old_id, keep_id)
SELECT id, COALESCE(mapped_keep::uuid, ranked_keep)
FROM ranked
WHERE id <> COALESCE(mapped_keep::uuid, ranked_keep)
  AND NOT EXISTS (SELECT 1 FROM payment_dedupe_map existing WHERE existing.old_id = ranked.id);
WITH ranked AS (
    SELECT
        p.id,
        p.idempotency_key,
        FIRST_VALUE(p.id) OVER (
            PARTITION BY p.idempotency_key
            ORDER BY
                CASE
                    WHEN lower(p.status::text) = 'refunded' THEN 0
                    WHEN lower(p.status::text) IN ('completed', 'success', 'authorized') THEN 1
                    WHEN lower(p.status::text) IN ('pending', 'created') THEN 2
                    WHEN lower(p.status::text) IN ('failed', 'cancelled') THEN 3
                    ELSE 4
                END,
                p.created_at DESC NULLS LAST,
                p.id DESC
        ) AS ranked_keep,
        MIN(m.keep_id::text) OVER (PARTITION BY p.idempotency_key) AS mapped_keep
    FROM payments p
    LEFT JOIN payment_dedupe_map m ON p.id = m.keep_id
    WHERE p.idempotency_key IS NOT NULL
)
INSERT INTO payment_dedupe_map (old_id, keep_id)
SELECT id, COALESCE(mapped_keep::uuid, ranked_keep)
FROM ranked
WHERE id <> COALESCE(mapped_keep::uuid, ranked_keep)
  AND NOT EXISTS (SELECT 1 FROM payment_dedupe_map existing WHERE existing.old_id = ranked.id);
WITH RECURSIVE chain AS (
    SELECT old_id, keep_id, keep_id AS final_id
    FROM payment_dedupe_map
    UNION ALL
    SELECT c.old_id, c.keep_id, m.keep_id AS final_id
    FROM chain c
    JOIN payment_dedupe_map m ON c.final_id = m.old_id
),
final_map AS (
    SELECT old_id, final_id
    FROM chain
    WHERE NOT EXISTS (
        SELECT 1 FROM payment_dedupe_map m WHERE m.old_id = chain.final_id
    )
)
UPDATE payment_dedupe_map m
SET keep_id = f.final_id
FROM final_map f
WHERE m.old_id = f.old_id
  AND m.keep_id <> f.final_id;
-- Re-point foreign keys to canonical payments
UPDATE payment_attempts pa
SET payment_id = m.keep_id
FROM payment_dedupe_map m
WHERE pa.payment_id = m.old_id;
UPDATE refunds r
SET payment_id = m.keep_id
FROM payment_dedupe_map m
WHERE r.payment_id = m.old_id;
UPDATE rent_payments rp
SET payment_id = m.keep_id
FROM payment_dedupe_map m
WHERE rp.payment_id = m.old_id;
UPDATE wallet_transactions wt
SET payment_id = m.keep_id
FROM payment_dedupe_map m
WHERE wt.payment_id = m.old_id;
UPDATE payment_audit_logs pal
SET payment_id = m.keep_id
FROM payment_dedupe_map m
WHERE pal.payment_id = m.old_id;
UPDATE payments p
SET payment_id = m.keep_id
FROM payment_dedupe_map m
WHERE p.payment_id = m.old_id;
UPDATE bookings b
SET payment_id = m.keep_id
FROM payment_dedupe_map m
WHERE b.payment_id = m.old_id;
-- Remove duplicate payments
DELETE FROM payments p
USING payment_dedupe_map m
WHERE p.id = m.old_id;
-- =========================================================
-- Deduplicate refunds before adding unique constraints
-- =========================================================
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY payment_id
            ORDER BY
                CASE
                    WHEN upper(COALESCE(refund_status::text, status::text, '')) IN ('SUCCESS', 'PROCESSED', 'REFUNDED', 'COMPLETED') THEN 0
                    WHEN upper(COALESCE(refund_status::text, status::text, '')) IN ('PROCESSING', 'PENDING', 'ONHOLD') THEN 1
                    WHEN upper(COALESCE(refund_status::text, status::text, '')) IN ('FAILED', 'CANCELLED', 'REJECTED') THEN 2
                    ELSE 3
                END,
                created_at DESC NULLS LAST,
                id DESC
        ) AS rn
    FROM refunds
    WHERE payment_id IS NOT NULL
)
DELETE FROM refunds r
USING ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY refund_id
            ORDER BY
                CASE
                    WHEN upper(COALESCE(refund_status::text, status::text, '')) IN ('SUCCESS', 'PROCESSED', 'REFUNDED', 'COMPLETED') THEN 0
                    WHEN upper(COALESCE(refund_status::text, status::text, '')) IN ('PROCESSING', 'PENDING', 'ONHOLD') THEN 1
                    WHEN upper(COALESCE(refund_status::text, status::text, '')) IN ('FAILED', 'CANCELLED', 'REJECTED') THEN 2
                    ELSE 3
                END,
                created_at DESC NULLS LAST,
                id DESC
        ) AS rn
    FROM refunds
    WHERE refund_id IS NOT NULL
)
DELETE FROM refunds r
USING ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;
-- =========================================================
-- Deduplicate wallet transactions per settlement
-- =========================================================
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY settlement_id
            ORDER BY
                CASE
                    WHEN status = 'completed' THEN 0
                    WHEN status = 'pending' THEN 1
                    WHEN status = 'failed' THEN 2
                    ELSE 3
                END,
                created_at DESC NULLS LAST,
                id DESC
        ) AS rn
    FROM wallet_transactions
    WHERE settlement_id IS NOT NULL
)
DELETE FROM wallet_transactions wt
USING ranked
WHERE wt.id = ranked.id
  AND ranked.rn > 1;
-- Recalculate wallet balances from remaining transactions
WITH sums AS (
    SELECT
        wallet_id,
        COALESCE(SUM(CASE
            WHEN status = 'completed' AND type = 'credit' THEN amount
            WHEN status = 'completed' AND type = 'debit' THEN -amount
            ELSE 0
        END), 0) AS available_balance,
        COALESCE(SUM(CASE
            WHEN status = 'pending' AND type = 'credit' THEN amount
            WHEN status = 'pending' AND type = 'debit' THEN -amount
            ELSE 0
        END), 0) AS pending_balance
    FROM wallet_transactions
    GROUP BY wallet_id
)
UPDATE wallets w
SET
    available_balance = s.available_balance,
    pending_balance = s.pending_balance
FROM sums s
WHERE w.id = s.wallet_id;
UPDATE wallets w
SET available_balance = 0,
    pending_balance = 0
WHERE NOT EXISTS (
    SELECT 1 FROM wallet_transactions wt WHERE wt.wallet_id = w.id
);
COMMIT;
