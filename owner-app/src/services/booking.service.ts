import { supabase } from './supabase-config';
import type { Booking, BookingWithDetails } from '../types/booking.types';
import { invokeProtectedEdgeFunction } from './protected-edge.service';
import { deferRealtimeSubscription } from './realtime-subscription';
import { notificationDispatchService } from './notification-dispatch.service';
import { propertyService } from './property.service';

type RpcErrorLike = {
    code?: string;
    message?: string;
};

type RpcMutationResponse = {
    success?: boolean;
    error?: string;
    code?: string;
};

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

const OWNER_BOOKINGS_PAGE_SIZE = 100;
const OWNER_SETTLEMENTS_PAGE_SIZE = 50;
const OWNER_BOOKING_SELECT_RICH = 'id, property_id, room_id, customer_id, owner_id, customer_name, customer_phone, customer_email, start_date, end_date, monthly_rent, payment_status, payment_type, advance_paid, amount_paid, amount_due, commission_amount, room_gst, room_gst_rate, platform_fee, platform_gst, platform_gst_rate, total_amount, cgst_amount, sgst_amount, igst_amount, tcs_amount, gst_breakdown, place_of_supply_type, currency, created_at, status, stay_status, room_number, properties(title), rooms(room_number, images), customers(name, phone, email)';
const OWNER_BOOKING_SELECT_LEGACY = 'id, property_id, room_id, customer_id, owner_id, customer_name, customer_phone, customer_email, start_date, end_date, monthly_rent, payment_status, payment_type, advance_paid, amount_paid, amount_due, commission_amount, created_at, status, stay_status, room_number, properties(title), rooms(room_number, images), customers(name, phone, email)';
const OWNER_SETTLEMENT_SELECT = 'id, owner_id, payment_type, payout_status, week_start_date, week_end_date, total_amount, platform_fee, net_payable, status, provider_reference, provider_transfer_id, processed_at, created_at';
const OWNER_SETTLEMENT_SELECT_LEGACY = 'id, owner_id, week_start_date, week_end_date, total_amount, platform_fee, net_payable, status, provider_reference, provider_transfer_id, processed_at, created_at';
const OWNER_BOOKING_PAYMENT_SELECT = 'id, booking_id, amount, payment_date, created_at, payment_type, status, payment_status, provider_order_id, provider_payment_id';
let realtimeChannelSequence = 0;
// Default to the legacy-safe query so older hosted schemas do not emit a
// guaranteed first-load 400 before the fallback logic can run.
let ownerBookingRichSelectAvailable: boolean | null = false;
let ownerSettlementRichSelectAvailable: boolean | null = null;

type OwnerFinanceSummary = {
    totalNetPayout: number;
    payoutInFlight: number;
    totalRefundAmount: number;
    refundsInFlight: number;
};

export type OwnerBookingPaymentRecord = {
    id: string;
    booking_id: string;
    amount: number;
    payment_date?: string;
    created_at: string;
    payment_type?: string;
    status?: string;
    payment_status?: string;
    provider_order_id?: string;
    provider_payment_id?: string;
};

const isRpcMissingError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === 'PGRST202' ||
        /Could not find the function/i.test(message) ||
        /function .* does not exist/i.test(message);
};

const isRpcFailureResponse = (value: unknown): value is RpcMutationResponse => {
    if (!value || typeof value !== 'object') return false;
    const payload = value as RpcMutationResponse;
    return payload.success === false;
};

const isHostedSchemaCompatibilityError = (error: RpcErrorLike | null | undefined) => {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('check_in_date') ||
        message.includes('booking_status') ||
        message.includes('owner_accept_status') ||
        message.includes('rent_cycle_closed_at') ||
        message.includes('next_due_date') ||
        message.includes('continue_status') ||
        message.includes('portal_access') ||
        message.includes('increment_room_occupancy') ||
        message.includes('decrement_room_occupancy') ||
        message.includes('notification_type_enum') ||
        message.includes('invalid input value for enum notification_type_enum') ||
        message.includes('record "v_booking" has no field')
    );
};

const syncRoomOccupancyFallback = async (roomId: string, direction: 'increment' | 'decrement') => {
    const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('booked_count, capacity, property_id')
        .eq('id', roomId)
        .maybeSingle();

    if (roomError) {
        throw roomError;
    }

    if (!room) {
        return;
    }

    const currentCount = Number(room.booked_count || 0);
    const capacity = Math.max(0, Number(room.capacity || 0));
    const nextCountRaw = direction === 'increment'
        ? currentCount + 1
        : Math.max(0, currentCount - 1);
    const nextCount = capacity > 0
        ? Math.min(nextCountRaw, capacity)
        : nextCountRaw;

    const { error: updateError } = await supabase
        .from('rooms')
        .update({
            booked_count: nextCount,
            is_available: capacity > 0 ? nextCount < capacity : true,
        })
        .eq('id', roomId);

    if (updateError) {
        throw updateError;
    }

    if (room.property_id) {
        await propertyService.syncPropertyVacancies(String(room.property_id));
    }
};

