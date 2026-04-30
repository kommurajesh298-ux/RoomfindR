import { supabase } from './supabase-config';
import { deferRealtimeSubscription } from './realtime-subscription';

export interface ChartData {
    name: string;
    bookings: number;
}

export interface OccupancyTrend {
    name: string;
    value: number;
}

export interface DashboardReportMetrics {
    totalProperties: number;
    totalRooms: number;
    occupiedSlots: number;
    activeVacancies: number;
    currentOccupancyRate: number;
    averageOccupancyRate: number;
    monthlyRevenue: number;
    previousMonthRevenue: number;
    revenueChangeRate: number;
    newBookingsThisMonth: number;
    occupancyTrend: OccupancyTrend[];
}

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

type PropertyRow = {
    id: string;
    total_rooms?: number | null;
    rooms_available?: number | null;
};

type RoomRow = {
    id: string;
    property_id: string;
    capacity?: number | null;
    booked_count?: number | null;
};

type BookingRow = {
    id: string;
    room_id?: string | null;
    status?: string | null;
    stay_status?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    vacate_date?: string | null;
    created_at?: string | null;
};

type PaymentRow = {
    booking_id: string;
    amount?: number | null;
    payment_date?: string | null;
    created_at?: string | null;
    status?: string | null;
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FAILED_OR_INACTIVE_BOOKING_STATUSES = new Set([
    'requested',
    'pending',
    'payment_pending',
    'rejected',
    'cancelled',
    'cancelled_by_customer',
    'refunded',
]);
const SUCCESSFUL_PAYMENT_STATUSES = new Set(['paid', 'completed', 'success', 'authorized', 'verified']);

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

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

const isSuccessfulPayment = (payment: PaymentRow) =>
    SUCCESSFUL_PAYMENT_STATUSES.has(normalize(payment.status));

const parseDateOnly = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const parsed = raw.includes('T')
        ? new Date(raw)
        : new Date(`${raw}T00:00:00Z`);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const endOfMonth = (date: Date) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

const addMonths = (date: Date, months: number) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

const getMonthWindow = (offset: number) => {
    const base = startOfMonth(new Date());
    const monthStart = addMonths(base, offset);
    const monthEnd = endOfMonth(monthStart);
    return {
        start: monthStart,
        end: monthEnd,
        label: MONTH_LABELS[monthStart.getUTCMonth()],
    };
};

const daysInRangeInclusive = (start: Date, end: Date) =>
    Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);

const clampPercentage = (value: number) =>
    Math.max(0, Math.min(100, Math.round(value)));

const bookingBlocksOccupancy = (booking: BookingRow) => {
    const status = normalize(booking.status);
    const stayStatus = normalize(booking.stay_status);

    if (stayStatus && ['ongoing', 'vacate_requested', 'vacated'].includes(stayStatus)) {
        return true;
    }

    if (!status) {
        return false;
    }

    return !FAILED_OR_INACTIVE_BOOKING_STATUSES.has(status);
};

const getBookingWindow = (booking: BookingRow) => {
    if (!bookingBlocksOccupancy(booking)) {
        return null;
    }

    const start = parseDateOnly(booking.start_date);
    const end = parseDateOnly(booking.vacate_date || booking.end_date || booking.start_date);

    if (!start || !end) {
        return null;
    }

    return {
        start,
        end: end < start ? start : end,
    };
};

const summarizeCurrentCapacity = (properties: PropertyRow[], rooms: RoomRow[]) => {
    if (rooms.length > 0) {
        return rooms.reduce((summary, room) => {
            const capacity = Math.max(0, Number(room.capacity || 0));
            const occupied = Math.max(0, Math.min(capacity, Number(room.booked_count || 0)));

            summary.totalRooms += capacity;
            summary.occupiedSlots += occupied;
            return summary;
        }, { totalRooms: 0, occupiedSlots: 0 });
    }

    return properties.reduce((summary, property) => {
        const totalRooms = Math.max(0, Number(property.total_rooms || 0));
        const vacancies = Math.max(0, Number(property.rooms_available || 0));
        const occupied = Math.max(0, totalRooms - vacancies);

        summary.totalRooms += totalRooms;
        summary.occupiedSlots += occupied;
        return summary;
    }, { totalRooms: 0, occupiedSlots: 0 });
};

