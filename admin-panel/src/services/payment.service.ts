import { supabase } from './supabase-config';
import type { Settlement } from '../types/owner.types';
import { normalizeSettlementStatus, normalizeRentPaymentStatus, normalizeRefundStatus } from '../utils/normalizePaymentStatus';
import { invokeProtectedEdgeFunction } from './protected-edge.service';

export interface RentPaymentRow {
    id: string;
    transaction_id?: string | null;
    booking_id: string;
    amount: number;
    payment_type: string;
    payment_method?: string;
    provider_order_id?: string;
    provider_payment_id?: string;
    status: string;
    payment_status?: string;
    created_at: string;
    verified_at?: string;
    payout_status_display?: string;
    settlement?: {
        id: string;
        payment_id?: string | null;
        payment_type?: string | null;
        status: string;
        payout_status?: string | null;
        platform_fee?: number | string | null;
        net_payable?: number | string | null;
        provider_reference?: string | null;
        provider_transfer_id?: string | null;
        processed_at?: string | null;
    };
    bookings?: {
        id: string;
        status?: string;
        customer_name?: string;
        properties?: {
            title?: string;
        };
        owners?: {
            name?: string;
        };
    };
}

export interface RefundRow {
    id: string;
    booking_id: string;
    payment_id: string;
    amount?: number | string;
    refund_amount: number | string;
    commission_amount?: number | string;
    reason?: string | null;
    refund_reason?: string | null;
    status: string;
    raw_status?: string;
    created_at: string;
    processed_at?: string | null;
    failure_reason?: string | null;
    approved_at?: string | null;
    payments?: {
        amount?: number | string;
    };
    bookings: {
        customer_name: string;
        start_date?: string;
        end_date?: string;
        check_in_date?: string | null;
        amount_paid?: number | string;
        advance_paid?: number | string;
        amount_due?: number | string;
        monthly_rent?: number | string;
        payment_type?: string | null;
        commission_amount?: number | string;
        room_gst?: number | string;
        room_gst_rate?: number | string;
        platform_fee?: number | string;
        platform_gst?: number | string;
        platform_gst_rate?: number | string;
        total_amount?: number | string;
        cgst_amount?: number | string;
        sgst_amount?: number | string;
        igst_amount?: number | string;
        properties: {
            title: string;
        };
    };
}

type ProtectedEdgeEntity = Record<string, unknown>;

type SettlementProcessResponse = {
    success: boolean;
    settlement: ProtectedEdgeEntity;
    transfer_id?: string;
    message?: string;
    error?: string;
};

type RefundProcessResponse = {
    success: boolean;
    refund: ProtectedEdgeEntity;
    gateway?: ProtectedEdgeEntity;
    skipped?: boolean;
    error?: string;
};

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

export interface RentPaymentSummary {
    total: number;
    successful: number;
    processing: number;
    totalAmount: number;
    commissionAmount: number;
    ownerPayoutAmount: number;
}

const ADMIN_SETTLEMENTS_PAGE_SIZE = 50;
const ADMIN_RENT_PAGE_SIZE = 50;
const ADMIN_SETTLEMENT_SELECT_RICH = 'id, owner_id, booking_id, payment_id, payment_type, week_start_date, week_end_date, total_amount, platform_fee, net_payable, status, payout_status, provider_reference, provider_transfer_id, processed_at, created_at, owners!settlements_owner_id_fkey(name, email)';
const ADMIN_SETTLEMENT_SELECT_LEGACY = 'id, owner_id, booking_id, week_start_date, week_end_date, total_amount, platform_fee, net_payable, status, provider_reference, provider_transfer_id, processed_at, created_at, owners!settlements_owner_id_fkey(name, email)';
const ADMIN_RENT_PAYMENT_SELECT = 'id, booking_id, amount, payment_type, payment_method, provider_order_id, provider_payment_id, status, payment_status, created_at, updated_at, verified_at';
const ADMIN_REFUND_BOOKING_SELECT_RICH = '*, bookings(customer_name, property_id, start_date, end_date, check_in_date, amount_paid, advance_paid, amount_due, monthly_rent, payment_type, commission_amount, room_gst, room_gst_rate, platform_fee, platform_gst, platform_gst_rate, total_amount, cgst_amount, sgst_amount, igst_amount, properties(title)), payments(amount)';
const ADMIN_REFUND_BOOKING_SELECT_LEGACY = '*, bookings(customer_name, property_id, start_date, end_date, amount_paid, advance_paid, amount_due, monthly_rent, payment_type, commission_amount, properties(title)), payments(amount)';
let adminSettlementRichSelectAvailable: boolean | null = null;
let adminRefundRichSelectAvailable: boolean | null = false;

