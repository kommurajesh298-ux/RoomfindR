import { paymentService } from '../services/payment.service';
import { supabase } from '../services/supabase-config';

export type PaymentResolution = {
    status: 'paid' | 'failed' | 'pending';
    bookingId?: string;
    propertyId?: string;
    paymentType?: string;
    paymentStatus?: string;
    bookingStatus?: string;
    isRentPayment: boolean;
};

const normalize = (value: unknown): string => String(value || '').toLowerCase();
const publicSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();

const isBookingPaid = (paymentStatus: string, bookingStatus: string): boolean =>
    ['paid', 'completed'].includes(paymentStatus) ||
    ['confirmed', 'approved', 'accepted', 'checked-in', 'checked_in'].includes(bookingStatus);

const isBookingFailed = (paymentStatus: string, bookingStatus: string): boolean =>
    ['failed', 'refunded', 'cancelled', 'expired', 'terminated', 'rejected'].includes(paymentStatus) ||
    ['payment_failed', 'rejected', 'cancelled', 'cancelled_by_customer', 'refunded', 'expired'].includes(bookingStatus);

const isRentPaid = (paymentStatus: string, rentPaymentStatus: string): boolean =>
    ['paid', 'completed', 'success', 'authorized'].includes(paymentStatus) ||
    ['paid', 'success'].includes(rentPaymentStatus);

const isRentFailed = (paymentStatus: string, rentPaymentStatus: string, bookingStatus: string): boolean =>
    ['failed', 'refunded', 'cancelled', 'expired', 'terminated', 'rejected'].includes(paymentStatus) ||
    ['failed', 'refunded', 'expired', 'terminated', 'rejected'].includes(rentPaymentStatus) ||
    ['rejected', 'cancelled', 'cancelled_by_customer', 'refunded', 'expired'].includes(bookingStatus);

const extractScopedMonth = (metadata?: Record<string, unknown> | null): string => {
    const clientContext = metadata?.client_context as Record<string, unknown> | undefined;
    const month = String(metadata?.month || clientContext?.month || '').trim();
    return /^\d{4}-\d{2}$/.test(month) ? month : '';
};

const fetchBookingStatusCompat = async (bookingId: string) => {
    const { data: booking, error } = await supabase
        .from('bookings')
        .select('id, status, payment_status, rent_payment_status, property_id')
        .eq('id', bookingId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return booking;
};

const fetchPublicPaymentStatus = async (input: {
    bookingId?: string;
    orderId?: string;
    paymentType?: string;
    metadata?: Record<string, unknown> | null;
    statusToken?: string;
}): Promise<{ status: 'paid' | 'failed' | 'pending'; bookingId?: string } | null> => {
    if (!publicSupabaseUrl || (!input.bookingId && !input.orderId) || !String(input.statusToken || '').trim()) {
        return null;
    }

    try {
        const url = new URL('/functions/v1/payment-status', publicSupabaseUrl);
        url.searchParams.set('mode', 'status');
        if (input.bookingId) url.searchParams.set('booking_id', input.bookingId);
        if (input.orderId) url.searchParams.set('order_id', input.orderId);
        url.searchParams.set('app', 'customer');
        if (normalize(input.paymentType) === 'monthly' || normalize(input.paymentType) === 'rent') {
            url.searchParams.set('payment_type', 'monthly');
            const scopedMonth = extractScopedMonth(input.metadata || null);
            if (scopedMonth) url.searchParams.set('month', scopedMonth);
        }
        if (input.statusToken) {
            url.searchParams.set('status_token', input.statusToken);
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
        });

        const payload = await response.json().catch(() => null) as { status?: string; booking_id?: string } | null;
        const status = normalize(payload?.status);
        if (!['paid', 'failed', 'pending'].includes(status)) {
            return null;
        }

        return {
            status: status as 'paid' | 'failed' | 'pending',
            bookingId: String(payload?.booking_id || input.bookingId || '').trim() || undefined,
        };
    } catch {
        return null;
    }
};