const buildOccupancyTrend = (bookings: BookingRow[], totalRooms: number): OccupancyTrend[] =>
    Array.from({ length: 6 }, (_, index) => {
        const monthOffset = index - 5;
        const month = getMonthWindow(monthOffset);
        const daysInMonth = daysInRangeInclusive(month.start, month.end);

        const occupiedSlotDays = bookings.reduce((sum, booking) => {
            const window = getBookingWindow(booking);
            if (!window) {
                return sum;
            }

            const overlapStart = window.start > month.start ? window.start : month.start;
            const overlapEnd = window.end < month.end ? window.end : month.end;

            if (overlapEnd < overlapStart) {
                return sum;
            }

            return sum + daysInRangeInclusive(overlapStart, overlapEnd);
        }, 0);

        const percentage = totalRooms > 0
            ? clampPercentage((occupiedSlotDays / (totalRooms * daysInMonth)) * 100)
            : 0;

        return {
            name: month.label,
            value: percentage,
        };
    });

const buildBookingsChart = (bookings: BookingRow[]): ChartData[] => {
    const currentMonthStart = startOfMonth(new Date());
    const weeklyMap = new Map<string, number>([
        ['Week 1', 0],
        ['Week 2', 0],
        ['Week 3', 0],
        ['Week 4', 0],
    ]);

    bookings.forEach((booking) => {
        const createdAt = parseDateOnly(booking.created_at);
        if (!createdAt || createdAt < currentMonthStart) {
            return;
        }

        const weekIndex = Math.min(3, Math.floor((createdAt.getUTCDate() - 1) / 7));
        const label = `Week ${weekIndex + 1}`;
        weeklyMap.set(label, (weeklyMap.get(label) || 0) + 1);
    });

    return Array.from(weeklyMap.entries()).map(([name, bookingsCount]) => ({
        name,
        bookings: bookingsCount,
    }));
};

const getPaymentInstant = (payment: PaymentRow) =>
    parseDateOnly(payment.payment_date || payment.created_at);

const sumPaymentsForMonthOffset = (payments: PaymentRow[], monthOffset: number) => {
    const month = getMonthWindow(monthOffset);

    return payments.reduce((total, payment) => {
        if (!isSuccessfulPayment(payment)) {
            return total;
        }

        const paidAt = getPaymentInstant(payment);
        if (!paidAt || paidAt < month.start || paidAt > month.end) {
            return total;
        }

        return total + (Number(payment.amount) || 0);
    }, 0);
};

