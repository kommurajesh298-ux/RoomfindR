import { supabase, supabaseAnonKey, supabaseUrl } from './supabase-config';
import {
    extractEdgeErrorMessage,
    postProtectedEdgeFunction,
} from './protected-edge.service';
import { getMobileAppBaseUrl } from './native-bridge.service';
import { getSafeConfiguredReturnBaseUrl } from '../utils/payment-return-url';

// --- Core Interfaces ---

export interface CardPayload {
    card_number: string;
    card_holder_name: string;
    card_expiry_mm: string;
    card_expiry_yy: string;
    card_cvv: string;
}

export interface PaymentPayload {
    amount: number;
    bookingId: string;
    customerId?: string;
    propertyId: string;
    roomId: string;
    paymentType: 'booking' | 'monthly' | 'deposit';
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    description?: string;
    metadata?: Record<string, unknown>;
    card?: CardPayload;
    returnBaseUrl?: string;
}

export interface PaymentResult {
    success: boolean;
    transactionId?: string;
    message: string;
    orderId?: string;
    paymentSessionId?: string;
    orderExpiryTime?: string;
    status: 'pending' | 'completed' | 'failed' | 'cancelled';
    metadata?: Record<string, unknown>;
}

export interface PaymentProvider {
    initialize(): Promise<void>;
    processPayment(payload: PaymentPayload, upiMethod?: 'phonepe' | 'gpay' | 'paytm' | string): Promise<PaymentResult>;
    verifyPayment(verificationData: Record<string, unknown>): Promise<PaymentResult>;
}

export type CashfreeComponentState = {
    complete?: boolean;
    ready?: boolean;
    loaderror?: boolean;
    error?: {
        message?: string;
        type?: string;
    };
    value?: Record<string, unknown>;
};

export type CashfreeComponent = {
    mount(selector: string): void;
    on(eventName: string, callback: (data: CashfreeComponentState) => void): void;
    data(): CashfreeComponentState;
    destroy?(): void;
    unmount?(): void;
    update?(values: Record<string, unknown>): void;
    isComplete?(): boolean;
};

type CashfreePayResult = {
    error?: {
        message?: string;
        type?: string;
    };
    redirect?: boolean;
    paymentDetails?: {
        paymentMessage?: string;
    };
};

type CashfreeInstance = {
    create(componentName: string, options?: Record<string, unknown>): CashfreeComponent;
    pay(options: {
        paymentMethod: CashfreeComponent;
        paymentSessionId: string;
        redirect?: 'if_required';
        redirectTarget?: '_self' | '_blank';
        savePaymentInstrument?: boolean | CashfreeComponent;
    }): Promise<CashfreePayResult>;
};

type CashfreeFactory = (config: { mode: 'production' | 'sandbox' }) => CashfreeInstance;

type CashfreeWindow = Window & typeof globalThis & {
    Cashfree?: CashfreeFactory;
};

type CashfreeCreateOrderResponse = {
    success?: boolean;
    already_paid?: boolean;
    order_id?: string;
    payment_session_id?: string;
    order_expiry_time?: string;
    error?: string;
};

type CashfreeVerifyOrderResponse = {
    success?: boolean;
    status?: string;
    booking_id?: string;
};

type CashfreeFailPaymentResponse = {
    success?: boolean;
    booking_id?: string;
    payment_ids?: string[];
};

let cashfreeSdkPromise: Promise<CashfreeFactory> | null = null;
let verifyAuthBlockUntil = 0;
const verifyBlockUntilByKey = new Map<string, number>();
const verifyInFlight = new Set<string>();
const VERIFY_BLOCK_MS = 5 * 60_000;
const VERIFY_BLOCK_STORAGE_PREFIX = 'rfm_verify_block_until';
const VERIFY_GLOBAL_BLOCK_MS = 15 * 60_000;
const VERIFY_INFLIGHT_BLOCK_MS = 15_000;
const VERIFY_DISABLED_STORAGE_KEY = 'rfm_verify_disabled_cashfree_until';
const VERIFY_DISABLED_MS = 24 * 60 * 60_000;
const VERIFY_DISABLED_ON_401_MS = 30 * 60_000;
const PAYMENT_HISTORY_PAGE_SIZE = 20;

