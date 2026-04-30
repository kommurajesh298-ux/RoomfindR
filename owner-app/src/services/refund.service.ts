import { supabase } from './supabase-config';
import { invokeProtectedEdgeFunction } from './protected-edge.service';

type OwnerRefund = {
    id: string;
    paymentId: string;
    bookingId: string;
    refundAmount: number;
    reason?: string;
    status: 'PENDING' | 'PROCESSING' | 'ONHOLD' | 'SUCCESS' | 'FAILED';
    providerRefundId?: string;
    processedAt?: string;
    createdAt: string;
};

type OwnerRefundHistoryItem = OwnerRefund & {
    customerName?: string;
    propertyTitle?: string;
};

type RefundSyncResponse = {
    success?: boolean;
    refund?: Record<string, unknown> | null;
    error?: string;
};

const normalizeRefundStatus = (primary: unknown, fallback?: unknown): OwnerRefund['status'] => {
    const normalized = String(primary || fallback || '').trim().toUpperCase();
    if (['SUCCESS', 'PROCESSED'].includes(normalized)) return 'SUCCESS';
    if (['FAILED', 'CANCELLED', 'REJECTED'].includes(normalized)) return 'FAILED';
    if (normalized === 'PENDING') return 'PENDING';
    if (normalized === 'ONHOLD') return 'ONHOLD';
    if (['PROCESSING', 'PARTIAL'].includes(normalized)) return 'PROCESSING';
    return 'PENDING';
};

const mapRefundRecord = (data: Record<string, unknown>): OwnerRefund => ({
    id: String(data.id || ''),
    paymentId: String(data.payment_id || ''),
    bookingId: String(data.booking_id || ''),
    refundAmount: Number(data.refund_amount || 0),
    reason: data.reason ? String(data.reason) : undefined,
    status: normalizeRefundStatus(data.refund_status, data.status),
    providerRefundId: data.provider_refund_id ? String(data.provider_refund_id) : undefined,
    processedAt: data.processed_at ? String(data.processed_at) : undefined,
    createdAt: String(data.created_at || '')
});

const mapOwnerRefundHistoryItem = (
    refund: Record<string, unknown>,
    booking?: Record<string, unknown>
): OwnerRefundHistoryItem => ({
    ...mapRefundRecord(refund),
    customerName: booking?.customer_name ? String(booking.customer_name) : undefined,
    propertyTitle: booking?.properties && typeof booking.properties === 'object' && !Array.isArray(booking.properties)
        ? String((booking.properties as Record<string, unknown>).title || '')
        : undefined,
});

const isProcessingRefund = (refund: OwnerRefund | null): refund is OwnerRefund =>
    refund?.status === 'PROCESSING' || refund?.status === 'ONHOLD';

