BEGIN;
-- Payments: enforce unique external identifiers + idempotency keys
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_unique
    ON payments(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_order_unique
    ON payments(provider_order_id)
    WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_unique
    ON payments(provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
-- Refunds: enforce one refund per payment and unique refund ids
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_payment_unique
    ON refunds(payment_id)
    WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_refund_id_unique
    ON refunds(refund_id)
    WHERE refund_id IS NOT NULL;
-- Settlements: prevent duplicate wallet credits per settlement
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_txn_settlement_unique
    ON wallet_transactions(settlement_id)
    WHERE settlement_id IS NOT NULL;
COMMIT;