const normalizePaymentState = (value: unknown): string => String(value || '').toLowerCase();
const isPaidState = (value: unknown): boolean => ['paid', 'completed', 'success'].includes(normalizePaymentState(value));
const isFailedState = (value: unknown): boolean => ['failed', 'cancelled', 'refunded', 'expired', 'terminated'].includes(normalizePaymentState(value));

const fetchBookingStatusCompat = async (bookingId: string) => {
    const { data: booking, error } = await supabase
        .from('bookings')
        .select('id, status, payment_status, rent_payment_status')
        .eq('id', bookingId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return booking;
};

const normalizeScopedPaymentType = (value: unknown): 'booking' | 'monthly' => {
    const normalized = normalizePaymentState(value);
    return normalized === 'monthly' || normalized === 'rent' ? 'monthly' : 'booking';
};

const extractScopedMonth = (metadata?: Record<string, unknown> | null): string => {
    const clientContext = metadata?.client_context as Record<string, unknown> | undefined;
    const month = String(metadata?.month || clientContext?.month || '').trim();
    return /^\d{4}-\d{2}$/.test(month) ? month : '';
};

const buildScopedVerifyKey = (input: {
    orderId?: string;
    bookingId?: string;
    paymentType?: string;
    metadata?: Record<string, unknown> | null;
}): string => {
    const baseKey = input.orderId || input.bookingId || 'global';
    const scopedPaymentType = normalizeScopedPaymentType(input.paymentType);
    const scopedMonth = scopedPaymentType === 'monthly'
        ? extractScopedMonth(input.metadata || null)
        : '';

    return scopedMonth
        ? `${baseKey}:${scopedPaymentType}:${scopedMonth}`
        : `${baseKey}:${scopedPaymentType}`;
};

const resolveLocalPaymentStatus = async (input: {
    orderId?: string;
    bookingId?: string;
    paymentType?: string;
    metadata?: Record<string, unknown> | null;
}) => {
    try {
        const scopedPaymentType = normalizeScopedPaymentType((input as { paymentType?: unknown }).paymentType);
        const scopedMonth = extractScopedMonth((input as { metadata?: Record<string, unknown> | null }).metadata);

        if (input.bookingId && scopedPaymentType === 'monthly' && !input.orderId) {
            const { data: scopedPayments } = await supabase
                .from('payments')
                .select('booking_id, status, payment_status, metadata')
                .eq('booking_id', input.bookingId)
                .in('payment_type', ['monthly', 'rent'])
                .order('created_at', { ascending: false })
                .limit(10);
            const matchedPayment = (scopedPayments || []).find((payment) =>
                scopedMonth
                    ? extractScopedMonth((payment.metadata as Record<string, unknown> | null | undefined) || null) === scopedMonth
                    : true
            ) as { booking_id?: string; status?: string; payment_status?: string } | undefined;

            const scopedStatus = normalizePaymentState(
                matchedPayment?.payment_status || matchedPayment?.status
            );

            if (scopedStatus && isPaidState(scopedStatus)) {
                return { success: true, status: 'paid', bookingId: matchedPayment?.booking_id || input.bookingId };
            }
            if (scopedStatus && isFailedState(scopedStatus)) {
                return { success: true, status: 'failed', bookingId: matchedPayment?.booking_id || input.bookingId };
            }

            return { success: false, status: 'pending', bookingId: input.bookingId };
        }

        if (input.bookingId) {
            const booking = await fetchBookingStatusCompat(input.bookingId);

            const bookingScopedStatus = scopedPaymentType === 'monthly'
                ? booking?.rent_payment_status
                : booking?.payment_status;
            const resolvedBookingId = booking?.id as string | undefined;

            if (bookingScopedStatus && isPaidState(bookingScopedStatus)) {
                return { success: true, status: 'paid', bookingId: resolvedBookingId || input.bookingId };
            }
            if (bookingScopedStatus && isFailedState(bookingScopedStatus)) {
                return { success: true, status: 'failed', bookingId: resolvedBookingId || input.bookingId };
            }

            // When a customer comes back before the gateway order has created a payment row,
            // treat it as a normal pending state and skip remote verification noise.
            if (scopedPaymentType === 'booking' && !input.orderId) {
                const { data: bookingPayments } = await supabase
                    .from('payments')
                    .select('id, status, payment_status')
                    .eq('booking_id', input.bookingId)
                    .in('payment_type', ['booking', 'advance'])
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (!Array.isArray(bookingPayments) || bookingPayments.length === 0) {
                    return { success: false, status: 'pending', bookingId: resolvedBookingId || input.bookingId };
                }

                const latestBookingPayment = bookingPayments.find((payment) =>
                    String(payment?.payment_status || payment?.status || '').trim().length > 0
                ) || bookingPayments[0];

                const latestBookingPaymentStatus = normalizePaymentState(
                    latestBookingPayment?.payment_status || latestBookingPayment?.status
                );

                if (latestBookingPaymentStatus && isPaidState(latestBookingPaymentStatus)) {
                    return { success: true, status: 'paid', bookingId: resolvedBookingId || input.bookingId };
                }
                if (latestBookingPaymentStatus && isFailedState(latestBookingPaymentStatus)) {
                    return { success: true, status: 'failed', bookingId: resolvedBookingId || input.bookingId };
                }

                return { success: false, status: 'pending', bookingId: resolvedBookingId || input.bookingId };
            }
        }

        if (input.orderId) {
            const { data: payment } = await supabase
                .from('payments')
                .select('booking_id, status, payment_status')
                .eq('provider_order_id', input.orderId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const paymentStatus = payment?.payment_status || payment?.status;
            if (paymentStatus && isPaidState(paymentStatus)) {
                return { success: true, status: 'paid', bookingId: payment.booking_id as string };
            }
            if (paymentStatus && isFailedState(paymentStatus)) {
                return { success: true, status: 'failed', bookingId: payment.booking_id as string };
            }
        }
    } catch {
        // Ignore local lookup errors and allow remote verification.
    }

    return null;
};

const getStoredBlockUntil = (key: string): number => {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(`${VERIFY_BLOCK_STORAGE_PREFIX}:${key}`);
    if (!raw) return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
};

const setStoredBlockUntil = (key: string, value: number): void => {
    if (typeof window === 'undefined') return;
    if (!Number.isFinite(value)) return;
    window.localStorage.setItem(`${VERIFY_BLOCK_STORAGE_PREFIX}:${key}`, String(value));
};

const getVerifyDisabledUntil = (): number => {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(VERIFY_DISABLED_STORAGE_KEY);
    if (!raw) return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
};

const setVerifyDisabledUntil = (value: number): void => {
    if (typeof window === 'undefined') return;
    if (!Number.isFinite(value)) return;
    window.localStorage.setItem(VERIFY_DISABLED_STORAGE_KEY, String(value));
};

const loadCashfreeSdk = (): Promise<CashfreeFactory> => {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Cashfree SDK unavailable'));
    }

    const existing = (window as CashfreeWindow).Cashfree;
    if (existing) return Promise.resolve(existing);
    if (cashfreeSdkPromise) return cashfreeSdkPromise;

    const sdkUrl = (import.meta.env.VITE_CASHFREE_SDK_URL as string | undefined)?.trim();
    if (!sdkUrl) {
        return Promise.reject(new Error('Cashfree SDK URL is not configured'));
    }

    cashfreeSdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = sdkUrl;
        script.async = true;
        script.onload = () => {
            const cashfree = (window as CashfreeWindow).Cashfree;
            if (cashfree) {
                resolve(cashfree);
                return;
            }
            reject(new Error('Cashfree SDK not available'));
        };
        script.onerror = () => reject(new Error('Failed to load Cashfree SDK'));
        document.body.appendChild(script);
    });

    return cashfreeSdkPromise;
};