export const detectDirectUpiIntentSupport = (): boolean => {
    if (typeof window === 'undefined') return false;

    const navigatorWithHints = window.navigator as Navigator & {
        userAgentData?: {
            mobile?: boolean;
        };
    };

    const userAgent = navigatorWithHints.userAgent || '';
    const isTouchMac = /macintosh/i.test(userAgent) && navigatorWithHints.maxTouchPoints > 1;
    if (isTouchMac) {
        return true;
    }

    const platform = String(navigatorWithHints.platform || '').toLowerCase();
    if (/win/i.test(platform) || /mac/i.test(platform)) {
        return false;
    }

    if (typeof navigatorWithHints.userAgentData?.mobile === 'boolean') {
        return navigatorWithHints.userAgentData.mobile;
    }

    return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
};

export const resolvePaymentResolution = async (input: {
    bookingId?: string;
    orderId?: string;
    defaultIsRentPayment?: boolean;
    verify?: boolean;
    metadata?: Record<string, unknown>;
    statusToken?: string;
}): Promise<PaymentResolution> => {
    let resolvedBookingId = String(input.bookingId || '').trim();
    let paymentStatusFromPayment = '';
    let paymentTypeFromPayment = input.defaultIsRentPayment ? 'monthly' : '';
    let paymentMetadata: Record<string, unknown> | null = input.metadata || null;
    let propertyId = '';
    let bookingStatus = '';
    let bookingPaymentStatus = '';
    let bookingRentPaymentStatus = '';

    try {
        if (!resolvedBookingId && input.orderId) {
            const { data: payment } = await supabase
                .from('payments')
                .select('booking_id, status, payment_status, payment_type, metadata')
                .eq('provider_order_id', input.orderId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (payment?.booking_id) {
                resolvedBookingId = String(payment.booking_id);
            }
            paymentStatusFromPayment = normalize(payment?.payment_status || payment?.status);
            paymentTypeFromPayment = normalize(payment?.payment_type) || paymentTypeFromPayment;
            paymentMetadata = (payment?.metadata as Record<string, unknown> | null | undefined) || paymentMetadata;
        }

        if (resolvedBookingId) {
            const isRentPayment = ['monthly', 'rent'].includes(paymentTypeFromPayment) || !!input.defaultIsRentPayment;
            const scopedMonth = extractScopedMonth(paymentMetadata || input.metadata || null);

            const { data: latestPaymentRows } = await supabase
                .from('payments')
                .select('payment_type, status, payment_status, metadata')
                .eq('booking_id', resolvedBookingId)
                .order('created_at', { ascending: false })
                .limit(isRentPayment ? 10 : 1);

            const latestScopedPayment = isRentPayment
                ? (latestPaymentRows || []).find((payment) =>
                    scopedMonth
                        ? extractScopedMonth((payment.metadata as Record<string, unknown> | null | undefined) || null) === scopedMonth
                        : ['monthly', 'rent'].includes(normalize(payment.payment_type))
                  )
                : latestPaymentRows?.[0];

            paymentStatusFromPayment = paymentStatusFromPayment || normalize(latestScopedPayment?.payment_status || latestScopedPayment?.status);
            paymentTypeFromPayment = normalize(latestScopedPayment?.payment_type) || paymentTypeFromPayment;
            paymentMetadata = (latestScopedPayment?.metadata as Record<string, unknown> | null | undefined) || paymentMetadata;

            const booking = await fetchBookingStatusCompat(resolvedBookingId);

            bookingStatus = normalize(booking?.status);
            bookingPaymentStatus = normalize(booking?.payment_status);
            bookingRentPaymentStatus = normalize(booking?.rent_payment_status);
            propertyId = String(booking?.property_id || '').trim();

            const effectiveBookingPaymentStatus = bookingPaymentStatus || paymentStatusFromPayment;
            const effectiveRentPaymentStatus = paymentStatusFromPayment || bookingRentPaymentStatus;

            if (isRentPayment ? isRentPaid(effectiveRentPaymentStatus, bookingRentPaymentStatus) : isBookingPaid(effectiveBookingPaymentStatus, bookingStatus)) {
                return {
                    status: 'paid',
                    bookingId: resolvedBookingId,
                    propertyId,
                    paymentType: paymentTypeFromPayment,
                    paymentStatus: isRentPayment ? effectiveRentPaymentStatus : effectiveBookingPaymentStatus,
                    bookingStatus,
                    isRentPayment,
                };
            }

            if (isRentPayment ? isRentFailed(effectiveRentPaymentStatus, bookingRentPaymentStatus, bookingStatus) : isBookingFailed(effectiveBookingPaymentStatus, bookingStatus)) {
                return {
                    status: 'failed',
                    bookingId: resolvedBookingId,
                    propertyId,
                    paymentType: paymentTypeFromPayment,
                    paymentStatus: isRentPayment ? effectiveRentPaymentStatus : effectiveBookingPaymentStatus,
                    bookingStatus,
                    isRentPayment,
                };
            }
        }
    } catch {
        // Ignore local query issues and fall through to backend verification.
    }

    if (input.verify !== false && (input.orderId || resolvedBookingId)) {
        const scopedPaymentType = ['monthly', 'rent'].includes(paymentTypeFromPayment) || !!input.defaultIsRentPayment
            ? 'monthly'
            : 'booking';
        const scopedMetadata = paymentMetadata || input.metadata || null;
        const publicStatus = await fetchPublicPaymentStatus({
            orderId: input.orderId,
            bookingId: resolvedBookingId || input.bookingId,
            paymentType: scopedPaymentType,
            metadata: scopedMetadata,
            statusToken: input.statusToken,
        });

        if (publicStatus?.status === 'paid') {
            return {
                status: 'paid',
                bookingId: publicStatus.bookingId || resolvedBookingId || input.bookingId,
                propertyId,
                paymentType: paymentTypeFromPayment,
                paymentStatus: 'paid',
                bookingStatus,
                isRentPayment: ['monthly', 'rent'].includes(paymentTypeFromPayment) || !!input.defaultIsRentPayment,
            };
        }

        if (publicStatus?.status === 'failed') {
            return {
                status: 'failed',
                bookingId: publicStatus.bookingId || resolvedBookingId || input.bookingId,
                propertyId,
                paymentType: paymentTypeFromPayment,
                paymentStatus: 'failed',
                bookingStatus,
                isRentPayment: ['monthly', 'rent'].includes(paymentTypeFromPayment) || !!input.defaultIsRentPayment,
            };
        }

        const verifyResult = await paymentService.verifyPaymentStatus({
            orderId: input.orderId,
            bookingId: resolvedBookingId || input.bookingId,
            paymentType: scopedPaymentType,
            metadata: scopedMetadata || undefined,
        });

        if (verifyResult?.status === 'paid') {
            return {
                status: 'paid',
                bookingId: verifyResult.bookingId || resolvedBookingId || input.bookingId,
                propertyId,
                paymentType: paymentTypeFromPayment,
                paymentStatus: 'paid',
                bookingStatus,
                isRentPayment: ['monthly', 'rent'].includes(paymentTypeFromPayment) || !!input.defaultIsRentPayment,
            };
        }

        if (verifyResult?.status === 'failed') {
            return {
                status: 'failed',
                bookingId: verifyResult.bookingId || resolvedBookingId || input.bookingId,
                propertyId,
                paymentType: paymentTypeFromPayment,
                paymentStatus: 'failed',
                bookingStatus,
                isRentPayment: ['monthly', 'rent'].includes(paymentTypeFromPayment) || !!input.defaultIsRentPayment,
            };
        }
    }

    return {
        status: 'pending',
        bookingId: resolvedBookingId || input.bookingId,
        propertyId,
        paymentType: paymentTypeFromPayment,
        paymentStatus: bookingPaymentStatus || paymentStatusFromPayment,
        bookingStatus,
        isRentPayment: ['monthly', 'rent'].includes(paymentTypeFromPayment) || !!input.defaultIsRentPayment,
    };
};
