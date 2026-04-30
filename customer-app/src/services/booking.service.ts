import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase-config';
import { db, addToSyncQueue, type OfflineBooking } from '../db';
import type { Booking, MonthlyPayment, RentCycleState } from '../types/booking.types';
import type { RatingType } from '../types/rating.types';
import { normalizeRentPaymentStatus } from '../utils/normalizePaymentStatus';
import { authService } from './auth.service';
import { deferRealtimeSubscription } from './realtime-subscription';
import { invokeProtectedEdgeFunction } from './protected-edge.service';
import { notificationDispatchService } from './notification-dispatch.service';

interface ValidationArgs {
    propertyId: string;
    roomId: string;
    startDate: string;
    endDate: string;
}

type RpcErrorLike = {
    code?: string;
    message?: string;
};

type RpcMutationResponse = {
    success?: boolean;
    error?: string;
    code?: string;
};

type ValidationResult = {
    success: boolean;
    message: string;
    bookingId?: string;
    alternativeDates?: string[];
};

type CreateBookingCompatResponse = {
    success: boolean;
    booking_id: string;
    compatibility_mode?: boolean;
};

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

type CustomerBookingsCallback = (bookings: Booking[]) => void;

type CustomerBookingsRealtimeSubscription = {
    activeBookingIds: Set<string>;
    callbacks: Set<CustomerBookingsCallback>;
    scheduledFetch: ScheduledFetcher;
    unsubscribeRealtime: (() => void) | null;
    latestBookings: Booking[] | null;
    teardownTimer: ReturnType<typeof setTimeout> | null;
};

const bookingSchemaSupport = {
    // This hosted dev backend is behind the latest schema, so default to the
    // broadest compatible select instead of probing newer booking columns.
    checkInDate: false as boolean | null,
    ratingFlags: true as boolean | null,
    // The current dev backend also omits admin review fields, so avoid
    // requesting them in development and only probe in non-dev builds.
    adminApproval: (import.meta.env.DEV ? false : null) as boolean | null,
    // The hosted dev backend is also behind the latest booking RPC shape, so
    // prefer the compatibility edge-function path instead of probing RPC
    // signatures that only add console noise before failing over anyway.
    createBookingRpc: false as boolean | null,
};

const isRpcMissingError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === 'PGRST202' ||
        /Could not find the function/i.test(message) ||
        /function .* does not exist/i.test(message);
};

const isRpcPermissionFallbackError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42501' ||
        /Customers cannot modify booking pricing, ownership, payment, or review fields directly/i.test(message) ||
        /Customers cannot apply this booking state change directly/i.test(message);
};

const isMissingCheckInDateError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && /bookings\.check_in_date/i.test(message)
        || /Could not find the 'check_in_date' column/i.test(message);
};

const isMissingRatingFlagsError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && /(checkin_rating_submitted|checkout_rating_submitted)/i.test(message)
        || /Could not find the 'checkin_rating_submitted' column/i.test(message)
        || /Could not find the 'checkout_rating_submitted' column/i.test(message);
};

const isMissingAdminApprovalError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && /admin_approved/i.test(message)
        || /Could not find the 'admin_approved' column/i.test(message);
};

const isVacatePreviewCompatibilityError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return /preview_vacate_rent_breakdown/i.test(message) ||
        /function public\.preview_vacate_rent_breakdown/i.test(message);
};

const isVacateBookingSchemaCompatibilityError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && (
        /column "booking_status" of relation "bookings" does not exist/i.test(message) ||
        /column "continue_status" of relation "bookings" does not exist/i.test(message)
    );
};

const logBookingCompatibilityInfo = (message: string) => {
    if (import.meta.env.DEV) {
        console.info(message);
    }
};

const isRpcFailureResponse = (value: unknown): value is RpcMutationResponse => {
    if (!value || typeof value !== 'object') return false;
    const payload = value as RpcMutationResponse;
    return payload.success === false;
};

const VACATE_APPROVAL_BLOCK_MESSAGE = 'VACATE_APPROVAL_PENDING: Your vacate request is still waiting for owner approval. Please wait for the owner to approve vacate before booking another PG.';
const isVacateApprovalPendingError = (message: string) => /VACATE_APPROVAL_PENDING/i.test(message);
const ACTIVE_RESIDENT_STATUSES = new Set(['checked-in', 'active', 'ongoing', 'vacate-requested']);
const PRE_CHECKIN_BOOKING_STATUSES = new Set([
    'requested',
    'pending',
    'approved',
    'accepted',
    'confirmed',
    'paid',
    'payment-pending',
    'payment-failed',
    'rejected',
    'cancelled',
    'refunded'
]);

const normalizeBookingMutationError = (input: unknown): Error => {
    const raw = String(
        (typeof input === 'object' && input !== null && 'error' in input
            ? (input as RpcMutationResponse).error
            : input) || ''
    ).trim();

    if (/BOOKING_NOT_FOUND/i.test(raw)) {
        return new Error('Booking not found.');
    }
    if (/NOT_AUTHORIZED|FORBIDDEN/i.test(raw)) {
        return new Error('You are not allowed to update this booking.');
    }
    if (/UNAUTHENTICATED/i.test(raw)) {
        return new Error('Your session expired. Please sign in again.');
    }
    if (/INVALID_STATUS/i.test(raw)) {
        return new Error('This booking is no longer in a state that allows this action.');
    }

    return new Error(raw || 'Booking update failed.');
};

const ensureCustomerSession = async () => {
    try {
        const session = await authService.getCurrentSession();
        if (session) return session;

        const refreshedSession = await authService.refreshCurrentSession();
        return refreshedSession || null;
    } catch (error) {
        if (await authService.recoverInvalidStoredSession(error)) {
            return null;
        }
        if (import.meta.env.DEV && error instanceof Error) {
            console.warn('[BookingService] Session refresh failed:', error.message);
        }
        throw error;
    }
};

const runBookingRpc = async <T>(rpcName: string, args: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(rpcName, args);

    if (error) {
        if (isRpcMissingError(error)) {
            return { usedRpc: false as const, data: null as T | null };
        }
        throw normalizeBookingMutationError(error.message || error.code);
    }

    if (isRpcFailureResponse(data)) {
        throw normalizeBookingMutationError(data);
    }

    return { usedRpc: true as const, data: data as T };
};

const resolveMonthlyPaymentMonth = (payment: Record<string, unknown>): string => {
    const metadata = payment.metadata as Record<string, unknown> | null | undefined;
    const clientContext = metadata?.client_context as Record<string, unknown> | null | undefined;
    const directMonth = String(clientContext?.month || metadata?.month || '').trim();
    if (/^\d{4}-\d{2}$/.test(directMonth)) {
        return directMonth;
    }

    const noteMonth = String(payment.notes || '').replace('Payment for ', '').trim();
    if (/^\d{4}-\d{2}$/.test(noteMonth)) {
        return noteMonth;
    }

    const paidAt = String(payment.payment_date || payment.created_at || '').trim();
    if (paidAt) {
        const parsed = new Date(paidAt);
        if (!Number.isNaN(parsed.getTime())) {
            return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
        }
    }

    return '';
};