const getCashfreeInstance = async (): Promise<CashfreeInstance> => {
    const Cashfree = await loadCashfreeSdk();
    if (!Cashfree) throw new Error('Cashfree SDK not available');
    const mode = String(import.meta.env.VITE_CASHFREE_ENV || 'sandbox').toLowerCase();
    return Cashfree({ mode: mode === 'production' ? 'production' : 'sandbox' });
};

const normalizePhoneForPayment = (value: string): string => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const getConfiguredReturnBaseUrl = (): string => {
    const mobileAppBaseUrl = getMobileAppBaseUrl();
    if (mobileAppBaseUrl) {
        return mobileAppBaseUrl;
    }

    return getSafeConfiguredReturnBaseUrl([
        String(import.meta.env.VITE_PAYMENT_RETURN_BASE_URL || '').trim(),
        String(import.meta.env.VITE_CUSTOMER_PAYMENT_RETURN_BASE_URL || '').trim(),
        String(import.meta.env.VITE_APP_URL || '').trim(),
        String(import.meta.env.VITE_SITE_URL || '').trim(),
    ], typeof window !== 'undefined' ? window.location?.origin : '');
};

// --- Provider Implementations ---

export class PendingProvider implements PaymentProvider {
    async initialize(): Promise<void> {
        // No initialization needed for fallback
    }
    async processPayment(_payload: PaymentPayload): Promise<PaymentResult> {
        return {
            success: false,
            message: 'Payment gateway is not currently configured. Please contact support.',
            status: 'failed'
        };
    }
    async verifyPayment(_verificationData: Record<string, unknown>): Promise<PaymentResult> {
        return {
            success: false,
            message: 'Payment gateway not configured.',
            status: 'failed'
        };
    }
}