const isMissingBookingGstColumnError = (error: { code?: string; message?: string } | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && /bookings_1\.(check_in_date|room_gst|room_gst_rate|platform_fee|platform_gst|platform_gst_rate|total_amount|cgst_amount|sgst_amount|igst_amount)/i.test(message);
};

const isMissingSettlementCompatibilityColumnError = (error: { code?: string; message?: string } | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && /column .*?(payment_id|payment_type|payout_status)/i.test(message);
};

const createScheduledFetcher = (fetcher: () => Promise<void>, waitMs = 250): ScheduledFetcher => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let rerunRequested = false;

    const execute = async () => {
        if (inFlight) {
            rerunRequested = true;
            return;
        }

        inFlight = true;
        try {
            await fetcher();
        } finally {
            inFlight = false;
            if (rerunRequested) {
                rerunRequested = false;
                schedule();
            }
        }
    };

    const schedule = () => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            timeout = null;
            void execute();
        }, waitMs);
    };

    const flush = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
        void execute();
    };

    const cancel = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
        rerunRequested = false;
    };

    return { flush, schedule, cancel };
};

const resolvePayoutStatusDisplay = (
    settlement: Record<string, unknown> | undefined,
    normalizedPaymentStatus: ReturnType<typeof normalizeRentPaymentStatus>,
) => {
    if (settlement) {
        const normalizedSettlementStatus = normalizeSettlementStatus(settlement);
        if (normalizedSettlementStatus === 'COMPLETED') return 'SUCCESS';
        if (normalizedSettlementStatus === 'FAILED') return 'FAILED';
        if (normalizedSettlementStatus === 'PROCESSING') return 'PROCESSING';
        return 'PENDING';
    }

    if (normalizedPaymentStatus === 'paid') return 'NOT_CREATED';
    if (normalizedPaymentStatus === 'failed') return 'NOT_APPLICABLE';
    return 'PENDING';
};

