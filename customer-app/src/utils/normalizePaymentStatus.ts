/**
 * Shared Payment Status Normalization Utilities
 * Centralized status mapping for settlements, payments, and refunds
 */

export type SettlementStatus = 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'PENDING';
export type RefundStatus = 'SUCCESS' | 'FAILED' | 'PROCESSING' | 'PENDING' | 'ONHOLD';
export type RentPaymentStatus = 'paid' | 'failed' | 'pending';

/**
 * Normalize settlement status from various sources
 * @param settlement Settlement object with potential status fields
 * @returns Normalized settlement status
 */
export const normalizeSettlementStatus = (settlement: Record<string, unknown>): SettlementStatus => {
    const candidates = [
        String(settlement.payout_status || ''),
        String(settlement.status || ''),
        String(settlement.settlement_status || ''),
    ].map((value) => value.trim().toLowerCase()).filter(Boolean);

    if (candidates.some((status) => ['success', 'completed', 'paid', 'settled'].includes(status))) {
        return 'COMPLETED';
    }
    if (candidates.some((status) => ['failed', 'rejected', 'cancelled', 'terminated'].includes(status))) {
        return 'FAILED';
    }
    if (candidates.some((status) => ['processing', 'payout_pending', 'initiated', 'in_progress'].includes(status))) {
        return 'PROCESSING';
    }
    return 'PENDING';
};

/**
 * Normalize rent payment status
 * @param payment Payment object with payment_status or status field
 * @returns Normalized payment status
 */
export const normalizeRentPaymentStatus = (payment: Record<string, unknown>): RentPaymentStatus => {
    const normalized = String(payment.payment_status || payment.status || '').trim().toLowerCase();
    if (['paid', 'completed', 'success', 'authorized'].includes(normalized)) return 'paid';
    if (['failed', 'cancelled', 'refunded', 'expired', 'terminated', 'rejected'].includes(normalized)) return 'failed';
    return 'pending';
};

/**
 * Normalize refund status from various sources
 * Handles both uppercase and lowercase formats
 * @param refund Refund object with refund_status or status field
 * @returns Normalized refund status
 */
export const normalizeRefundStatus = (refund: Record<string, unknown>): RefundStatus => {
    const normalized = String(refund.refund_status || refund.status || '').trim().toUpperCase();
    if (['SUCCESS', 'PROCESSED'].includes(normalized)) return 'SUCCESS';
    if (['FAILED', 'CANCELLED', 'REJECTED'].includes(normalized)) return 'FAILED';
    if (normalized === 'PENDING') return 'PENDING';
    if (normalized === 'ONHOLD') return 'ONHOLD';
    if (['PROCESSING', 'PARTIAL'].includes(normalized)) return 'PROCESSING';

    const legacy = String(refund.refund_status || refund.status || '').trim().toLowerCase();
    if (legacy === 'success' || legacy === 'processed') return 'SUCCESS';
    if (legacy === 'failed' || legacy === 'cancelled' || legacy === 'rejected') return 'FAILED';
    if (legacy === 'pending') return 'PENDING';
    if (legacy === 'onhold' || legacy === 'on_hold' || legacy === 'on hold') return 'ONHOLD';
    if (legacy === 'processing' || legacy === 'partial') return 'PROCESSING';
    return 'PENDING';
};

/**
 * Alternative refund status normalizer that accepts primary and fallback values
 * Used in customer app for backward compatibility
 * @param primary Primary status value
 * @param fallback Fallback status value
 * @returns Normalized refund status
 */
export const normalizeRefundStatusAlt = (primary: unknown, fallback?: unknown): RefundStatus => {
    const normalized = String(primary || fallback || '').trim().toUpperCase();
    if (['SUCCESS', 'PROCESSED'].includes(normalized)) return 'SUCCESS';
    if (['FAILED', 'CANCELLED', 'REJECTED'].includes(normalized)) return 'FAILED';
    if (normalized === 'PENDING') return 'PENDING';
    if (normalized === 'ONHOLD') return 'ONHOLD';
    if (['PROCESSING', 'PARTIAL'].includes(normalized)) return 'PROCESSING';

    const legacy = String(primary || fallback || '').trim().toLowerCase();
    if (legacy === 'success' || legacy === 'processed') return 'SUCCESS';
    if (legacy === 'failed' || legacy === 'cancelled' || legacy === 'rejected') return 'FAILED';
    if (legacy === 'pending') return 'PENDING';
    if (legacy === 'onhold' || legacy === 'on_hold' || legacy === 'on hold') return 'ONHOLD';
    if (legacy === 'processing' || legacy === 'partial') return 'PROCESSING';
    return 'PENDING';
};