export class CashfreeProvider implements PaymentProvider {
    async initialize(): Promise<void> {
        // No SDK init required for API-based flow
    }

    async processPayment(payload: PaymentPayload, upiMethod?: string): Promise<PaymentResult> {
        try {
            if (!supabaseUrl || !supabaseAnonKey) {
                return { success: false, status: 'failed', message: 'Missing Supabase configuration.' };
            }

            if (payload.bookingId && payload.paymentType !== 'monthly') {
                const existingBooking = await fetchBookingStatusCompat(payload.bookingId);
                const normalizedBookingPaymentStatus = String(existingBooking?.payment_status || '').trim().toLowerCase();

                if (normalizedBookingPaymentStatus === 'paid') {
                    return {
                        success: true,
                        status: 'completed',
                        message: 'Payment already completed.',
                        metadata: { alreadyPaid: true }
                    };
                }
            }

            const normalizedPhone = normalizePhoneForPayment(payload.customerPhone);
            if (!normalizedPhone || normalizedPhone.length !== 10) {
                return { success: false, status: 'failed', message: 'Invalid customer phone' };
            }

            const appType = String(import.meta.env.VITE_APP_TYPE || 'customer').toLowerCase();
            const requestBody = {
                ...payload,
                customerPhone: normalizedPhone,
                app: appType,
                nativeApp: Boolean(getMobileAppBaseUrl()),
                upiMethod,
                card: payload.card || null,
                returnBaseUrl: payload.returnBaseUrl || getConfiguredReturnBaseUrl(),
            };

            const { response, payload: data } = await postProtectedEdgeFunction<CashfreeCreateOrderResponse>(
                'cashfree-create-order',
                requestBody,
                { minValidityMs: 60_000 }
            );

            if (!response.ok) {
                const message = response.status === 401
                    ? 'Unauthorized. Please sign in again and retry payment.'
                    : extractEdgeErrorMessage(data, 'Failed to create Cashfree order');
                return { success: false, status: 'failed', message };
            }

            if (data?.already_paid) {
                return {
                    success: true,
                    status: 'completed',
                    orderId: data.order_id,
                    paymentSessionId: data.payment_session_id,
                    orderExpiryTime: data.order_expiry_time,
                    message: 'Payment already completed.',
                    metadata: { alreadyPaid: true }
                };
            }

            if (!data?.success) {
                return { success: false, status: 'failed', message: data?.error || 'Payment initiation failed' };
            }

            return {
                success: true,
                status: 'pending',
                orderId: data.order_id,
                paymentSessionId: data.payment_session_id,
                orderExpiryTime: data.order_expiry_time,
                message: 'Payment initiated'
            };
        } catch (error) {
            return {
                success: false,
                status: 'failed',
                message: error instanceof Error ? error.message : 'Payment initiation failed'
            };
        }
    }