const calculateRevenueChangeRate = (currentMonthRevenue: number, previousMonthRevenue: number) => {
    if (previousMonthRevenue <= 0) {
        return currentMonthRevenue > 0 ? 100 : 0;
    }

    return Math.round(((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 1000) / 10;
};

const fetchDashboardData = async (ownerId: string) => {
    const [propertiesResult, bookingsResult] = await Promise.all([
        supabase
            .from('properties')
            .select('id, total_rooms, rooms_available')
            .eq('owner_id', ownerId),
        supabase
            .from('bookings')
            .select('id, room_id, status, stay_status, start_date, end_date, vacate_date, created_at')
            .eq('owner_id', ownerId),
    ]);

    const properties = (propertiesResult.data || []) as PropertyRow[];
    const bookings = (bookingsResult.data || []) as BookingRow[];

    const propertyIds = properties
        .map((property) => String(property.id || '').trim())
        .filter(Boolean);

    const bookingIds = bookings
        .map((booking) => String(booking.id || '').trim())
        .filter(Boolean);

    const [roomsResult, paymentsResult] = await Promise.all([
        propertyIds.length > 0
            ? supabase
                .from('rooms')
                .select('id, property_id, capacity, booked_count')
                .in('property_id', propertyIds)
            : Promise.resolve({ data: [], error: null }),
        bookingIds.length > 0
            ? supabase
                .from('payments')
                .select('booking_id, amount, payment_date, created_at, status')
                .in('booking_id', bookingIds)
            : Promise.resolve({ data: [], error: null }),
    ]);

    const rooms = (roomsResult.data || []) as RoomRow[];
    const payments = (paymentsResult.data || []) as PaymentRow[];
    const currentCapacity = summarizeCurrentCapacity(properties, rooms);
    const occupancyTrend = buildOccupancyTrend(bookings, currentCapacity.totalRooms);
    const monthlyRevenue = sumPaymentsForMonthOffset(payments, 0);
    const previousMonthRevenue = sumPaymentsForMonthOffset(payments, -1);
    const currentMonth = getMonthWindow(0);
    const newBookingsThisMonth = bookings.filter((booking) => {
        const createdAt = parseDateOnly(booking.created_at);
        return Boolean(createdAt && createdAt >= currentMonth.start && createdAt <= currentMonth.end);
    }).length;

    return {
        propertyIds,
        bookingIds,
        bookingsChart: buildBookingsChart(bookings),
        dashboardReport: {
            totalProperties: properties.length,
            totalRooms: currentCapacity.totalRooms,
            occupiedSlots: currentCapacity.occupiedSlots,
            activeVacancies: Math.max(0, currentCapacity.totalRooms - currentCapacity.occupiedSlots),
            currentOccupancyRate: currentCapacity.totalRooms > 0
                ? clampPercentage((currentCapacity.occupiedSlots / currentCapacity.totalRooms) * 100)
                : 0,
            averageOccupancyRate: occupancyTrend.length > 0
                ? clampPercentage(occupancyTrend.reduce((sum, month) => sum + month.value, 0) / occupancyTrend.length)
                : 0,
            monthlyRevenue,
            previousMonthRevenue,
            revenueChangeRate: calculateRevenueChangeRate(monthlyRevenue, previousMonthRevenue),
            newBookingsThisMonth,
            occupancyTrend,
        } satisfies DashboardReportMetrics,
    };
};

export const analyticsService = {
    subscribeToBookingsChart: (ownerId: string, callback: (data: ChartData[]) => void) => {
        const fetch = async () => {
            const { bookingsChart } = await fetchDashboardData(ownerId);
            callback(bookingsChart);
        };

        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();

        const ownerBookingIds = new Set<string>();

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(`analytics-bookings-${ownerId}`)
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
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        scheduledFetch.flush();
                    }
                });

            return () => {
                void supabase.removeChannel(channel);
            };
        });

        const syncOwnerBookingIds = async () => {
            const { data } = await supabase
                .from('bookings')
                .select('id')
                .eq('owner_id', ownerId);

            ownerBookingIds.clear();
            (data || []).forEach((booking) => {
                const bookingId = String(booking.id || '').trim();
                if (bookingId) {
                    ownerBookingIds.add(bookingId);
                }
            });
        };

        void syncOwnerBookingIds();

        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },

    subscribeToOccupancyTrend: (ownerId: string, callback: (data: OccupancyTrend[]) => void) => {
        const fetch = async () => {
            const { dashboardReport } = await fetchDashboardData(ownerId);
            callback(dashboardReport.occupancyTrend);
        };

        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();

        const ownerPropertyIds = new Set<string>();

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(`occupancy-${ownerId}`)
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'properties', filter: `owner_id=eq.${ownerId}`
                }, () => scheduledFetch.schedule())
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'bookings', filter: `owner_id=eq.${ownerId}`
                }, () => scheduledFetch.schedule())
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'rooms'
                }, (payload) => {
                    const propertyId = String(
                        (payload.new as Record<string, unknown> | null | undefined)?.property_id ||
                        (payload.old as Record<string, unknown> | null | undefined)?.property_id ||
                        ''
                    ).trim();

                    if (!propertyId || ownerPropertyIds.size === 0 || ownerPropertyIds.has(propertyId)) {
                        scheduledFetch.schedule();
                    }
                })
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        scheduledFetch.flush();
                    }
                });

            return () => {
                void supabase.removeChannel(channel);
            };
        });

        const syncOwnerPropertyIds = async () => {
            const { data } = await supabase
                .from('properties')
                .select('id')
                .eq('owner_id', ownerId);

            ownerPropertyIds.clear();
            (data || []).forEach((property) => {
                const propertyId = String(property.id || '').trim();
                if (propertyId) {
                    ownerPropertyIds.add(propertyId);
                }
            });
        };

        void syncOwnerPropertyIds();

        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },

    subscribeToDashboardReport: (ownerId: string, callback: (data: DashboardReportMetrics) => void) => {
        const ownerBookingIds = new Set<string>();
        const ownerPropertyIds = new Set<string>();

        const fetch = async () => {
            const snapshot = await fetchDashboardData(ownerId);

            ownerBookingIds.clear();
            snapshot.bookingIds.forEach((bookingId) => ownerBookingIds.add(bookingId));
            ownerPropertyIds.clear();
            snapshot.propertyIds.forEach((propertyId) => ownerPropertyIds.add(propertyId));

            callback(snapshot.dashboardReport);
        };

        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(`dashboard-report-${ownerId}`)
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'properties', filter: `owner_id=eq.${ownerId}`
                }, () => scheduledFetch.schedule())
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
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'rooms'
                }, (payload) => {
                    const propertyId = String(
                        (payload.new as Record<string, unknown> | null | undefined)?.property_id ||
                        (payload.old as Record<string, unknown> | null | undefined)?.property_id ||
                        ''
                    ).trim();

                    if (!propertyId || ownerPropertyIds.size === 0 || ownerPropertyIds.has(propertyId)) {
                        scheduledFetch.schedule();
                    }
                })
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        scheduledFetch.flush();
                    }
                });

            return () => {
                void supabase.removeChannel(channel);
            };
        });

        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    }
};
