import { supabase } from './supabase-config';
import { invokeProtectedEdgeFunction } from './protected-edge.service';
import type { Refund } from '../types/booking.types';
import { normalizeRefundStatusAlt } from '../utils/normalizePaymentStatus';

type RefundSyncResponse = {
    success?: boolean;
    refund?: Record<string, unknown> | null;
    error?: string;
};

const mapRefundRecord = (data: Record<string, unknown>): Refund => ({
    id: String(data.id || ''),
    paymentId: String(data.payment_id || ''),
    bookingId: String(data.booking_id || ''),
    refundAmount: Number(data.refund_amount || 0),
    reason: String(data.reason || ''),
    status: normalizeRefundStatusAlt(data.refund_status, data.status),
    providerRefundId: data.provider_refund_id ? String(data.provider_refund_id) : undefined,
    processedAt: data.processed_at ? String(data.processed_at) : undefined,
    createdAt: String(data.created_at || '')
});

const isGatewaySyncPending = (refund: Refund | null): refund is Refund =>
    refund?.status === 'PROCESSING' || refund?.status === 'ONHOLD';

const isBenignRefundSyncError = (error: unknown) => {
    const message = String((error as { message?: string } | null)?.message || error || '').trim().toLowerCase();
    return message.includes('refund does not exist') || message.includes('awaiting admin review');
};

export const refundService = {
    // Fetch refund by booking ID
    getRefundByBookingId: async (bookingId: string): Promise<Refund | null> => {
        const { data, error } = await supabase
            .from('refunds')
            .select('*')
            .eq('booking_id', bookingId)
            .maybeSingle();

        if (error) {
            console.error('[RefundService] Error fetching refund:', error);
            throw error;
        }

        if (!data) return null;

        return mapRefundRecord(data as unknown as Record<string, unknown>);
    },

    syncRefund: async (refund: Pick<Refund, 'id' | 'bookingId' | 'paymentId'>): Promise<Refund | null> => {
        try {
            const response = await invokeProtectedEdgeFunction<RefundSyncResponse>(
                'cashfree-refund',
                {
                    action: 'sync',
                    refundRowId: refund.id,
                    bookingId: refund.bookingId,
                    paymentId: refund.paymentId,
                    initiatedBy: 'customer'
                },
                'Refund status sync failed'
            );

            if (!response?.refund || typeof response.refund !== 'object') {
                return null;
            }

            return mapRefundRecord(response.refund);
        } catch (error) {
            if (isBenignRefundSyncError(error)) {
                return null;
            }
            console.error('[RefundService] Refund sync failed:', error);
            return null;
        }
    },

    // Real-time subscription to refund status changes
    subscribeToRefund: (bookingId: string, callback: (refund: Refund | null) => void): (() => void) => {
        let syncTimer: number | null = null;

        const stopSyncTimer = () => {
            if (syncTimer !== null && typeof window !== 'undefined') {
                window.clearInterval(syncTimer);
                syncTimer = null;
            }
        };

        const syncCurrentRefund = async () => {
            const latest = await refundService.getRefundByBookingId(bookingId);
            callback(latest);

            if (!isGatewaySyncPending(latest)) {
                stopSyncTimer();
                return;
            }

            const synced = await refundService.syncRefund(latest);
            if (synced) {
                callback(synced);
                if (!isGatewaySyncPending(synced)) {
                    stopSyncTimer();
                }
            }
        };

        const ensureSyncTimer = (refund: Refund | null) => {
            if (!isGatewaySyncPending(refund) || typeof window === 'undefined') {
                stopSyncTimer();
                return;
            }

            if (syncTimer !== null) return;
            syncTimer = window.setInterval(() => {
                void syncCurrentRefund();
            }, 5000);
        };

        const emitAndSchedule = async () => {
            const refund = await refundService.getRefundByBookingId(bookingId);
            callback(refund);
            ensureSyncTimer(refund);

            if (isGatewaySyncPending(refund)) {
                const synced = await refundService.syncRefund(refund);
                if (synced) {
                    callback(synced);
                    ensureSyncTimer(synced);
                }
            }
        };

        void emitAndSchedule();

        const channel = supabase
            .channel(`refund-sync-${bookingId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'refunds',
                    filter: `booking_id=eq.${bookingId}`
                },
                async (payload) => {
                    void payload;
                    await emitAndSchedule();
                }
            )
            .subscribe();

        return () => {
            stopSyncTimer();
            supabase.removeChannel(channel);
        };
    }
};