const getBookingDurationDays = (startDate: string, endDate: string): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = end.getTime() - start.getTime();

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || diffTime <= 0) {
        return 0;
    }

    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const parseDateOnly = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const calculateDurationMonths = (startDate?: string, endDate?: string, checkInDate?: string | null) => {
    const anchor = parseDateOnly(checkInDate || startDate);
    const end = parseDateOnly(endDate);

    if (!anchor || !end) {
        return 0;
    }

    let monthCount = (end.getUTCFullYear() - anchor.getUTCFullYear()) * 12
        + (end.getUTCMonth() - anchor.getUTCMonth());

    if (end.getUTCDate() > anchor.getUTCDate()) {
        monthCount += 1;
    }

    return Math.max(1, monthCount);
};

const normalizeRentCycleState = (value: unknown): RentCycleState | null => {
    if (!value || typeof value !== 'object') return null;

    const payload = value as Record<string, unknown>;
    const status = String(payload.status || '').trim().toLowerCase();
    if (!['active', 'due', 'overdue', 'closed'].includes(status)) {
        return null;
    }

    return {
        bookingId: String(payload.booking_id || '').trim(),
        currentCycleStartDate: String(payload.current_cycle_start_date || '').trim() || null,
        cycleEndDate: String(payload.cycle_end_date || '').trim() || null,
        nextDueDate: String(payload.next_due_date || '').trim() || null,
        effectiveCycleStartDate: String(payload.effective_cycle_start_date || '').trim() || null,
        effectiveNextDueDate: String(payload.effective_next_due_date || '').trim() || null,
        coveredThroughDate: String(payload.covered_through_date || '').trim() || null,
        coveredThroughMonth: String(payload.covered_through_month || '').trim() || null,
        currentCycleMonth: String(payload.current_cycle_month || '').trim() || null,
        isCurrentCycleSettled: typeof payload.is_current_cycle_settled === 'boolean'
            ? payload.is_current_cycle_settled
            : Boolean(payload.is_current_cycle_settled),
        isPrepaidFullStay: typeof payload.is_prepaid_full_stay === 'boolean'
            ? payload.is_prepaid_full_stay
            : Boolean(payload.is_prepaid_full_stay),
        cycleDurationDays: Number(payload.cycle_duration_days || 30) || 30,
        serverDate: String(payload.server_date || '').trim() || null,
        status: status as RentCycleState['status'],
        canPayRent: Boolean(payload.can_pay_rent),
        message: String(payload.message || '').trim(),
    };
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
        } catch (error) {
            console.error('[BookingService] Scheduled fetch failed:', error);
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

const CUSTOMER_BOOKINGS_PAGE_SIZE = 100;
const MONTHLY_PAYMENTS_PAGE_SIZE = 24;
const CUSTOMER_BOOKINGS_TEARDOWN_GRACE_MS = 1500;
const LOCAL_BOOKINGS_FETCH_TIMEOUT_MS = Capacitor.isNativePlatform() ? 180 : 1200;
const CUSTOMER_BOOKINGS_FETCH_TIMEOUT_MS = Capacitor.isNativePlatform() ? 3500 : 8000;
const CUSTOMER_BOOKINGS_LEAN_FETCH_TIMEOUT_MS = Capacitor.isNativePlatform() ? 2200 : 4500;
const CUSTOMER_BOOKINGS_FALLBACK_FETCH_TIMEOUT_MS = Capacitor.isNativePlatform() ? 2600 : 5000;
const CUSTOMER_BOOKINGS_SNAPSHOT_STORAGE_PREFIX = 'roomfindr_customer_bookings_snapshot';
const CUSTOMER_BOOKING_SELECT_BASE = [
    'id',
    'customer_id',
    'owner_id',
    'property_id',
    'room_id',
    'room_number',
    'status',
    'start_date',
    'end_date',
    'monthly_rent',
    'advance_paid',
    'amount_due',
    'amount_paid',
    'currency',
    'payment_method',
    'payment_provider',
    'payment_status',
    'rent_payment_status',
    'payment_type',
    'commission_amount',
    'created_at',
    'customer_name',
    'customer_phone',
    'customer_email',
    'next_payment_date',
    'next_due_date',
    'current_cycle_start_date',
    'cycle_duration_days',
    'stay_status',
    'vacate_date'
].join(', ');

const CUSTOMER_BOOKING_SELECT_ENRICHMENTS = [
    'properties(title)',
    'rooms(room_number, room_type, images)'
].join(', ');

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
};

const buildCustomerBookingSelectClause = (
    includeCheckInDate: boolean,
    includeRatingFlags: boolean,
    includeAdminApproval: boolean
) => {
    const columns = CUSTOMER_BOOKING_SELECT_BASE.split(', ').filter(Boolean);

    if (includeCheckInDate) {
        columns.splice(8, 0, 'check_in_date');
    }

    if (includeAdminApproval) {
        columns.splice(27, 0, 'admin_approved');
    }

    if (includeRatingFlags) {
        columns.push('checkin_rating_submitted', 'checkout_rating_submitted');
    }

    return [...columns, CUSTOMER_BOOKING_SELECT_ENRICHMENTS].join(', ');
};

const customerBookingSubscriptions = new Map<string, CustomerBookingsRealtimeSubscription>();

const getCustomerBookingsSnapshotKey = (customerId: string) =>
    `${CUSTOMER_BOOKINGS_SNAPSHOT_STORAGE_PREFIX}:${customerId}`;

const readStoredCustomerBookingsSnapshot = (customerId: string): Booking[] | null => {
    if (typeof window === 'undefined' || !customerId) return null;

    try {
        const raw = window.localStorage.getItem(getCustomerBookingsSnapshotKey(customerId));
        if (!raw) return null;

        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed as Booking[] : null;
    } catch {
        return null;
    }
};

const writeStoredCustomerBookingsSnapshot = (customerId: string, bookings: Booking[]) => {
    if (typeof window === 'undefined' || !customerId) return;

    try {
        window.localStorage.setItem(
            getCustomerBookingsSnapshotKey(customerId),
            JSON.stringify(bookings),
        );
    } catch {
        // Best-effort snapshot only.
    }
};

const fetchCustomerBookingsRowsLean = async (customerId: string) => supabase
    .from('bookings')
    .select(CUSTOMER_BOOKING_SELECT_BASE)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .range(0, CUSTOMER_BOOKINGS_PAGE_SIZE - 1);

const resolveFirstSuccessful = async <T>(promises: Promise<T>[]): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
        if (promises.length === 0) {
            reject(new Error('No booking fetch attempts were provided.'));
            return;
        }

        const failures: unknown[] = [];
        let pendingCount = promises.length;

        promises.forEach((promise) => {
            promise
                .then((value) => {
                    resolve(value);
                })
                .catch((error) => {
                    failures.push(error);
                    pendingCount -= 1;

                    if (pendingCount === 0) {
                        reject(failures[failures.length - 1] ?? new Error('Booking fetch failed.'));
                    }
                });
        });
    });
};