const isDevelopmentEnvironment = () =>
    typeof window !== 'undefined'
        ? ['localhost', '127.0.0.1'].includes(window.location.hostname)
        : process.env.NODE_ENV !== 'production';

const normalizeBookingMutationError = (input: unknown): Error => {
    const raw = String(
        (typeof input === 'object' && input !== null && 'error' in input
            ? (input as RpcMutationResponse).error
            : input) || ''
    ).trim();

    if (/CONFLICTOR|STAY_CONFLICT/i.test(raw)) {
        return new Error('Customer is already checked into another property. They must vacate before this action can continue.');
    }
    if (/ADVANCE_NOT_HELD/i.test(raw)) {
        return new Error('Advance payment is not verified yet. Wait for payment confirmation before approving this booking.');
    }
    if (/ADVANCE_PAYMENT_NOT_FOUND/i.test(raw)) {
        return new Error('Advance payment record not found for this booking.');
    }
    if (/BOOKING_NOT_FOUND/i.test(raw)) {
        return new Error('Booking not found.');
    }
    if (/FORBIDDEN|NOT_AUTHORIZED/i.test(raw)) {
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

const normalizeSettlementStatus = (settlement: Record<string, unknown>) => {
    const candidates = [
        String(settlement['payout_status'] || ''),
        String(settlement['status'] || ''),
        String(settlement['settlement_status'] || ''),
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

// Supabase's query builder type here is noisy; using a small local alias keeps
// the schema-compat fallback readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OwnerBookingsQueryBuilder = any;

const applyOwnerBookingsScope = (
    query: OwnerBookingsQueryBuilder,
    ownerId: string,
    options?: {
        status?: string;
        pendingOnly?: boolean;
    }
) => {
    let scoped = query.eq('owner_id', ownerId);

    if (options?.status) {
        scoped = scoped.eq('status', options.status);
    }

    if (options?.pendingOnly) {
        scoped = scoped.or('status.eq.pending,status.eq.requested,status.eq.payment_pending');
    }

    return scoped
        .order('created_at', { ascending: false })
        .range(0, OWNER_BOOKINGS_PAGE_SIZE - 1);
};

const executeOwnerBookingsQuery = async (
    ownerId: string,
    options?: {
        status?: string;
        pendingOnly?: boolean;
    }
) => {
    let data: Booking[] | null = null;
    let error: { code?: string; message?: string } | null = null;

    if (ownerBookingRichSelectAvailable !== false) {
        const result = await applyOwnerBookingsScope(
            supabase.from('bookings').select(OWNER_BOOKING_SELECT_RICH),
            ownerId,
            options,
        );
        data = (result.data as unknown as Booking[] | null) ?? null;
        error = result.error;

        if (!error) {
            ownerBookingRichSelectAvailable = true;
            return { data, error: null };
        }

        if (!isMissingOwnerBookingCompatibilityColumnError(error)) {
            return { data, error };
        }

        ownerBookingRichSelectAvailable = false;
    }

    const fallback = await applyOwnerBookingsScope(
        supabase.from('bookings').select(OWNER_BOOKING_SELECT_LEGACY),
        ownerId,
        options,
    );
    data = (fallback.data as unknown as Booking[] | null) ?? null;
    error = fallback.error;

    return { data, error };
};

const fetchOwnerBookings = async (ownerId: string) => {
    const { data, error } = await executeOwnerBookingsQuery(ownerId);
    if (error) throw error;
    return (data || []).map((booking) => bookingService.mapToBooking(booking));
};

const fetchOwnerBookingPayments = async (ownerId: string): Promise<OwnerBookingPaymentRecord[]> => {
    const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id')
        .eq('owner_id', ownerId)
        .range(0, OWNER_BOOKINGS_PAGE_SIZE - 1);

    if (bookingsError) throw bookingsError;
    if (!bookings?.length) return [];

    const bookingIds = bookings
        .map((booking) => String(booking.id || '').trim())
        .filter(Boolean);

    if (!bookingIds.length) return [];

    const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select(OWNER_BOOKING_PAYMENT_SELECT)
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false });

    if (paymentsError) throw paymentsError;

    return (payments || []) as OwnerBookingPaymentRecord[];
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

const createRealtimeChannelName = (prefix: string, scope: string) => {
    realtimeChannelSequence += 1;
    return `${prefix}-${scope}-${realtimeChannelSequence}`;
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

type RejectBookingResult = {
    refundPrepared: boolean;
    warning?: string;
};

type AcceptBookingResult = {
    payoutTriggered: boolean;
    warning?: string;
};

type AcceptBookingCompatResponse = {
    success?: boolean;
    booking?: {
        id?: string;
        status?: string;
        payment_status?: string;
    };
    compatibility_mode?: boolean;
};

type RejectBookingCompatResponse = {
    success?: boolean;
    booking?: {
        id?: string;
        status?: string;
        payment_status?: string;
        rejection_reason?: string;
    };
    refundPrepared?: boolean;
    compatibility_mode?: boolean;
};

const isMissingOwnerBookingCompatibilityColumnError = (error: { code?: string; message?: string } | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && /column .*?(check_in_date|room_gst|room_gst_rate|platform_fee|platform_gst|platform_gst_rate|total_amount|cgst_amount|sgst_amount|igst_amount|tcs_amount|gst_breakdown|place_of_supply_type|currency)/i.test(message);
};

const isMissingOwnerSettlementCompatibilityColumnError = (error: { code?: string; message?: string } | null | undefined) => {
    const message = String(error?.message || '');
    return error?.code === '42703' && /column .*?(payment_type|payout_status)/i.test(message);
};

type SettlementTriggerResponse = {
    success?: boolean;
    message?: string;
    settlement?: {
        id?: string;
        status?: string;
        payout_status?: string | null;
        provider_reference?: string | null;
        provider_transfer_id?: string | null;
    };
};

const hasPaidAdvanceSignal = (
    booking: {
        payment_status?: string | null;
        advance_paid?: number | null;
        amount_paid?: number | null;
    } | null | undefined
) => {
    const paymentStatus = String(booking?.payment_status || '').trim().toLowerCase();
    if (['paid', 'completed', 'success', 'authorized', 'verified'].includes(paymentStatus)) {
        return true;
    }

    return Number(booking?.advance_paid || 0) > 0 || Number(booking?.amount_paid || 0) > 0;
};

const isOwnerVisiblePendingRequest = (booking: Booking) => {
    const normalizedStatus = String(booking.status || '').trim().toLowerCase().replace(/_/g, '-');
    const normalizedPaymentStatus = String(booking.paymentStatus || '').trim().toLowerCase();
    const hasVacateRequest =
        normalizedStatus === 'vacate-requested' ||
        String(booking.stayStatus || '').trim().toLowerCase().replace(/_/g, '-') === 'vacate-requested' ||
        (normalizedStatus === 'checked-in' && Boolean(booking.vacateDate));

    if (hasVacateRequest) {
        return true;
    }

    if (!['requested', 'pending', 'payment-pending', 'paid'].includes(normalizedStatus)) {
        return false;
    }

    return ['paid', 'completed', 'success', 'authorized', 'verified'].includes(normalizedPaymentStatus);
};

const triggerSettlementPayoutForAcceptedBooking = async (bookingId: string, accessToken?: string) => {
    const recoverExistingSettlement = async (): Promise<SettlementTriggerResponse | null> => {
        const { data, error } = await supabase
            .from('settlements')
            .select('id, status, provider_reference, provider_transfer_id')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        const normalizedStatus = String(data.status || '').trim().toUpperCase();
        const hasProviderSignal = Boolean(
            String(data.provider_transfer_id || '').trim() ||
            String(data.provider_reference || '').trim()
        );

        if (
            hasProviderSignal ||
            ['PENDING', 'PROCESSING', 'COMPLETED', 'SUCCESS'].includes(normalizedStatus)
        ) {
            return {
                success: true,
                message: 'Recovered settlement state from the database.',
                settlement: data,
            };
        }

        return null;
    };

    try {
        return await invokeProtectedEdgeFunction<SettlementTriggerResponse>(
            'cashfree-settlement',
            { bookingId },
            'Advance payout could not be started automatically',
            accessToken ? { accessToken, minValidityMs: 0 } : undefined
        );
    } catch (error) {
        const recoveredSettlement = await recoverExistingSettlement();
        if (recoveredSettlement) {
            return recoveredSettlement;
        }

        console.warn('[BookingService] Settlement payout trigger failed without a recoverable settlement row:', error);
        throw error instanceof Error ? error : new Error(String(error));
    }
};

const updateClosedBookingRentStateFallback = async (bookingId: string) => {
    const vacateDate = new Date().toISOString().split('T')[0];
    const closedAt = new Date().toISOString();
    const extendedPayload = {
        status: 'checked-out',
        stay_status: 'vacated',
        vacate_date: vacateDate,
        next_payment_date: null,
        next_due_date: null,
        rent_payment_status: 'not_due',
        rent_cycle_closed_at: closedAt,
    };

    const { error: extendedError } = await supabase
        .from('bookings')
        .update(extendedPayload)
        .eq('id', bookingId);

    if (!extendedError) {
        return;
    }

    if (!isHostedSchemaCompatibilityError(extendedError)) {
        throw extendedError;
    }

    const { error: legacyError } = await supabase
        .from('bookings')
        .update({
            status: 'checked-out',
            stay_status: 'vacated',
            vacate_date: vacateDate,
            next_payment_date: null
        })
        .eq('id', bookingId);

    if (legacyError) {
        throw legacyError;
    }
};

const fetchOwnerSettlements = async (ownerId: string) => {
    let data: Record<string, unknown>[] | null = null;
    let error: { code?: string; message?: string } | null = null;

    if (ownerSettlementRichSelectAvailable !== false) {
        const result = await supabase
            .from('settlements')
            .select(OWNER_SETTLEMENT_SELECT)
            .eq('owner_id', ownerId)
            .order('week_start_date', { ascending: false })
            .range(0, OWNER_SETTLEMENTS_PAGE_SIZE - 1);

        data = (result.data as unknown as Record<string, unknown>[] | null) ?? null;
        error = result.error;

        if (!error) {
            ownerSettlementRichSelectAvailable = true;
            return { data, error: null };
        }

        if (!isMissingOwnerSettlementCompatibilityColumnError(error)) {
            return { data, error };
        }

        ownerSettlementRichSelectAvailable = false;
    }

    const fallback = await supabase
        .from('settlements')
        .select(OWNER_SETTLEMENT_SELECT_LEGACY)
        .eq('owner_id', ownerId)
        .order('week_start_date', { ascending: false })
        .range(0, OWNER_SETTLEMENTS_PAGE_SIZE - 1);

    data = (fallback.data as unknown as Record<string, unknown>[] | null) ?? null;
    error = fallback.error;

    return { data, error };
};

export const bookingService = {
    ensureAuthSession: async () => {
        // Ensure the client has an active session loaded (helps after storageState restore)
        const { data } = await supabase.auth.getSession();
        if (data?.session) return data.session;
        const { data: refreshed, error } = await supabase.auth.refreshSession();
        if (error) return null;
        return refreshed?.session || null;
    },
    updateBookingStatusSafe: async (
        bookingId: string,
        update: Record<string, unknown>,
        ownerId?: string
    ) => {
        const performUpdate = async () => {
            let query = supabase.from('bookings').update(update).eq('id', bookingId);
            if (ownerId) {
                query = query.eq('owner_id', ownerId);
            }
            return query.select('id, status, payment_status').maybeSingle();
        };

        const initialResult = await performUpdate();
        if (initialResult.error) throw initialResult.error;
        let data = initialResult.data;

        if (!data) {
            // No row updated (likely missing auth). Retry once after session refresh.
            await bookingService.ensureAuthSession();
            const retry = await performUpdate();
            if (retry.error) throw retry.error;
            if (!retry.data) {
                throw new Error('Booking update not permitted. Please sign in again.');
            }
            data = retry.data;
        }

        return data;
    },
    getOwnerBookingsByStatus: async (ownerId: string, status: string) => {
        const { data, error } = await executeOwnerBookingsQuery(ownerId, { status });
        if (error) throw error;
        return data;
    },
    getOwnerBookings: async (ownerId: string) => {
        return fetchOwnerBookings(ownerId);
    },
    updateBookingStatus: async (bookingId: string, status: string) => {
        await bookingService.updateBookingStatusSafe(bookingId, { status });
    },
    subscribeToPendingBookings: (ownerId: string, callback: (bookings: Booking[]) => void) => {
        const fetch = async (attempt = 0) => {
            const { data, error } = await executeOwnerBookingsQuery(ownerId, { pendingOnly: true });

            if (error) {
                if (attempt < 10) {
                    setTimeout(() => fetch(attempt + 1), 800);
                    return;
                }
                callback([]);
                return;
            }

            callback(
                (data || [])
                    .map(bookingService.mapToBooking)
                    .filter(isOwnerVisiblePendingRequest)
            );
        };
        const scheduledFetch = createScheduledFetcher(() => fetch());
        scheduledFetch.flush();
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(createRealtimeChannelName('pending-bookings', ownerId)).on('postgres_changes', {
                event: '*', schema: 'public', table: 'bookings', filter: `owner_id=eq.${ownerId}`
            }, () => {
                scheduledFetch.schedule();
            }).subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    scheduledFetch.flush();
                }
            });

            return () => {
                supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },

    subscribeToOwnerBookings: (ownerId: string, callback: (bookings: Booking[]) => void) => {
        const fetch = async (attempt = 0) => {
            try {
                callback(await fetchOwnerBookings(ownerId));
            } catch {
                if (attempt < 10) {
                    setTimeout(() => fetch(attempt + 1), 800);
                    return;
                }
                callback([]);
            }
        };
        const scheduledFetch = createScheduledFetcher(() => fetch());
        scheduledFetch.flush();
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(createRealtimeChannelName('all-bookings', ownerId)).on('postgres_changes', {
                event: '*', schema: 'public', table: 'bookings', filter: `owner_id=eq.${ownerId}`
            }, () => {
                scheduledFetch.schedule();
            }).subscribe();

            return () => {
                void supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },
    getOwnerBookingPayments: async (ownerId: string) => {
        return fetchOwnerBookingPayments(ownerId);
    },
    subscribeToOwnerBookingPayments: (ownerId: string, callback: (payments: OwnerBookingPaymentRecord[]) => void) => {
        const ownerBookingIds = new Set<string>();

        const fetch = async (attempt = 0) => {
            try {
                const { data: bookings, error: bookingsError } = await supabase
                    .from('bookings')
                    .select('id')
                    .eq('owner_id', ownerId)
                    .range(0, OWNER_BOOKINGS_PAGE_SIZE - 1);

                if (bookingsError) throw bookingsError;

                ownerBookingIds.clear();
                (bookings || []).forEach((booking) => {
                    const bookingId = String(booking.id || '').trim();
                    if (bookingId) {
                        ownerBookingIds.add(bookingId);
                    }
                });

                callback(await fetchOwnerBookingPayments(ownerId));
            } catch {
                if (attempt < 10) {
                    setTimeout(() => fetch(attempt + 1), 800);
                    return;
                }
                callback([]);
            }
        };

        const scheduledFetch = createScheduledFetcher(() => fetch());
        scheduledFetch.flush();

        const channel = supabase.channel(createRealtimeChannelName('owner-booking-payments', ownerId))
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'bookings', filter: `owner_id=eq.${ownerId}`
            }, () => scheduledFetch.schedule())
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'payments'
            }, (payload) => {
                const bookingId = String(
                    (payload.new as Record<string, unknown> | null | undefined)?.booking_id ||
                    (payload.old as Record<string, unknown> | null | undefined)?.booking_id ||
                    ''
                ).trim();

                if (!bookingId || ownerBookingIds.size === 0 || ownerBookingIds.has(bookingId)) {
                    scheduledFetch.schedule();
                }
            })
            .subscribe();

        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },

    subscribeToOwnerBookingsCurrentMonth: (ownerId: string, callback: (revenue: number) => void) => {
        const ownerBookingIds = new Set<string>();
        const fetch = async () => {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const { data: bookings, error: bookingsError } = await supabase
                .from('bookings')
                .select('id')
                .eq('owner_id', ownerId);

            if (bookingsError || !bookings?.length) {
                callback(0);
                return;
            }

            const bookingIds = bookings.map((booking) => booking.id);
            ownerBookingIds.clear();
            bookingIds.forEach((bookingId) => ownerBookingIds.add(bookingId));
            const { data: payments, error: paymentsError } = await supabase
                .from('payments')
                .select('amount, status, payment_status')
                .in('booking_id', bookingIds)
                .gte('created_at', startOfMonth.toISOString());

            if (paymentsError || !payments) {
                callback(0);
                return;
            }

            const total = payments.reduce((acc, payment) => {
                const normalized = String(payment.payment_status || payment.status || '').toLowerCase();
                if (!['paid', 'completed', 'success', 'authorized'].includes(normalized)) {
                    return acc;
                }
                return acc + (Number(payment.amount) || 0);
            }, 0);

            callback(total);
        };
        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();
        const channel = supabase.channel(createRealtimeChannelName('revenue', ownerId))
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'bookings', filter: `owner_id=eq.${ownerId}`
            }, () => scheduledFetch.schedule())
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'payments'
            }, (payload) => {
                const bookingId = String(
                    (payload.new as Record<string, unknown> | null | undefined)?.booking_id ||
                    (payload.old as Record<string, unknown> | null | undefined)?.booking_id ||
                    ''
                ).trim();
                if (bookingId && ownerBookingIds.has(bookingId)) {
                    scheduledFetch.schedule();
                }
            })
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'settlements', filter: `owner_id=eq.${ownerId}`
            }, () => scheduledFetch.schedule())
            .subscribe();
        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },

    acceptAllBookings: async (bookingIds: string[]): Promise<boolean> => {
        const results = await Promise.allSettled(
            bookingIds.map((bookingId) => bookingService.acceptBooking(bookingId))
        );
        return results.every((result) => result.status === 'fulfilled');
    },

    acceptBooking: async (bookingId: string): Promise<AcceptBookingResult> => {
        // 1. Get the booking to find customer_id
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('customer_id, property_id, owner_id, payment_status, advance_paid, amount_paid')
            .eq('id', bookingId)
            .single();

        if (fetchError) throw fetchError;

        if (booking) {
            // 2. Check if customer has active stay elsewhere
            const { data: activeStay } = await supabase.from('bookings')
                .select('id, properties(title)')
                .eq('customer_id', booking.customer_id)
                .is('vacate_date', null)
                .in('status', ['checked-in', 'checked_in', 'ACTIVE', 'ONGOING'])
                .neq('property_id', booking.property_id) // stay is at ANOTHER property
                .limit(1);

            if (activeStay && activeStay.length > 0) {
                const stay = activeStay[0];
                const properties = stay.properties as unknown as { title: string } | null;
                const propTitle = properties?.title || 'another PG';
                throw new Error(`CONFLICTOR: Customer is already checked into ${propTitle}. They must vacate before you can accept this booking.`);
            }
        }

        const session = await bookingService.ensureAuthSession();

        await invokeProtectedEdgeFunction<AcceptBookingCompatResponse>(
            'owner-accept-booking-compat',
            { bookingId },
            'Booking acceptance failed'
        );

        let payoutTriggered = false;
        let warning: string | undefined;
        const hasPaidAdvance = hasPaidAdvanceSignal(booking);

        if (hasPaidAdvance) {
            try {
                const payoutResponse = await triggerSettlementPayoutForAcceptedBooking(
                    bookingId,
                    session?.access_token || undefined
                );
                payoutTriggered = Boolean(
                    payoutResponse?.success ||
                    payoutResponse?.settlement?.provider_transfer_id ||
                    payoutResponse?.settlement?.status
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown payout error.';
                warning = `Booking accepted, but advance payout could not be started automatically: ${message}`;
            }
        }


        return { payoutTriggered, warning };
    },

    rejectBooking: async (bookingId: string, reason: string): Promise<RejectBookingResult> => {
        // Updated to use the correct column name 'rejection_reason' defined in schema.sql
        await bookingService.ensureAuthSession();

        const compatResponse = await invokeProtectedEdgeFunction<RejectBookingCompatResponse>(
            'owner-reject-booking-compat',
            { bookingId, reason },
            'Booking rejection failed'
        );

        return {
            refundPrepared: Boolean(compatResponse?.refundPrepared ?? compatResponse?.success)
        };
    },

    checkInBooking: async (bookingId: string, _propertyId: string, roomId: string) => {
        // 1. Get the booking to find customer_id
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('customer_id, property_id, room_number')
            .eq('id', bookingId)
            .single();

        if (fetchError) throw fetchError;

        if (booking) {
            // 2. Check if customer has active stay elsewhere
            const { data: activeStay } = await supabase.from('bookings')
                .select('id, properties(title)')
                .eq('customer_id', booking.customer_id)
                .is('vacate_date', null)
                .in('status', ['checked-in', 'checked_in', 'ACTIVE', 'ONGOING'])
                .neq('property_id', booking.property_id)
                .limit(1);

            if (activeStay && activeStay.length > 0) {
                const stay = activeStay[0];
                const properties = stay.properties as unknown as { title: string } | null;
                const propTitle = properties?.title || 'another PG';
                throw new Error(`STAY_CONFLICT: Customer is already checked into ${propTitle}. Please ask them to vacate from there first.`);
            }
        }

        await bookingService.ensureAuthSession();

        let rpcResult: { usedRpc: boolean; data: unknown | null };
        try {
            rpcResult = await runBookingRpc<unknown>('owner_check_in_booking', {
                p_booking_id: bookingId,
                p_room_id: roomId || null
            });
        } catch (error) {
            if (isHostedSchemaCompatibilityError(error as RpcErrorLike)) {
                rpcResult = { usedRpc: false, data: null };
            } else {
                throw error;
            }
        }
        if (rpcResult.usedRpc) return;

        // Update booking status
        const { error: updateError } = await supabase.from('bookings').update({
            status: 'checked-in',
            stay_status: 'ongoing'
        }).eq('id', bookingId);

        if (updateError) {
            if (isDevelopmentEnvironment()) console.error('[BookingService] Check-in update failed:', updateError);
            throw updateError;
        }

        // 3. Create Notification for customer
        const roomLabel = String(booking.room_number || '').trim()
            ? `Room ${String(booking.room_number).trim()}`
            : 'booking';
        await notificationDispatchService.send({
            userId: String(booking.customer_id || '').trim(),
            title: 'Check-in confirmed',
            body: `Check-in confirmed for ${roomLabel}.`,
            type: 'booking',
            route: '/bookings',
            bookingId,
            audience: 'customer',
            eventParts: ['owner-check-in-confirmed', bookingId, booking.customer_id],
            data: { status: 'checked-in', event_name: 'owner_check_in_booking' },
        }).catch((notificationError) => {
            console.warn('[OwnerBookingService] Failed to dispatch check-in notification:', notificationError);
        });

        // Update room occupancy
        const { error: rpcError } = await supabase.rpc('increment_room_occupancy', { room_id: roomId });
        if (rpcError) {
            if (isHostedSchemaCompatibilityError(rpcError)) {
                await syncRoomOccupancyFallback(roomId, 'increment');
            } else {
                throw rpcError;
            }
        }
    },

    checkOutBooking: async (bookingId: string, _propertyId: string, roomId: string) => {
        await bookingService.ensureAuthSession();

        const rpcResult = await runBookingRpc<unknown>('owner_check_out_booking', {
            p_booking_id: bookingId,
            p_room_id: roomId || null
        });
        if (rpcResult.usedRpc) return;

        await updateClosedBookingRentStateFallback(bookingId);
        const { error: rpcError } = await supabase.rpc('decrement_room_occupancy', { room_id: roomId });
        if (rpcError) {
            if (isHostedSchemaCompatibilityError(rpcError)) {
                await syncRoomOccupancyFallback(roomId, 'decrement');
            } else {
                throw rpcError;
            }
        }
    },

    approveVacate: async (bookingId: string, roomId: string) => {
        await bookingService.ensureAuthSession();

        let rpcResult: { usedRpc: boolean; data: unknown | null };
        try {
            rpcResult = await runBookingRpc<unknown>('owner_approve_vacate', {
                p_booking_id: bookingId,
                p_room_id: roomId || null
            });
        } catch (error) {
            if (isHostedSchemaCompatibilityError(error as RpcErrorLike)) {
                rpcResult = { usedRpc: false, data: null };
            } else {
                throw error;
            }
        }
        if (rpcResult.usedRpc) return;

        // 1. Update booking status to checked-out and clear stale rent-cycle fields
        await updateClosedBookingRentStateFallback(bookingId);

        // 2. Decrement occupancy
        const { error: rpcError } = await supabase.rpc('decrement_room_occupancy', { room_id: roomId });
        if (rpcError) {
            if (isHostedSchemaCompatibilityError(rpcError)) {
                await syncRoomOccupancyFallback(roomId, 'decrement');
            } else {
                throw rpcError;
            }
        }

        // 3. Notify Customer
        const { data: booking } = await supabase.from('bookings').select('customer_id, room_number').eq('id', bookingId).single();
        if (booking) {
            const roomLabel = String(booking.room_number || '').trim()
                ? `Room ${String(booking.room_number).trim()}`
                : 'booking';
            await notificationDispatchService.send({
                userId: String(booking.customer_id || '').trim(),
                title: 'Vacate approved',
                body: `Vacate approved for ${roomLabel}.`,
                type: 'booking',
                route: '/bookings',
                bookingId,
                audience: 'customer',
                eventParts: ['owner-vacate-approved', bookingId, booking.customer_id],
                data: { status: 'checked-out', event_name: 'owner_approve_vacate' },
            }).catch((notificationError) => {
                console.warn('[OwnerBookingService] Failed to dispatch vacate approval notification:', notificationError);
            });
        }
    },

    getBookingWithDetails: async (bookingId: string): Promise<BookingWithDetails> => {
        const { data, error } = await supabase
            .from('bookings')
            .select('*, customers(*), properties(*), owners(*), rooms(*)')
            .eq('id', bookingId)
            .single();
        if (error) throw error;

        const { data: payments, error: paymentsError } = await supabase
            .from('payments')
            .select('id, amount, payment_date, created_at, payment_type, status, provider_order_id, provider_payment_id, payment_status')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false });
        if (paymentsError) throw paymentsError;

        // Map to BookingWithDetails
        return {
            ...bookingService.mapToBooking(data),
            customerDetails: {
                displayName: data.customers?.display_name,
                phoneNumber: data.customers?.phone_number,
                photoUrl: data.customers?.photo_url
            },
            propertyDetails: data.properties,
            ownerDetails: data.owners,
            payments: payments || []
        } as BookingWithDetails;
    },

    getBookingPayments: async (bookingId: string) => {
        const { data, error } = await supabase
            .from('payments')
            .select('id, amount, payment_date, created_at, payment_type, status, provider_order_id, provider_payment_id, payment_status')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    subscribeToBookingPayments: (bookingId: string, callback: (payments: Record<string, unknown>[]) => void) => {
        const fetch = async () => {
            const data = await bookingService.getBookingPayments(bookingId);
            callback(data);
        };
        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();
        const channel = supabase.channel(createRealtimeChannelName('booking-payments', bookingId)).on('postgres_changes', {
            event: '*', schema: 'public', table: 'payments', filter: `booking_id=eq.${bookingId}`
        }, () => scheduledFetch.schedule()).subscribe();
        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },

    sendPropertyNotification: async (propertyId: string, title: string, message: string) => {
        const { data: bookings } = await supabase.from('bookings').select('customer_id').eq('property_id', propertyId).in('status', ['approved', 'confirmed', 'checked-in']);
        if (bookings && bookings.length > 0) {
            const broadcastBatchId = Date.now();
            await Promise.all(
                bookings
                    .filter((booking) => String(booking.customer_id || '').trim().length > 0)
                    .map((booking) => notificationDispatchService.send({
                        userId: String(booking.customer_id || '').trim(),
                        title,
                        body: message,
                        type: 'property',
                        route: '/bookings',
                        audience: 'customer',
                        eventParts: ['owner-property-broadcast', propertyId, broadcastBatchId, booking.customer_id, title, message],
                        data: {
                            property_id: propertyId,
                            sender_name: 'Property Manager',
                            pg_name: 'Property Update',
                            event_name: 'owner_property_broadcast',
                        },
                    }).catch((notificationError) => {
                        console.warn('[OwnerBookingService] Failed to dispatch property notification:', notificationError);
                    }))
            );
            return bookings.length;
        }
        return 0;
    },
    getSettlements: async (ownerId: string) => {
        const { data, error } = await fetchOwnerSettlements(ownerId);
        if (error) throw error;
        return (data || []).map((settlement) => ({
            ...settlement,
            payment_type: (settlement['payment_type'] as string) || 'advance',
            status: normalizeSettlementStatus(settlement as unknown as Record<string, unknown>),
        }));
    },
    getFinanceSummary: async (ownerId: string): Promise<OwnerFinanceSummary> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_owner_finance_summary', {
            p_owner_id: ownerId,
        });
        if (error) throw error;

        const row = Array.isArray(data) ? data[0] : data;
        return {
            totalNetPayout: Number(row?.total_net_payout || 0),
            payoutInFlight: Number(row?.payout_in_flight || 0),
            totalRefundAmount: Number(row?.total_refund_amount || 0),
            refundsInFlight: Number(row?.refunds_in_flight || 0),
        };
    },
    subscribeToSettlements: (ownerId: string, callback: (settlements: unknown[]) => void) => {
        const fetch = async (attempt = 0) => {
            try {
                callback(await bookingService.getSettlements(ownerId));
            } catch {
                if (attempt < 10) {
                    setTimeout(() => fetch(attempt + 1), 800);
                    return;
                }
                callback([]);
            }
        };
        const scheduledFetch = createScheduledFetcher(() => fetch());
        scheduledFetch.flush();
        const channel = supabase.channel(createRealtimeChannelName('settlements', ownerId)).on('postgres_changes', {
            event: '*', schema: 'public', table: 'settlements', filter: `owner_id=eq.${ownerId}`
        }, () => scheduledFetch.schedule()).subscribe();
        return () => {
            scheduledFetch.cancel();
            supabase.removeChannel(channel);
        };
    },
    mapToBooking: (b: unknown): Booking => {
        const data = b as Record<string, unknown>;
        const customers = data['customers'] as Record<string, unknown> | undefined;
        const properties = data['properties'] as Record<string, unknown> | undefined;
        const rooms = data['rooms'] as Record<string, unknown> | undefined;

        return {
            bookingId: data['id'] as string,
            propertyId: data['property_id'] as string,
            roomId: data['room_id'] as string,
            customerId: data['customer_id'] as string,
            customerName: (customers?.['name'] as string) || (data['customer_name'] as string) || 'Guest',
            customerPhone: (customers?.['phone'] as string) || (data['customer_phone'] as string),
            customerEmail: (customers?.['email'] as string) || (data['customer_email'] as string),
            ownerId: data['owner_id'] as string,
            propertyTitle: (properties?.['title'] as string) || (data['property_title'] as string) || 'Unknown Property',
            roomNumber: (rooms?.['room_number'] as string) || (data['room_number'] as string) || 'N/A',
            startDate: data['start_date'] as string,
            endDate: data['end_date'] as string,
            checkInDate: (data['check_in_date'] as string) || null,
            durationMonths: Number(data['duration_in_months']) || calculateDurationMonths(
                data['start_date'] as string,
                data['end_date'] as string,
                (data['check_in_date'] as string) || null
            ),
            monthlyRent: Number(data['monthly_rent']) || 0,
            paymentStatus: (data['payment_status'] as unknown as Booking['paymentStatus']) || 'pending',
            paymentType: (data['payment_type'] as unknown as Booking['paymentType']) || 'monthly',
            amountPaid: Number(data['amount_paid']) || Number(data['advance_paid']) || 0,
            advancePaid: Number(data['advance_paid']) || 0,
            amountDue: Number(data['amount_due']) || 0,
            commissionAmount: Number(data['commission_amount']) || 0,
            roomGst: Number(data['room_gst']) || 0,
            roomGstRate: Number(data['room_gst_rate']) || 0,
            platformFee: Number(data['platform_fee']) || 0,
            platformGst: Number(data['platform_gst']) || 0,
            platformGstRate: Number(data['platform_gst_rate']) || 0,
            totalAmount: Number(data['total_amount']) || 0,
            cgstAmount: Number(data['cgst_amount']) || 0,
            sgstAmount: Number(data['sgst_amount']) || 0,
            igstAmount: Number(data['igst_amount']) || 0,
            tcsAmount: Number(data['tcs_amount']) || 0,
            gstBreakdown: (data['gst_breakdown'] as Record<string, unknown>) || undefined,
            placeOfSupplyType: (data['place_of_supply_type'] as Booking['placeOfSupplyType']) || 'unknown',
            currency: (data['currency'] as string) || 'INR',
            createdAt: data['created_at'] as string,
            status: (data['status'] as unknown as Booking['status']) || 'pending',
            stayStatus: (data['stay_status'] as Booking['stayStatus']) || undefined,
            vacateDate: (data['vacate_date'] as string) || null,
            notifications: (data['notifications'] as unknown as Booking['notifications']) || []
        } as Booking;
    }
};