export const paymentService = {

    // SETTLEMENTS
    getSettlements: async (): Promise<Settlement[]> => {
        let data: Record<string, unknown>[] | null = null;
        let error: { code?: string; message?: string } | null = null;

        if (adminSettlementRichSelectAvailable !== false) {
            const result = await supabase
                .from('settlements')
                .select(ADMIN_SETTLEMENT_SELECT_RICH)
                .order('created_at', { ascending: false })
                .range(0, ADMIN_SETTLEMENTS_PAGE_SIZE - 1);
            data = (result.data as unknown as Record<string, unknown>[] | null) ?? null;
            error = result.error;

            if (!error) {
                adminSettlementRichSelectAvailable = true;
            }
        }

        if ((error && isMissingSettlementCompatibilityColumnError(error)) || adminSettlementRichSelectAvailable === false) {
            adminSettlementRichSelectAvailable = false;
            const fallback = await supabase
                .from('settlements')
                .select(ADMIN_SETTLEMENT_SELECT_LEGACY)
                .order('created_at', { ascending: false })
                .range(0, ADMIN_SETTLEMENTS_PAGE_SIZE - 1);
            data = (fallback.data as unknown as Record<string, unknown>[] | null) ?? null;
            error = fallback.error;
        }

        if (error) throw error;
        return (data || []).map((settlement) => ({
            ...settlement,
            payment_type: settlement['payment_type'] || null,
            status: normalizeSettlementStatus(settlement as unknown as Record<string, unknown>),
        })) as Settlement[];
    },
    subscribeToSettlements: (callback: (settlements: Settlement[]) => void) => {
        const fetch = async () => {
            const data = await paymentService.getSettlements();
            callback(data);
        };
        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();
        const channel = supabase.channel('admin-settlement-sync').on('postgres_changes', {
            event: '*', schema: 'public', table: 'settlements'
        }, () => scheduledFetch.schedule()).subscribe();
        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },

    // RENT PAYMENTS
    getRentPayments: async (limit = ADMIN_RENT_PAGE_SIZE, offset = 0): Promise<RentPaymentRow[]> => {
        const { data: paymentRows, error: paymentsError } = await supabase
            .from('payments')
            .select(ADMIN_RENT_PAYMENT_SELECT)
            .in('payment_type', ['monthly', 'rent'])
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (paymentsError) throw paymentsError;
        if (!paymentRows?.length) return [];

        const bookingIds = [...new Set(paymentRows.map((row) => row.booking_id).filter(Boolean))];
        const paymentIds = [...new Set(paymentRows.map((row) => row.id).filter(Boolean))];

        const { data: bookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('id, status, customer_name, owners!bookings_owner_id_fkey(name), properties!bookings_property_id_fkey(title)')
            .in('id', bookingIds);

        if (bookingsError) throw bookingsError;

        let settlements: Record<string, unknown>[] | null = null;
        let settlementsError: { code?: string; message?: string } | null = null;

        if (adminSettlementRichSelectAvailable !== false && paymentIds.length > 0) {
            const result = await supabase
                .from('settlements')
                .select('id, payment_id, payment_type, status, payout_status, platform_fee, net_payable, provider_reference, provider_transfer_id, processed_at')
                .in('payment_id', paymentIds);
            settlements = (result.data as unknown as Record<string, unknown>[] | null) ?? null;
            settlementsError = result.error;
            if (!settlementsError) {
                adminSettlementRichSelectAvailable = true;
            }
        }

        if ((settlementsError && isMissingSettlementCompatibilityColumnError(settlementsError)) || adminSettlementRichSelectAvailable === false) {
            adminSettlementRichSelectAvailable = false;
            const result = await supabase
                .from('settlements')
                .select('id, booking_id, status, platform_fee, net_payable, provider_reference, provider_transfer_id, processed_at')
                .in('booking_id', bookingIds);
            settlements = (result.data as unknown as Record<string, unknown>[] | null) ?? null;
            settlementsError = result.error;
        }

        if (settlementsError) throw settlementsError;

        const bookingMap = new Map(
            (bookings || []).map((booking) => [booking.id, booking])
        );
        const settlementMap = new Map(
            (settlements || []).map((settlement) => [
                String(settlement['payment_id'] || settlement['booking_id'] || ''),
                settlement
            ])
        );

        return paymentRows.map((row) => {
            const normalizedPaymentStatus = normalizeRentPaymentStatus({
                status: row.status,
                payment_status: row.payment_status,
            } as Record<string, unknown>);
            const matchedSettlement =
                settlementMap.get(row.id || '') ||
                settlementMap.get(row.booking_id || '');
            const settlementRecord = matchedSettlement as Record<string, unknown> | undefined;
            const settlement = settlementRecord
                ? {
                    ...settlementRecord,
                    payment_type: settlementRecord['payment_type'] || row.payment_type || 'monthly',
                    platform_fee: Number(settlementRecord['platform_fee'] || 0),
                    net_payable: Number(settlementRecord['net_payable'] || row.amount || 0),
                }
                : normalizedPaymentStatus === 'paid'
                    ? {
                        payment_type: row.payment_type || 'monthly',
                        platform_fee: 0,
                        net_payable: Number(row.amount || 0),
                    }
                    : undefined;

            const payoutStatusDisplay = resolvePayoutStatusDisplay(
                settlementRecord,
                normalizedPaymentStatus,
            );

            return {
                id: row.id,
                transaction_id: row.id,
                booking_id: row.booking_id,
                amount: Number(row.amount || 0),
                payment_type: row.payment_type || 'monthly',
                payment_method: row.payment_method || undefined,
                provider_order_id: row.provider_order_id || undefined,
                provider_payment_id: row.provider_payment_id || undefined,
                status: normalizedPaymentStatus,
                payment_status: row.payment_status || row.status,
                created_at: row.created_at,
                verified_at: row.verified_at || row.updated_at,
                payout_status_display: payoutStatusDisplay,
                bookings: bookingMap.get(row.booking_id),
                settlement,
            };
        }) as RentPaymentRow[];
    },
    getRentPaymentSummary: async (): Promise<RentPaymentSummary> => {
        const { data: paymentRows, error: paymentsError } = await supabase
            .from('payments')
            .select('id, booking_id, amount, payment_type, status, payment_status')
            .in('payment_type', ['monthly', 'rent']);

        if (paymentsError) throw paymentsError;
        if (!paymentRows?.length) {
            return {
                total: 0,
                successful: 0,
                processing: 0,
                totalAmount: 0,
                commissionAmount: 0,
                ownerPayoutAmount: 0,
            };
        }

        const bookingIds = [...new Set(paymentRows.map((row) => row.booking_id).filter(Boolean))];
        const paymentIds = [...new Set(paymentRows.map((row) => row.id).filter(Boolean))];

        let settlements: Record<string, unknown>[] | null = null;
        let settlementsError: { code?: string; message?: string } | null = null;

        if (adminSettlementRichSelectAvailable !== false && paymentIds.length > 0) {
            const result = await supabase
                .from('settlements')
                .select('payment_id, booking_id, status, payout_status, platform_fee, net_payable')
                .in('payment_id', paymentIds);
            settlements = (result.data as unknown as Record<string, unknown>[] | null) ?? null;
            settlementsError = result.error;
            if (!settlementsError) {
                adminSettlementRichSelectAvailable = true;
            }
        }

        if ((settlementsError && isMissingSettlementCompatibilityColumnError(settlementsError)) || adminSettlementRichSelectAvailable === false) {
            adminSettlementRichSelectAvailable = false;
            const result = await supabase
                .from('settlements')
                .select('booking_id, status, platform_fee, net_payable')
                .in('booking_id', bookingIds);
            settlements = (result.data as unknown as Record<string, unknown>[] | null) ?? null;
            settlementsError = result.error;
        }

        if (settlementsError) throw settlementsError;

        const settlementByPaymentId = new Map(
            (settlements || [])
                .filter((settlement) => String(settlement['payment_id'] || '').trim())
                .map((settlement) => [String(settlement['payment_id']), settlement])
        );
        const settlementByBookingId = new Map(
            (settlements || [])
                .filter((settlement) => String(settlement['booking_id'] || '').trim())
                .map((settlement) => [String(settlement['booking_id']), settlement])
        );

        return paymentRows.reduce<RentPaymentSummary>((accumulator, row) => {
            const amount = Number(row.amount || 0);
            const normalizedPaymentStatus = normalizeRentPaymentStatus({
                status: row.status,
                payment_status: row.payment_status,
            } as Record<string, unknown>);
            const settlement =
                settlementByPaymentId.get(String(row.id || '')) ||
                settlementByBookingId.get(String(row.booking_id || ''));
            accumulator.total += 1;

            if (normalizedPaymentStatus === 'paid') {
                accumulator.successful += 1;
                accumulator.totalAmount += amount;
            } else if (normalizedPaymentStatus === 'pending') {
                accumulator.processing += 1;
            }

            accumulator.commissionAmount += Number(settlement?.platform_fee || 0);

            if (settlement) {
                accumulator.ownerPayoutAmount += Number(settlement.net_payable || 0);
            } else if (normalizedPaymentStatus === 'paid') {
                accumulator.ownerPayoutAmount += amount;
            }

            return accumulator;
        }, {
            total: 0,
            successful: 0,
            processing: 0,
            totalAmount: 0,
            commissionAmount: 0,
            ownerPayoutAmount: 0,
        });
    },
    subscribeToRentPayments: (callback: (payments: RentPaymentRow[]) => void) => {
        const activeBookingIds = new Set<string>();
        const activePaymentIds = new Set<string>();

        const fetch = async () => {
            const data = await paymentService.getRentPayments();
            activeBookingIds.clear();
            activePaymentIds.clear();
            data.forEach((payment) => {
                if (payment.booking_id) activeBookingIds.add(payment.booking_id);
                if (payment.id) activePaymentIds.add(payment.id);
            });
            callback(data);
        };

        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();
        const channel = supabase.channel('admin-rent-sync')
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'payments', filter: 'payment_type=in.(monthly,rent)'
            }, () => scheduledFetch.schedule())
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'bookings'
            }, (payload) => {
                const bookingId = String(
                    (payload.new as Record<string, unknown> | null | undefined)?.id ||
                    (payload.old as Record<string, unknown> | null | undefined)?.id ||
                    ''
                ).trim();
                if (bookingId && activeBookingIds.has(bookingId)) {
                    scheduledFetch.schedule();
                }
            })
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'settlements'
            }, (payload) => {
                const paymentId = String(
                    (payload.new as Record<string, unknown> | null | undefined)?.payment_id ||
                    (payload.old as Record<string, unknown> | null | undefined)?.payment_id ||
                    ''
                ).trim();
                const bookingId = String(
                    (payload.new as Record<string, unknown> | null | undefined)?.booking_id ||
                    (payload.old as Record<string, unknown> | null | undefined)?.booking_id ||
                    ''
                ).trim();
                if (
                    (paymentId && activePaymentIds.has(paymentId))
                    || (bookingId && activeBookingIds.has(bookingId))
                ) {
                    scheduledFetch.schedule();
                }
            })
            .subscribe();

        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },

    // REFUNDS
    getRefunds: async () => {
        let result;

        if (adminRefundRichSelectAvailable !== false) {
            result = await supabase
                .from('refunds')
                .select(ADMIN_REFUND_BOOKING_SELECT_RICH)
                .order('created_at', { ascending: false });

            if (!result.error) {
                adminRefundRichSelectAvailable = true;
            }
        } else {
            result = await supabase
                .from('refunds')
                .select(ADMIN_REFUND_BOOKING_SELECT_LEGACY)
                .order('created_at', { ascending: false });
        }

        if (result.error && isMissingBookingGstColumnError(result.error)) {
            adminRefundRichSelectAvailable = false;
            result = await supabase
                .from('refunds')
                .select(ADMIN_REFUND_BOOKING_SELECT_LEGACY)
                .order('created_at', { ascending: false });
        }

        const { data, error } = result;
        if (error) throw error;
        return (data || []).map((refund) => ({
            ...refund,
            amount: Number(refund.refund_amount ?? refund.amount ?? 0),
            status: normalizeRefundStatus(refund as unknown as Record<string, unknown>),
            raw_status: String(refund.refund_status || refund.status || '').trim().toUpperCase() || 'PENDING',
        }));
    },

    subscribeToRefunds: (callback: (refunds: RefundRow[]) => void) => {
        const fetch = async () => {
            const data = await paymentService.getRefunds();
            callback(data as RefundRow[]);
        };
        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();
        const channel = supabase.channel('admin-refunds-sync').on('postgres_changes', {
            event: '*', schema: 'public', table: 'refunds'
        }, () => scheduledFetch.schedule()).subscribe();
        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },

    // SETTLEMENT PROCESSING
    processSettlement: async (settlementId: string) => {
        try {
            const response = await invokeProtectedEdgeFunction<SettlementProcessResponse>(
                'cashfree-settlement',
                { settlementId },
                'Settlement processing failed'
            );
            return response;
        } catch (error) {
            console.error('[PaymentService] Settlement processing error:', error);
            throw error instanceof Error ? error : new Error(String(error));
        }
    },

    // REFUND PROCESSING
    processRefund: async (input: {
        refundId?: string;
        paymentId: string;
        bookingId?: string;
        reason?: string;
        refundReason?: string;
        refundAmount?: number;
        commissionAmount?: number;
    }) => {
        try {
            const response = await invokeProtectedEdgeFunction<RefundProcessResponse>(
                'cashfree-refund',
                {
                    action: 'process',
                    refundRowId: input.refundId,
                    paymentId: input.paymentId,
                    bookingId: input.bookingId,
                    reason: input.reason || 'Refund initiated by admin',
                    refundReason: input.refundReason || null,
                    refundAmount: input.refundAmount,
                    commissionAmount: input.commissionAmount,
                    initiatedBy: 'admin'
                },
                'Refund processing failed'
            );
            return response;
        } catch (error) {
            console.error('[PaymentService] Refund processing error:', error);
            throw error instanceof Error ? error : new Error(String(error));
        }
    },

    rejectRefund: async (input: {
        refundId: string;
        paymentId: string;
        bookingId?: string;
        reason?: string;
    }) => {
        try {
            const response = await invokeProtectedEdgeFunction<RefundProcessResponse>(
                'cashfree-refund',
                {
                    action: 'reject',
                    refundRowId: input.refundId,
                    paymentId: input.paymentId,
                    bookingId: input.bookingId,
                    reason: input.reason || 'Refund rejected by admin',
                    initiatedBy: 'admin'
                },
                'Refund rejection failed'
            );
            return response;
        } catch (error) {
            console.error('[PaymentService] Refund rejection error:', error);
            throw error instanceof Error ? error : new Error(String(error));
        }
    },

    syncRefund: async (input: {
        refundId: string;
        paymentId: string;
        bookingId?: string;
    }) => {
        try {
            const response = await invokeProtectedEdgeFunction<RefundProcessResponse>(
                'cashfree-refund',
                {
                    action: 'sync',
                    refundRowId: input.refundId,
                    paymentId: input.paymentId,
                    bookingId: input.bookingId,
                    initiatedBy: 'admin'
                },
                'Refund status sync failed'
            );
            return response;
        } catch (error) {
            console.error('[PaymentService] Refund sync error:', error);
            throw error instanceof Error ? error : new Error(String(error));
        }
    },
};