const fetchCustomerBookingsRowsFast = async (customerId: string) => {
    try {
        return await resolveFirstSuccessful([
            withTimeout(
                fetchCustomerBookingsRows(customerId),
                CUSTOMER_BOOKINGS_FETCH_TIMEOUT_MS,
                'Customer bookings request timed out',
            ).then((result) => {
                if (result.error) throw result.error;
                return result;
            }),
            withTimeout(
                fetchCustomerBookingsRowsLean(customerId),
                CUSTOMER_BOOKINGS_LEAN_FETCH_TIMEOUT_MS,
                'Lean customer bookings request timed out',
            ).then((result) => {
                if (result.error) throw result.error;
                return result;
            }),
        ]);
    } catch (primaryError) {
        console.warn('[BookingService] Falling back to simplified customer bookings query:', primaryError);

        return withTimeout(
            fetchCustomerBookingsRowsFallback(customerId),
            CUSTOMER_BOOKINGS_FALLBACK_FETCH_TIMEOUT_MS,
            'Fallback customer bookings request timed out',
        );
    }
};

const fetchCustomerBookingsRows = async (customerId: string) => {
    const runQuery = () => supabase
        .from('bookings')
        .select(buildCustomerBookingSelectClause(
            bookingSchemaSupport.checkInDate === true,
            bookingSchemaSupport.ratingFlags !== false,
            bookingSchemaSupport.adminApproval !== false
        ))
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .range(0, CUSTOMER_BOOKINGS_PAGE_SIZE - 1);

    let result = await runQuery();

    if (bookingSchemaSupport.checkInDate === true && result.error && isMissingCheckInDateError(result.error)) {
        bookingSchemaSupport.checkInDate = false;
        result = await runQuery();
    }

    if (bookingSchemaSupport.ratingFlags !== false && result.error && isMissingRatingFlagsError(result.error)) {
        bookingSchemaSupport.ratingFlags = false;
        result = await runQuery();
    }

    if (bookingSchemaSupport.adminApproval !== false && result.error && isMissingAdminApprovalError(result.error)) {
        bookingSchemaSupport.adminApproval = false;
        result = await runQuery();
    }

    return result;
};

const fetchCustomerBookingsRowsFallback = async (customerId: string) => supabase
    .from('bookings')
    .select([
        'id',
        'customer_id',
        'owner_id',
        'property_id',
        'room_id',
        'room_number',
        'status',
        'start_date',
        'end_date',
        'check_in_date',
        'monthly_rent',
        'advance_paid',
        'amount_due',
        'amount_paid',
        'currency',
        'payment_method',
        'payment_provider',
        'payment_status',
        'rent_payment_status',
        'payment_type',
        'commission_amount',
        'created_at',
        'customer_name',
        'customer_phone',
        'customer_email',
        'next_payment_date',
        'next_due_date',
        'current_cycle_start_date',
        'cycle_duration_days',
        'admin_approved',
        'stay_status',
        'vacate_date',
        'checkin_rating_submitted',
        'checkout_rating_submitted',
    ].join(', '))
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .range(0, CUSTOMER_BOOKINGS_PAGE_SIZE - 1);