export const refundService = {
    getRefundByBookingId: async (bookingId: string): Promise<OwnerRefund | null> => {
        const { data, error } = await supabase
            .from('refunds')
            .select('*')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[OwnerRefundService] Error fetching refund:', error);
            throw error;
        }

        if (!data) return null;

        return mapRefundRecord(data as unknown as Record<string, unknown>);
    },

    syncRefund: async (refund: Pick<OwnerRefund, 'id' | 'bookingId' | 'paymentId'>): Promise<OwnerRefund | null> => {
        try {
            const response = await invokeProtectedEdgeFunction<RefundSyncResponse>(
                'cashfree-refund',
                {
                    action: 'sync',
                    refundRowId: refund.id,
                    bookingId: refund.bookingId,
                    paymentId: refund.paymentId,
                    initiatedBy: 'owner'
                },
                'Refund status sync failed'
            );

            if (!response?.refund || typeof response.refund !== 'object') {
                return null;
            }

            return mapRefundRecord(response.refund);
        } catch (error) {
            console.error('[OwnerRefundService] Refund sync failed:', error);
            return null;
        }
    },

    subscribeToRefund: (bookingId: string, callback: (refund: OwnerRefund | null) => void): (() => void) => {
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

            if (!isProcessingRefund(latest)) {
                stopSyncTimer();
                return;
            }

            const synced = await refundService.syncRefund(latest);
            if (synced) {
                callback(synced);
                if (!isProcessingRefund(synced)) {
                    stopSyncTimer();
                }
            }
        };

        const ensureSyncTimer = (refund: OwnerRefund | null) => {
            if (!isProcessingRefund(refund) || typeof window === 'undefined') {
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

            if (isProcessingRefund(refund)) {
                const synced = await refundService.syncRefund(refund);
                if (synced) {
                    callback(synced);
                    ensureSyncTimer(synced);
                }
            }
        };

        void emitAndSchedule();

        const channel = supabase
            .channel(`owner-refund-sync-${bookingId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'refunds',
                    filter: `booking_id=eq.${bookingId}`
                },
                async () => {
                    await emitAndSchedule();
                }
            )
            .subscribe();

        return () => {
            stopSyncTimer();
            supabase.removeChannel(channel);
        };
    },

    getOwnerRefunds: async (ownerId: string): Promise<OwnerRefundHistoryItem[]> => {
        const { data: bookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('id, customer_name, properties!bookings_property_id_fkey(title)')
            .eq('owner_id', ownerId);

        if (bookingsError) {
            console.error('[OwnerRefundService] Error fetching owner bookings for refunds:', bookingsError);
            throw bookingsError;
        }

        if (!bookings?.length) return [];

        const bookingMap = new Map<string, Record<string, unknown>>(
            bookings.map((booking) => [String(booking.id), booking as unknown as Record<string, unknown>])
        );

        const { data: refunds, error: refundsError } = await supabase
            .from('refunds')
            .select('*')
            .in('booking_id', [...bookingMap.keys()])
            .order('created_at', { ascending: false });

        if (refundsError) {
            console.error('[OwnerRefundService] Error fetching owner refunds:', refundsError);
            throw refundsError;
        }

        return (refunds || []).map((refund) =>
            mapOwnerRefundHistoryItem(
                refund as unknown as Record<string, unknown>,
                bookingMap.get(String(refund.booking_id))
            )
        );
    },

    subscribeToOwnerRefunds: (ownerId: string, callback: (refunds: OwnerRefundHistoryItem[]) => void): (() => void) => {
        let syncTimer: number | null = null;

        const stopSyncTimer = () => {
            if (syncTimer !== null && typeof window !== 'undefined') {
                window.clearInterval(syncTimer);
                syncTimer = null;
            }
        };

        const fetchAndEmit = async () => {
            const refunds = await refundService.getOwnerRefunds(ownerId);
            callback(refunds);
            return refunds;
        };

        const syncProcessingRefunds = async () => {
            const refunds = await refundService.getOwnerRefunds(ownerId);
            const processingRefunds = refunds.filter((refund) => isProcessingRefund(refund));

            if (!processingRefunds.length) {
                stopSyncTimer();
                callback(refunds);
                return;
            }

            for (const refund of processingRefunds) {
                await refundService.syncRefund(refund);
            }

            const refreshed = await refundService.getOwnerRefunds(ownerId);
            callback(refreshed);

            if (!refreshed.some((refund) => isProcessingRefund(refund))) {
                stopSyncTimer();
            }
        };

        const ensureSyncTimer = (refunds: OwnerRefundHistoryItem[]) => {
            if (!refunds.some((refund) => isProcessingRefund(refund)) || typeof window === 'undefined') {
                stopSyncTimer();
                return;
            }
            if (syncTimer !== null) return;
            syncTimer = window.setInterval(() => {
                void syncProcessingRefunds();
            }, 5000);
        };

        const emitAndSchedule = async () => {
            try {
                const refunds = await fetchAndEmit();
                ensureSyncTimer(refunds);
                if (refunds.some((refund) => isProcessingRefund(refund))) {
                    await syncProcessingRefunds();
                }
            } catch (error) {
                console.error('[OwnerRefundService] Failed to refresh owner refunds:', error);
                stopSyncTimer();
                callback([]);
            }
        };

        void emitAndSchedule();

        const refundsChannel = supabase
            .channel(`owner-refunds-history-${ownerId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'refunds',
                },
                async () => {
                    await emitAndSchedule();
                }
            )
            .subscribe();

        const bookingsChannel = supabase
            .channel(`owner-refund-bookings-${ownerId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bookings',
                    filter: `owner_id=eq.${ownerId}`
                },
                async () => {
                    await emitAndSchedule();
                }
            )
            .subscribe();

        return () => {
            stopSyncTimer();
            supabase.removeChannel(refundsChannel);
            supabase.removeChannel(bookingsChannel);
        };
    },
};

export type { OwnerRefund, OwnerRefundHistoryItem };