    async verifyPayment(_verificationData: Record<string, unknown>): Promise<PaymentResult> {
        return {
            success: false,
            message: 'Verification is handled by realtime webhooks.',
            status: 'failed'
        };
    }
}

// --- Main Payment Service ---

export const paymentService = {
    async preloadProvider(): Promise<void> {
        const providerName = String(import.meta.env.VITE_PAYMENT_PROVIDER || 'cashfree').toLowerCase();
        if (providerName !== 'cashfree') {
            return;
        }

        try {
            await loadCashfreeSdk();
        } catch {
            // Keep payment warmup best-effort so startup is never blocked.
        }
    },
    async createCashfreeComponent(componentName: string, options?: Record<string, unknown>): Promise<CashfreeComponent> {
        const cashfree = await getCashfreeInstance();
        return cashfree.create(componentName, options);
    },
    async payWithCashfreeComponent(input: {
        component: CashfreeComponent;
        paymentSessionId: string;
        savePaymentInstrument?: boolean | CashfreeComponent;
    }): Promise<CashfreePayResult> {
        const cashfree = await getCashfreeInstance();
        return cashfree.pay({
            paymentMethod: input.component,
            paymentSessionId: input.paymentSessionId,
            redirect: 'if_required',
            redirectTarget: '_self',
            ...(input.savePaymentInstrument !== undefined
                ? { savePaymentInstrument: input.savePaymentInstrument }
                : {})
        });
    },
    async markPaymentFailed(input: {
        bookingId?: string;
        orderId?: string;
        paymentType?: string;
        metadata?: Record<string, unknown>;
        reason: string;
        keepalive?: boolean;
    }): Promise<CashfreeFailPaymentResponse> {
        const { response, payload } = await postProtectedEdgeFunction<CashfreeFailPaymentResponse>(
            'cashfree-fail-payment',
            {
                bookingId: input.bookingId,
                orderId: input.orderId,
                paymentType: input.paymentType,
                metadata: input.metadata || null,
                reason: input.reason,
            },
            {
                minValidityMs: 60_000,
                ...(input.keepalive ? { keepalive: true } : {}),
            }
        );

        if (!response.ok) {
            throw new Error(extractEdgeErrorMessage(payload, 'Failed to update payment status'));
        }

        return payload || {};
    },
    getProvider(name: string = import.meta.env.VITE_PAYMENT_PROVIDER || 'cashfree'): PaymentProvider {
        const providerName = (name || 'cashfree').toLowerCase();

        const providers: Record<string, PaymentProvider> = {
            cashfree: new CashfreeProvider(),
            pending: new PendingProvider()
        };

        return providers[providerName] || providers.pending;
    },

    async processPayment(payload: PaymentPayload, upiMethod?: string): Promise<PaymentResult> {
        try {
            const provider = this.getProvider();
            await provider.initialize();
            return await provider.processPayment(payload, upiMethod);
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('Payment process error:', error);
            }
            return {
                success: false,
                message: error instanceof Error ? error.message : 'An unexpected error occurred during payment processing',
                status: 'failed'
            };
        }
    },

    async verifyPaymentStatus(input: { orderId?: string; bookingId?: string; paymentType?: string; metadata?: Record<string, unknown>; forceServer?: boolean }): Promise<{ success: boolean; status?: string; bookingId?: string }> {
        if (!supabaseUrl || !supabaseAnonKey) {
            return { success: false };
        }

        const verifyKey = buildScopedVerifyKey(input);
        if (verifyInFlight.has(verifyKey)) {
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }

        if (!input.forceServer) {
            const localStatus = await resolveLocalPaymentStatus(input);
            if (localStatus) return localStatus;
        }

        const verifyDisabledUntil = getVerifyDisabledUntil();
        if (verifyDisabledUntil && Date.now() < verifyDisabledUntil) {
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }

        if (verifyAuthBlockUntil && Date.now() < verifyAuthBlockUntil) {
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }
        const verifyGlobalKey = `${supabaseUrl || 'global'}:cashfree-verify`;
        const globalBlockedUntil = getStoredBlockUntil(verifyGlobalKey);
        if (globalBlockedUntil && Date.now() < globalBlockedUntil) {
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }

        const storedUntil = getStoredBlockUntil(verifyKey);
        if (storedUntil && Date.now() < storedUntil) {
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }
        const blockedUntil = verifyBlockUntilByKey.get(verifyKey);
        if (blockedUntil && Date.now() < blockedUntil) {
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }

        verifyInFlight.add(verifyKey);
        const inflightUntil = Date.now() + VERIFY_INFLIGHT_BLOCK_MS;
        verifyBlockUntilByKey.set(verifyKey, inflightUntil);
        setStoredBlockUntil(verifyKey, inflightUntil);

        let response: Response;
        let data: CashfreeVerifyOrderResponse = {};
        try {
            const result = await postProtectedEdgeFunction<CashfreeVerifyOrderResponse>(
                'cashfree-verify-order',
                {
                    orderId: input.orderId,
                    bookingId: input.bookingId,
                    paymentType: input.paymentType,
                    metadata: input.metadata || null,
                },
                { minValidityMs: 120_000 }
            );
            response = result.response;
            data = result.payload || {};
        } catch (error) {
            const blockUntil = Date.now() + VERIFY_BLOCK_MS;
            verifyAuthBlockUntil = blockUntil;
            verifyBlockUntilByKey.set(verifyKey, blockUntil);
            setStoredBlockUntil(verifyKey, blockUntil);
            setStoredBlockUntil(verifyGlobalKey, Date.now() + VERIFY_GLOBAL_BLOCK_MS);
            if (error instanceof Error && /sign in again/i.test(error.message)) {
                setVerifyDisabledUntil(Date.now() + VERIFY_DISABLED_ON_401_MS);
            }
            return { success: false, status: 'pending', bookingId: input.bookingId };
        } finally {
            verifyInFlight.delete(verifyKey);
        }

        if (response.status === 401) {
            const blockUntil = Date.now() + VERIFY_BLOCK_MS;
            verifyAuthBlockUntil = blockUntil;
            verifyBlockUntilByKey.set(verifyKey, blockUntil);
            setStoredBlockUntil(verifyKey, blockUntil);
            setStoredBlockUntil(verifyGlobalKey, Date.now() + VERIFY_GLOBAL_BLOCK_MS);
            setVerifyDisabledUntil(Date.now() + VERIFY_DISABLED_ON_401_MS);
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }
        if (!response.ok) {
            if (response.status === 404 && !input.orderId) {
                return { success: false, status: 'pending', bookingId: input.bookingId };
            }
            const backoff = response.status === 404 ? 10 * 60_000 : VERIFY_BLOCK_MS;
            const blockUntil = Date.now() + backoff;
            verifyBlockUntilByKey.set(verifyKey, blockUntil);
            setStoredBlockUntil(verifyKey, blockUntil);
            if (response.status === 404 || response.status === 401) {
                setStoredBlockUntil(verifyGlobalKey, Date.now() + VERIFY_GLOBAL_BLOCK_MS);
            }
            if (response.status === 404) {
                setVerifyDisabledUntil(Date.now() + VERIFY_DISABLED_MS);
            }
            return { success: false, status: 'pending', bookingId: input.bookingId };
        }

        return {
            success: !!data?.success,
            status: data?.status,
            bookingId: data?.booking_id || input.bookingId
        };
    },

    async getPaymentHistory(bookingId: string): Promise<unknown[]> {
        const { data, error } = await supabase
            .from('payments')
            .select('id, booking_id, amount, payment_type, payment_method, status, payment_status, provider_order_id, provider_payment_id, payment_date, created_at, verified_at, failure_reason')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .range(0, PAYMENT_HISTORY_PAGE_SIZE - 1);

        if (error) throw error;
        return data || [];
    }
};