const createCustomerBookingsRealtimeSubscription = (customerId: string): CustomerBookingsRealtimeSubscription => {
    const activeBookingIds = new Set<string>();
    const callbacks = new Set<CustomerBookingsCallback>();
    let emptyRefetchAttempts = 0;
    let warmupRefetchAttempts = 0;
    let warmupTimer: number | null = null;

    const clearWarmupTimer = () => {
        if (warmupTimer) {
            window.clearTimeout(warmupTimer);
            warmupTimer = null;
        }
    };

    const scheduleWarmupRefetch = () => {
        if (callbacks.size === 0 || warmupRefetchAttempts >= 3) return;
        clearWarmupTimer();
        warmupRefetchAttempts += 1;
        warmupTimer = window.setTimeout(() => {
            warmupTimer = null;
            if (callbacks.size > 0) {
                scheduledFetch.schedule();
            }
        }, 900 * warmupRefetchAttempts);
    };

    const notifySubscribers = (bookings: Booking[]) => {
        callbacks.forEach((subscriber) => {
            subscriber(bookings);
        });
    };

    const scheduledFetch = createScheduledFetcher(async () => {
        const data = await bookingService.getCustomerBookings(customerId);
        activeBookingIds.clear();
        data.forEach((booking) => {
            if (booking.bookingId) {
                activeBookingIds.add(booking.bookingId);
            }
        });
        subscription.latestBookings = data;
        notifySubscribers(data);
        scheduleWarmupRefetch();

        if (data.length > 0) {
            emptyRefetchAttempts = 0;
            return;
        }

        // Seeded E2E rows can arrive a fraction later than the first post-login fetch.
        if (callbacks.size > 0 && emptyRefetchAttempts < 3) {
            emptyRefetchAttempts += 1;
            window.setTimeout(() => {
                if (callbacks.size > 0) {
                    scheduledFetch.schedule();
                }
            }, 350 * emptyRefetchAttempts);
        }
    });

    const unsubscribeRealtime = deferRealtimeSubscription(() => {
        const heartbeat = window.setInterval(() => {
            if (callbacks.size > 0) {
                scheduledFetch.schedule();
            }
        }, 4000);

        const bookingChannel = supabase.channel(`cust-booking-sync-${customerId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${customerId}`
        }, () => scheduledFetch.schedule()).subscribe();

        const paymentChannel = supabase.channel(`cust-payment-sync-${customerId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'payments'
        }, (payload) => {
            const bookingId = String(
                (payload.new as Record<string, unknown> | null | undefined)?.booking_id ||
                (payload.old as Record<string, unknown> | null | undefined)?.booking_id ||
                ''
            ).trim();
            if (bookingId && activeBookingIds.has(bookingId)) {
                scheduledFetch.schedule();
            }
        }).subscribe();

        return () => {
            clearWarmupTimer();
            window.clearInterval(heartbeat);
            void supabase.removeChannel(bookingChannel);
            void supabase.removeChannel(paymentChannel);
        };
    });

    const subscription: CustomerBookingsRealtimeSubscription = {
        activeBookingIds,
        callbacks,
        scheduledFetch,
        unsubscribeRealtime,
        latestBookings: null,
        teardownTimer: null
    };

    return subscription;
};

const scheduleCustomerBookingsRealtimeTeardown = (customerId: string, subscription: CustomerBookingsRealtimeSubscription) => {
    if (subscription.teardownTimer) {
        clearTimeout(subscription.teardownTimer);
    }

    subscription.teardownTimer = setTimeout(() => {
        const activeSubscription = customerBookingSubscriptions.get(customerId);
        if (!activeSubscription || activeSubscription.callbacks.size > 0) {
            return;
        }

        activeSubscription.scheduledFetch.cancel();
        activeSubscription.unsubscribeRealtime?.();
        customerBookingSubscriptions.delete(customerId);
    }, CUSTOMER_BOOKINGS_TEARDOWN_GRACE_MS);
};

type CustomerBookingRow = {
    id: string;
    customer_id: string;
    owner_id: string;
    property_id: string;
    room_id: string;
    room_number?: string;
    status: string;
    start_date: string;
    end_date: string;
    check_in_date?: string | null;
    monthly_rent: number;
    advance_paid: number;
    amount_due: number;
    amount_paid: number;
    currency?: string;
    payment_method?: string;
    payment_provider?: string;
    created_at: string;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    payment_status?: string;
    rent_payment_status?: string;
    payment_type?: string;
    commission_amount?: number;
    next_payment_date?: string;
    next_due_date?: string;
    current_cycle_start_date?: string | null;
    cycle_duration_days?: number;
    admin_approved?: boolean;
    stay_status?: string;
    vacate_date?: string | null;
    checkin_rating_submitted?: boolean;
    checkout_rating_submitted?: boolean;
    properties?: { title?: string };
    rooms?: {
        room_number?: string;
        room_type?: string;
        images?: string[];
    };
};

export const bookingService = {
    // Get all bookings for a customer
    getCustomerBookings: async (customerId: string): Promise<Booking[]> => {
        if (!customerId || customerId === 'some_user_id') {
            console.warn('Invalid customerId passed to getCustomerBookings:', customerId);
            return [];
        }

        const localBookings = await withTimeout(
            db.bookings
                .filter(b => b.customerId === customerId && b.syncStatus === 'PENDING')
                .toArray(),
            LOCAL_BOOKINGS_FETCH_TIMEOUT_MS,
            'Local booking cache timed out',
        ).catch((error) => {
            console.warn('[BookingService] Falling back without local pending bookings:', error);
            return [];
        });

        // Map local bookings to booking type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mappedLocal = localBookings.map(b => ({ ...b, status: b.status || 'requested' } as any as Booking));

        const serverResult = await fetchCustomerBookingsRowsFast(customerId);
        const data = ((serverResult.data || []) as unknown as CustomerBookingRow[]);
        const error = serverResult.error;

        if (error) throw error;

        const serverBookings = (data || []).map((b) => {
            const duration = calculateDurationMonths(b.start_date, b.end_date, b.check_in_date || null) || 1;

            return {
                bookingId: b.id, customerId: b.customer_id, ownerId: b.owner_id, propertyId: b.property_id,
                roomId: b.room_id, status: b.status, startDate: b.start_date, endDate: b.end_date,
                checkInDate: b.check_in_date || null,
                monthlyRent: b.monthly_rent, advancePaid: b.advance_paid, amountDue: b.amount_due, currency: b.currency, paymentMethod: b.payment_method, paymentProvider: b.payment_provider,
                createdAt: b.created_at,
                customerName: b.customer_name, customerPhone: b.customer_phone, customerEmail: b.customer_email || '',
                propertyTitle: b.properties?.title || 'Unknown Property',
                roomNumber: b.rooms?.room_number || b.room_number || 'N/A',
                rooms: b.rooms ? {
                    room_number: b.rooms.room_number,
                    room_type: b.rooms.room_type || 'Standard',
                    images: b.rooms.images || []
                } : undefined,
                durationMonths: duration,
                paymentStatus: (b.payment_status as string) || 'pending',
                rentPaymentStatus: (b.rent_payment_status as string) || 'not_due',
                paymentType: (String(b.payment_type || '').trim().toLowerCase() === 'full'
                    ? 'full'
                    : String(b.payment_type || '').trim().toLowerCase() === 'advance'
                        ? 'advance'
                        : String(b.payment_type || '').trim().toLowerCase() === 'deposit'
                            ? 'advance'
                            : String(b.payment_type || '').trim().toLowerCase() === 'monthly'
                                || String(b.payment_type || '').trim().toLowerCase() === 'rent'
                                || String(b.payment_type || '').trim().toLowerCase() === 'monthly_rent'
                                ? 'monthly'
                                : 'advance'),
                amountPaid: b.amount_paid || b.advance_paid || 0,
                commissionAmount: Number(b.commission_amount || 0) || 0,
                notifications: [],
                ratingSubmitted: Boolean(b.checkin_rating_submitted || b.checkout_rating_submitted),
                checkinRatingSubmitted: Boolean(b.checkin_rating_submitted),
                checkoutRatingSubmitted: Boolean(b.checkout_rating_submitted),
                nextPaymentDate: b.next_due_date || b.next_payment_date,
                currentCycleStartDate: b.current_cycle_start_date || null,
                nextDueDate: b.next_due_date || null,
                cycleDurationDays: Number(b.cycle_duration_days || 30) || 30,
                adminApproved: Boolean(b.admin_approved),
                stayStatus: b.stay_status || undefined,
                vacateDate: b.vacate_date || null
            } as Booking;
        });

        const combinedBookings = [...mappedLocal, ...serverBookings];
        writeStoredCustomerBookingsSnapshot(customerId, combinedBookings);

        return combinedBookings;
    },

    // Real-time subscription to customer bookings (Global Sync Engine)
    subscribeToCustomerBookings: (customerId: string, callback: (bookings: Booking[]) => void): (() => void) => {
        let subscription = customerBookingSubscriptions.get(customerId);
        if (!subscription) {
            subscription = createCustomerBookingsRealtimeSubscription(customerId);
            customerBookingSubscriptions.set(customerId, subscription);
        }

        if (subscription.teardownTimer) {
            clearTimeout(subscription.teardownTimer);
            subscription.teardownTimer = null;
        }

        subscription.callbacks.add(callback);

        if (subscription.latestBookings) {
            callback(subscription.latestBookings);
        } else {
            const cachedSnapshot = readStoredCustomerBookingsSnapshot(customerId);
            if (cachedSnapshot) {
                subscription.latestBookings = cachedSnapshot;
                callback(cachedSnapshot);
            }
            subscription.scheduledFetch.flush();
        }

        return () => {
            const activeSubscription = customerBookingSubscriptions.get(customerId);
            if (!activeSubscription) return;

            activeSubscription.callbacks.delete(callback);
            if (activeSubscription.callbacks.size === 0) {
                scheduleCustomerBookingsRealtimeTeardown(customerId, activeSubscription);
            }
        };
    },

    // Cancel booking logic (SAFE RPC V2)
    cancelBooking: async (bookingId: string, reason: string): Promise<void> => {
        await ensureCustomerSession();

        const rpcResult = await runBookingRpc<unknown>('cancel_booking_v2', {
            p_booking_id: bookingId,
            p_reason: reason
        });

        const getCurrentStatus = async () => {
            const { data, error } = await supabase
                .from('bookings')
                .select('status')
                .eq('id', bookingId)
                .maybeSingle();

            if (error) throw error;
            return String(data?.status || '').trim().toLowerCase();
        };

        if (rpcResult.usedRpc) {
            const status = await getCurrentStatus();
            if (['cancelled', 'cancelled-by-customer'].includes(status)) {
                return;
            }
        }

        const { error } = await supabase
            .from('bookings')
            .update({
                status: 'cancelled',
                payment_status: 'cancelled'
            })
            .eq('id', bookingId);

        if (error) {
            console.error('[BookingService] Cancellation fallback failed:', error);
            throw new Error(error.message || 'Failed to cancel booking');
        }
    },

    // Monthly payments
    createMonthlyPayment: async (_bookingId: string, _paymentData: { month: string; amount: number; transactionId?: string; paymentMethod?: string }): Promise<string> => {
        throw new Error('Manual monthly payment recording is disabled. Start rent payments through the Cashfree checkout flow.');
    },

    getMonthlyPayments: async (bookingId: string): Promise<MonthlyPayment[]> => {
        const { data, error } = await supabase
            .from('payments')
            .select('id, booking_id, amount, payment_type, payment_date, created_at, provider, provider_order_id, metadata, failure_reason, status, payment_status')
            .eq('booking_id', bookingId)
            .in('payment_type', ['monthly', 'rent', 'monthly_rent'])
            .order('payment_date', { ascending: false })
            .range(0, MONTHLY_PAYMENTS_PAGE_SIZE - 1);
        if (error) throw error;
        return (data || []).reverse().map(p => ({
            paymentId: p.id,
            bookingId: p.booking_id,
            month: resolveMonthlyPaymentMonth(p as Record<string, unknown>),
            amount: p.amount,
            status: normalizeRentPaymentStatus(p as Record<string, unknown>),
            paidAt: p.payment_date || p.created_at,
            paymentProvider: p.provider || undefined,
            orderId: p.provider_order_id || undefined,
            metadata: (p.metadata as Record<string, unknown> | null) || undefined,
            failureReason: p.failure_reason || undefined,
        } as MonthlyPayment));
    },

    subscribeToMonthlyPayments: (bookingId: string, callback: (payments: MonthlyPayment[]) => void): (() => void) => {
        const scheduledFetch = createScheduledFetcher(async () => {
            const data = await bookingService.getMonthlyPayments(bookingId);
            callback(data);
        });
        scheduledFetch.flush();
        const channel = supabase.channel(`monthly-payments-${bookingId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'payments', filter: `booking_id=eq.${bookingId}`
        }, () => {
            scheduledFetch.schedule();
        }).subscribe();
        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },

    getBookingRentCycle: async (bookingId: string): Promise<RentCycleState | null> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_booking_rent_cycle', {
            p_booking_id: bookingId
        });

        if (error) {
            if (isRpcMissingError(error)) {
                return null;
            }
            if (isRpcPermissionFallbackError(error)) {
                return null;
            }
            throw normalizeBookingMutationError(error.message || error.code);
        }

        return normalizeRentCycleState(data);
    },

    // 🚪 Vacate PG logic (Updates status and vacate_date)
    // 🚪 Vacate PG logic (Updates status and vacate_date)
    vacateBooking: async (bookingId: string): Promise<void> => {
        await ensureCustomerSession();

        let rpcResult: { usedRpc: boolean; data: unknown | null } = { usedRpc: false, data: null };
        let skipStatusUpdate = false;
        try {
            rpcResult = await runBookingRpc<unknown>('customer_request_vacate', {
                p_booking_id: bookingId
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '');
            if (
                !isRpcPermissionFallbackError({ message })
                && !isVacatePreviewCompatibilityError({ message })
                && !isVacateBookingSchemaCompatibilityError({ message, code: '42703' })
            ) {
                throw error;
            }
        }
        if (rpcResult.usedRpc) {
            const { data: currentBooking, error: currentBookingError } = await supabase
                .from('bookings')
                .select('status, stay_status, vacate_date')
                .eq('id', bookingId)
                .maybeSingle();

            if (currentBookingError) {
                throw currentBookingError;
            }

            const normalizedStatus = String(currentBooking?.status || '').trim().toLowerCase().replace(/_/g, '-');
            const normalizedStayStatus = String(currentBooking?.stay_status || '').trim().toLowerCase().replace(/_/g, '-');
            if (
                normalizedStatus === 'vacate-requested'
                || normalizedStayStatus === 'vacate-requested'
                || Boolean(currentBooking?.vacate_date)
            ) {
                skipStatusUpdate = true;
            }
        }

        // 1. Fetch details for notification
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('owner_id, customer_name, property_id, properties(title), rooms(room_number)')
            .eq('id', bookingId)
            .single();

        if (fetchError) {
            console.error('[BookingService] Failed to fetch booking details for vacate:', fetchError);
            // Proceed with update anyway to not block user
        }

        // 2. Update status
        if (!skipStatusUpdate) {
            const { error } = await supabase.from('bookings').update({
                stay_status: 'vacate_requested',
                status: 'vacate_requested'
            }).eq('id', bookingId);

            if (error) {
                console.error('[BookingService] Vacate failed:', error);
                throw new Error(error.message || 'Failed to vacate PG');
            }
        }

        // 3. Notify Owner
        if (booking) {
            const rooms = booking.rooms as { room_number?: string } | null;
            const roomNum = rooms?.room_number || '';
            const roomLabel = roomNum ? `Room ${roomNum}` : 'booking';
            await notificationDispatchService.send({
                userId: String(booking.owner_id || '').trim(),
                title: 'Vacate request',
                body: `${booking.customer_name} requested vacate for ${roomLabel}.`,
                type: 'booking',
                route: '/bookings',
                bookingId,
                audience: 'owner',
                eventParts: ['customer-vacate-request', bookingId, booking.owner_id],
                data: {
                    status: 'vacate_requested',
                    event_name: 'customer_vacate_request',
                    property_id: booking.property_id,
                },
            }).catch((notificationError) => {
                console.warn('[BookingService] Failed to dispatch vacate notification:', notificationError);
            });
        }

    },


    validateBooking: async (args: ValidationArgs, customerId?: string): Promise<ValidationResult> => {
        if (customerId) {
            // 1. Check for ANY active stay across all properties (staying in one PG already)
            // NOTE: PAID status means "payment received, awaiting owner approval" - NOT an active stay yet
            const { data: activeStay, error: stayError } = await supabase
                .from('bookings')
                .select('id, status, stay_status, properties(title)')
                .eq('customer_id', customerId)
                .is('vacate_date', null)
                .limit(25);

            if (stayError) {
                console.error('Validation stay check error:', stayError);
            } else if (activeStay && activeStay.length > 0) {
                const stay = activeStay.find((booking) => {
                    const normalizedStatus = String(booking.status || '').trim().toLowerCase().replace(/_/g, '-');
                    const normalizedStayStatus = String(booking.stay_status || '').trim().toLowerCase().replace(/_/g, '-');
                    const hasActiveResidentStatus = ACTIVE_RESIDENT_STATUSES.has(normalizedStatus);
                    const hasActiveResidentStayStatus = ACTIVE_RESIDENT_STATUSES.has(normalizedStayStatus)
                        && !PRE_CHECKIN_BOOKING_STATUSES.has(normalizedStatus);

                    return hasActiveResidentStatus || hasActiveResidentStayStatus;
                });

                if (!stay) {
                    return { success: true, message: 'Dates available' };
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const propTitle = (stay.properties as any)?.title || 'another PG';
                const normalizedStatus = String(stay.status || '').trim().toLowerCase().replace(/_/g, '-');
                const normalizedStayStatus = String(stay.stay_status || '').trim().toLowerCase().replace(/_/g, '-');

                if (normalizedStatus === 'vacate-requested' || normalizedStayStatus === 'vacate-requested') {
                    return {
                        success: false,
                        message: `${VACATE_APPROVAL_BLOCK_MESSAGE} Current PG: ${propTitle}.`
                    };
                }

                return {
                    success: false,
                    message: `ACTIVE_PG_BOOKING_EXISTS: You are already staying in ${propTitle}. Please vacate your current PG before booking another one.`
                };
            }

            // 2. Check for ANY pending/requested booking for the SAME property
            const { data: pendingBooking, error: pendingError } = await supabase
                .from('bookings')
                .select('id, status, payment_status, amount_paid, properties(title)')
                .eq('customer_id', customerId)
                .is('vacate_date', null)
                .in('status', ['pending', 'requested', 'approved', 'accepted', 'confirmed'])
                .eq('property_id', args.propertyId)
                .limit(10);

            if (pendingError) {
                console.error('Validation pending check error:', pendingError);
            } else if (pendingBooking && pendingBooking.length > 0) {
                const shouldBlock = pendingBooking.some((booking) => {
                    const normalizedStatus = String(booking.status || '').trim().toLowerCase();
                    const normalizedPaymentStatus = String(booking.payment_status || '').trim().toLowerCase();
                    const amountPaid = Number(booking.amount_paid || 0);

                    if (normalizedStatus === 'approved' || normalizedStatus === 'accepted' || normalizedStatus === 'confirmed') {
                        return true;
                    }

                    return normalizedPaymentStatus === 'paid'
                        || normalizedPaymentStatus === 'completed'
                        || normalizedPaymentStatus === 'success'
                        || normalizedPaymentStatus === 'authorized'
                        || amountPaid > 0;
                });

                if (!shouldBlock) {
                    return { success: true, message: 'Dates available' };
                }

                return {
                    success: false,
                    message: "ACTIVE_PG_BOOKING_EXISTS: You already have a pending request for this PG. Please wait for the owner to respond."
                };
            }
        }
        return { success: true, message: 'Dates available' };
    },

    createBooking: async (bookingData: Omit<Booking, 'bookingId' | 'createdAt'>): Promise<string> => {
        // Checking Network Status
        if (!navigator.onLine) {
            const tempId = `temp-${Date.now()}`;

            // Add to Sync Queue
            await addToSyncQueue('CREATE_BOOKING', { ...bookingData, tempId });

            // Add to Local Bookings for immediate UI feedback

            await db.bookings.add({
                ...bookingData,
                bookingId: tempId,
                status: 'payment_pending',
                paymentStatus: 'payment_pending',
                createdAt: new Date().toISOString(),
                syncStatus: 'PENDING',
                // Mock properties for UI
                customerName: bookingData.customerName,
                customerPhone: bookingData.customerPhone,
                customerEmail: bookingData.customerEmail,
                advancePaid: bookingData.advancePaid || 0,
                monthlyRent: bookingData.monthlyRent,
                durationMonths: bookingData.durationMonths || 1,
                startDate: bookingData.startDate,
                endDate: bookingData.endDate,
                ownerId: bookingData.ownerId,
                propertyId: bookingData.propertyId,
                roomId: bookingData.roomId,
                customerId: bookingData.customerId,
                propertyTitle: bookingData.propertyTitle || 'Pending Sync',
                roomNumber: bookingData.roomNumber || 'Assigned',
                amountPaid: bookingData.advancePaid || 0,
                paymentType: bookingData.paymentType || 'advance',
                notifications: []
            } as OfflineBooking);

            return tempId;
        }

        const durationDays = getBookingDurationDays(bookingData.startDate, bookingData.endDate);
        const selectedMonths = Math.max(0, Math.floor(bookingData.durationMonths || 0));
        const calculatedTotalRent = durationDays > 0 && durationDays < 30
            ? Number((((bookingData.monthlyRent || 0) / 30) * durationDays).toFixed(2))
            : Number(((bookingData.monthlyRent || 0) * selectedMonths).toFixed(2));
        const requestedAmountDue = Number(
            bookingData.finalAmount
            ?? bookingData.amountDue
            ?? bookingData.advancePaid
            ?? bookingData.amountPaid
            ?? 0
        );
        const bookingKey = bookingData.transactionId?.trim()
            ? bookingData.transactionId.trim()
            : `BK-${bookingData.customerId.slice(0, 8)}-${Date.now()}`;

        const shouldFallbackToLegacyRpc = (rpcError: { code?: string; message?: string } | null | undefined) => Boolean(
            rpcError && (
                rpcError.code === 'PGRST202' ||
                /Could not find.*create_booking_v4/i.test(rpcError.message || '') ||
                /function.*create_booking_v4/i.test(rpcError.message || '')
            )
        );

        const buildRpcAttempts = (override: boolean) => {
            const baseRpcParams = {
                p_property_id: bookingData.propertyId,
                p_room_id: (bookingData.roomId === 'generic' || bookingData.roomId === 'Assigned' || !bookingData.roomId) ? null : bookingData.roomId,
                p_customer_id: bookingData.customerId,
                p_owner_id: bookingData.ownerId,
                p_start_date: bookingData.startDate,
                p_end_date: bookingData.endDate,
                p_monthly_rent: bookingData.monthlyRent,
                p_advance_paid: bookingData.advancePaid || 0,
                p_customer_name: bookingData.customerName,
                p_customer_phone: bookingData.customerPhone,
                p_customer_email: bookingData.customerEmail,
                p_room_number: bookingData.roomNumber,
                p_payment_type: bookingData.paymentType,
                p_transaction_id: bookingData.transactionId || '',
                p_amount_paid: bookingData.amountPaid || 0,
                p_duration_months: selectedMonths,
                p_override: override
            };

            const amountDueRpcParams = {
                ...baseRpcParams,
                p_amount_due: requestedAmountDue
            };

            const extendedRpcParams = {
                ...amountDueRpcParams,
                p_booking_key: bookingKey,
                p_stay_type: durationDays > 0 && durationDays < 30 ? 'daily' : 'monthly',
                p_selected_months: selectedMonths,
                p_selected_days: durationDays,
                p_total_rent: calculatedTotalRent,
                p_valid_till: bookingData.endDate,
                p_booking_status: bookingData.status || 'payment_pending',
                p_portal_access: false,
                p_continue_status: 'new'
            };

            return [
                { label: 'extended', params: extendedRpcParams },
                { label: 'amount_due', params: amountDueRpcParams },
                { label: 'legacy', params: baseRpcParams }
            ];
        };

        const executeCreateBookingRpc = async (override: boolean) => {
            const rpcAttempts = buildRpcAttempts(override);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let data: any = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let error: any = null;

            for (let index = 0; index < rpcAttempts.length; index += 1) {
                const attempt = rpcAttempts[index];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const response = await (supabase as any).rpc('create_booking_v4', attempt.params);
                data = response.data;
                error = response.error;

                if (!error || !shouldFallbackToLegacyRpc(error) || index === rpcAttempts.length - 1) {
                    break;
                }

                logBookingCompatibilityInfo(`[BookingService] Falling back to ${rpcAttempts[index + 1].label} create_booking_v4 signature`);
            }

            return { data, error };
        };

        const createBookingViaCompatibilityEdge = async (override: boolean) => {
            const response = await invokeProtectedEdgeFunction<CreateBookingCompatResponse>(
                'create-booking-compat',
                {
                    propertyId: bookingData.propertyId,
                    roomId: (bookingData.roomId === 'generic' || bookingData.roomId === 'Assigned' || !bookingData.roomId)
                        ? null
                        : bookingData.roomId,
                    ownerId: bookingData.ownerId,
                    customerId: bookingData.customerId,
                    customerName: bookingData.customerName,
                    customerPhone: bookingData.customerPhone,
                    customerEmail: bookingData.customerEmail,
                    roomNumber: bookingData.roomNumber,
                    startDate: bookingData.startDate,
                    endDate: bookingData.endDate,
                    paymentType: bookingData.paymentType,
                    transactionId: bookingData.transactionId || '',
                    status: bookingData.status || 'payment_pending',
                    amountPaid: bookingData.amountPaid || 0,
                    advancePaid: bookingData.advancePaid || 0,
                    amountDue: requestedAmountDue,
                    finalAmount: bookingData.finalAmount ?? requestedAmountDue,
                    monthlyRent: bookingData.monthlyRent,
                    durationMonths: selectedMonths,
                    override
                },
                'Unable to create the booking right now.'
            );

            if (!response?.success || !response.booking_id) {
                throw new Error('Booking failed. No data returned from compatibility service.');
            }

            return response.booking_id;
        };

        if (bookingSchemaSupport.createBookingRpc === false) {
            logBookingCompatibilityInfo('[BookingService] Using create-booking-compat edge flow for this hosted backend');
            return createBookingViaCompatibilityEdge(false);
        }

        let { data, error } = await executeCreateBookingRpc(false);

        if (error) {
            const errorMsg = error.message || '';
            const isActiveBookingError = errorMsg.includes('ACTIVE_PG_BOOKING_EXISTS') ||
                errorMsg.includes('already stayed') ||
                isVacateApprovalPendingError(errorMsg) ||
                errorMsg.includes('vacate');

            if (isActiveBookingError) {
                const validation = await bookingService.validateBooking({
                    propertyId: bookingData.propertyId,
                    roomId: bookingData.roomId,
                    startDate: bookingData.startDate,
                    endDate: bookingData.endDate
                }, bookingData.customerId);

                if (validation.success) {
                    logBookingCompatibilityInfo('[BookingService] Retrying create_booking_v4 with override after stale active-booking conflict');
                    ({ data, error } = await executeCreateBookingRpc(true));
                } else if (isVacateApprovalPendingError(validation.message)) {
                    throw new Error(validation.message);
                }
            }
        }

        if (error) {
            const errorMsg = error.message || '';
            const isActiveBookingError = errorMsg.includes('ACTIVE_PG_BOOKING_EXISTS') ||
                errorMsg.includes('already stayed') ||
                isVacateApprovalPendingError(errorMsg) ||
                errorMsg.includes('vacate');
            const isRoomFullError = /ROOM_FULL/i.test(errorMsg);
            const canUseCompatibilityFallback = shouldFallbackToLegacyRpc(error) || isRpcPermissionFallbackError(error);

            if (!isActiveBookingError && !isRoomFullError) {
                console.error('[BookingService] RPC Error:', error);
            }

            if (canUseCompatibilityFallback) {
                logBookingCompatibilityInfo('[BookingService] Falling back to create-booking-compat edge flow');
                return createBookingViaCompatibilityEdge(false);
            }

            if (isActiveBookingError) {
                const validation = await bookingService.validateBooking({
                    propertyId: bookingData.propertyId,
                    roomId: bookingData.roomId,
                    startDate: bookingData.startDate,
                    endDate: bookingData.endDate
                }, bookingData.customerId);

                if (validation.success) {
                    logBookingCompatibilityInfo('[BookingService] Falling back to create-booking-compat edge flow after stale active-booking conflict');
                    return createBookingViaCompatibilityEdge(true);
                }

                if (isVacateApprovalPendingError(validation.message)) {
                    throw new Error(validation.message);
                }
            }

            // 🛡️ CATCH THE CUSTOM STAY LOCK ERROR (409 Conflict)
            if (isActiveBookingError) {
                if (isVacateApprovalPendingError(errorMsg)) {
                    throw new Error(errorMsg);
                }
                throw new Error('ACTIVE_PG_BOOKING_EXISTS: You are already staying in this PG. Please vacate your current room before booking another one.');
            }
            if (isRoomFullError) {
                throw new Error('ROOM_FULL');
            }
            throw new Error(`Database Error (${error.code || 'UNKNOWN'}): ${error.message || 'Unknown error occurred'}`);
        }

        if (!data || !data.success) {
            console.error('[BookingService] Unexpected response:', data);
            throw new Error('Booking failed. No data returned from server.');
        }

        return data.booking_id;
    },
    getBookingById: async (bookingId: string): Promise<Booking | null> => {
        await ensureCustomerSession();
        const { data, error } = await supabase.from('bookings').select('*, properties(title), rooms(room_number, room_type, images)').eq('id', bookingId).single();
        if (error) { if (error.code === 'PGRST116') return null; throw error; }

        const duration = calculateDurationMonths(data.start_date, data.end_date, data.check_in_date || null) || 1;

        return {
            bookingId: data.id,
            customerId: data.customer_id,
            ownerId: data.owner_id,
            propertyId: data.property_id,
            roomId: data.room_id,
            status: data.status,
            startDate: data.start_date,
            endDate: data.end_date,
            checkInDate: data.check_in_date || null,
            monthlyRent: data.monthly_rent,
            advancePaid: data.advance_paid,
            amountDue: data.amount_due,
            currency: data.currency,
            paymentMethod: data.payment_method,
            paymentProvider: data.payment_provider,
            createdAt: data.created_at,
            customerName: data.customer_name,
            customerPhone: data.customer_phone,
            customerEmail: data.customer_email || '',
            propertyTitle: data.properties?.title || 'Unknown Property',
            roomNumber: data.rooms?.room_number || 'N/A',
            rooms: data.rooms ? {
                room_number: data.rooms.room_number,
                room_type: data.rooms.room_type || 'Standard',
                images: data.rooms.images || []
            } : undefined,
            durationMonths: duration,
            paymentStatus: (data.payment_status as string) || 'pending',
            rentPaymentStatus: (data.rent_payment_status as string) || 'not_due',
            paymentType: (String(data.payment_type || '').trim().toLowerCase() === 'full'
                ? 'full'
                : String(data.payment_type || '').trim().toLowerCase() === 'advance'
                    ? 'advance'
                    : String(data.payment_type || '').trim().toLowerCase() === 'deposit'
                        ? 'advance'
                        : String(data.payment_type || '').trim().toLowerCase() === 'monthly'
                            || String(data.payment_type || '').trim().toLowerCase() === 'rent'
                            || String(data.payment_type || '').trim().toLowerCase() === 'monthly_rent'
                            ? 'monthly'
                            : 'advance'),
            amountPaid: data.amount_paid || data.advance_paid || 0,
            commissionAmount: Number(data.commission_amount || 0) || 0,
            notifications: [],
            ratingSubmitted: Boolean(data.checkin_rating_submitted || data.checkout_rating_submitted),
            checkinRatingSubmitted: Boolean(data.checkin_rating_submitted),
            checkoutRatingSubmitted: Boolean(data.checkout_rating_submitted),
            nextPaymentDate: data.next_due_date || data.next_payment_date,
            currentCycleStartDate: data.current_cycle_start_date || null,
            nextDueDate: data.next_due_date || null,
            cycleDurationDays: Number(data.cycle_duration_days || 30) || 30,
            adminApproved: Boolean(data.admin_approved),
            stayStatus: data.stay_status || undefined,
            vacateDate: data.vacate_date || null
        } as Booking;
    },

    // 🕵️ Real-time verification for booking status (Seamless Payment Flow)
    waitForBookingVerification: async (bookingId: string, timeoutMs: number = 30000): Promise<Booking> => {
        return new Promise((resolve, reject) => {
            const channel = supabase.channel(`verify-${bookingId}`).on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'bookings',
                filter: `id=eq.${bookingId}`
            }, async (payload) => {
                const newStatus = payload.new.status;

                if (newStatus !== 'payment_pending' && newStatus !== 'pending') {
                    clearTimeout(timeout);
                    supabase.removeChannel(channel);

                    // Re-fetch full object to ensure we have all joined data (properties, rooms)
                    const b = await bookingService.getBookingById(bookingId);
                    if (b) resolve(b);
                    else reject(new Error('Booking not found after verification'));
                }
            }).subscribe();

            const timeout = setTimeout(() => {
                supabase.removeChannel(channel);
                reject(new Error('Verification timed out. Please check your bookings list later.'));
            }, timeoutMs);
        });
    },

    async hasUserRatedBooking(bookingId: string, type?: RatingType): Promise<boolean> {
        let query = supabase
            .from('ratings')
            .select('*', { count: 'exact', head: true })
            .eq('booking_id', bookingId);

        if (type) {
            query = query.eq('type', type);
        }

        const { count, error } = await query;

        if (error) {
            console.error('Error checking rating status:', error);
            return false;
        }
        return (count || 0) > 0;
    },

    // 👥 Fetch real roommates for a specific room
    // Switched to RPC (get_resident_roommates) to avoid recursive RLS policy loops (500 errors)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getRoommates: async (roomId: string, currentCustomerId: string, propertyId?: string, roomNumber?: string): Promise<any[]> => {
        if (!currentCustomerId || !propertyId) return [];


        // 🌉 CALL THE SAFE BRIDGE: Uses a secure RPC function
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_resident_roommates', {
            p_property_id: propertyId
        });

        if (error) {
            const errorText = `${error.message || ''} ${error.details || ''}`.toLowerCase();
            const isRecoverableLockAbort =
                errorText.includes('aborterror')
                || errorText.includes('lock broken by another request')
                || errorText.includes('request was aborted');

            if (isRecoverableLockAbort) {
                if (import.meta.env.DEV) {
                    console.warn('[SafeBridge] Roommate lookup recovered from auth lock abort');
                }
                return [];
            }

            console.error('[SafeBridge] Error:', error);
            return [];
        }

        const rawData = data || [];

        // 🔗 FUZZY MATCH & DEDUPLICATION LOGIC
        const fuzzy = (val: unknown) => String(val || '').toString().toLowerCase().replace(/[^0-9]/g, '').replace(/^0+/, '') || '';
        const targetToken = fuzzy(roomNumber);

        // 🛡️ Include ALL residents (including current user) to show full occupancy
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const residents = rawData.map((res: any) => ({
            ...res,
            is_me: res.customer_id === currentCustomerId
        }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = residents.filter((res: any) => {
            const s = (res.status || '').toLowerCase().replace(/_/g, '-');
            const isActive = ['checked-in', 'active', 'paid', 'approved', 'accepted', 'confirmed', 'pending', 'requested', 'checked_in'].includes(s);
            if (!isActive) return false;

            // Match by Room UUID or Fuzzy Room Number
            const isDirectMatch = roomId && roomId !== 'generic' && roomId !== 'Assigned' && res.room_id === roomId;
            const isNumberMatch = targetToken && fuzzy(res.room_number) === targetToken;

            return isDirectMatch || isNumberMatch;
        });

        // 👨‍👩‍👧‍👦 DEDUPLICATION
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uniqueRoommates: any[] = [];
        const seenIdentities = new Set<string>();
        for (const r of results) {
            const identity = r.customer_id || r.customer_phone || r.customer_name;
            if (identity && !seenIdentities.has(identity)) {
                uniqueRoommates.push(r);
                seenIdentities.add(identity);
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return uniqueRoommates.sort((a: any, b: any) => {
            const order: Record<string, number> = { 'checked-in': 0, 'active': 0, 'paid': 1, 'approved': 2, 'confirmed': 2, 'pending': 3 };
            const sA = (a.status || '').toLowerCase().replace(/_/g, '-');
            const sB = (b.status || '').toLowerCase().replace(/_/g, '-');
            return (order[sA] ?? 5) - (order[sB] ?? 5);
        });
    },

    // 🔄 Real-time subscription to roommates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToRoommates: (roomId: string, currentCustomerId: string, callback: (roommates: any[]) => void, propertyId?: string, roomNumber?: string): (() => void) => {
        bookingService.getRoommates(roomId, currentCustomerId, propertyId, roomNumber).then(callback);

        // Always listen to the entire property to catch roommates who might be linked loosely
        // (e.g. they have the property_id and room_number but not a valid room_id UUID yet)
        const filter = propertyId ? `property_id=eq.${propertyId}` : (roomId ? `room_id=eq.${roomId}` : undefined);
        if (!filter) return () => { };

        const channel = supabase.channel(`roommates-${propertyId || roomId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'bookings', filter: filter
        }, async () => {
            const data = await bookingService.getRoommates(roomId, currentCustomerId, propertyId, roomNumber);
            callback(data);
        }).subscribe();

        return () => { supabase.removeChannel(channel); };
    }
};
