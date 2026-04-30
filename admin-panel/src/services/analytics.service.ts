import { supabase } from './supabase-config';
import { format } from 'date-fns';
import type { OverviewStats, DailyMetric, ActivityLog } from '../types/analytics-service.types';
import { deferRealtimeSubscription } from './realtime-subscription';

const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

const SUCCESSFUL_PAYMENT_STATUSES = new Set(['completed', 'success', 'authorized', 'paid']);
const ACTIVE_BOOKING_STATUSES = new Set(['approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing']);
const REFUND_VISIBLE_STATUSES = new Set(['pending', 'processing', 'onhold', 'success', 'processed']);
let adminOverviewRpcAvailable = false;

const isSuccessfulPayment = (payment: { status?: unknown; payment_status?: unknown }) =>
    SUCCESSFUL_PAYMENT_STATUSES.has(normalize(payment.payment_status)) ||
    SUCCESSFUL_PAYMENT_STATUSES.has(normalize(payment.status));

const isRentPayment = (paymentType: unknown) => ['monthly', 'rent', 'monthly_rent'].includes(normalize(paymentType));

const isVisibleRefund = (refund: { status?: unknown; refund_status?: unknown }) =>
    REFUND_VISIBLE_STATUSES.has(normalize(refund.refund_status)) ||
    REFUND_VISIBLE_STATUSES.has(normalize(refund.status));

const mapOverviewStatsRow = (row: Record<string, unknown>): OverviewStats => ({
    totalUsers: Number(row.total_users || 0),
    totalOwners: Number(row.total_owners || 0),
    totalProperties: Number(row.total_properties || 0),
    totalBookings: Number(row.total_bookings || 0),
    activeBookings: Number(row.active_bookings || 0),
    revenueEstimate: toNumber(row.revenue_estimate),
    commissionEstimate: toNumber(row.commission_estimate),
    advanceAmount: toNumber(row.advance_amount),
    rentAmount: toNumber(row.rent_amount),
    refundAmount: toNumber(row.refund_amount),
});

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

const createScheduledFetcher = (fetcher: () => Promise<void>, waitMs = 300): ScheduledFetcher => {
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

export const AnalyticsService = {
    getOverviewStats: async () => {
        if (adminOverviewRpcAvailable) {
            try {
                const { data, error } = await supabase.rpc('get_admin_overview_stats');
                if (!error && data) {
                    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
                    if (row) {
                        return mapOverviewStatsRow(row);
                    }
                }
            } catch {
                adminOverviewRpcAvailable = false;
            }
        }

        const [{ count: u }, { count: o }, { count: p }, { data: bookings }, { data: payments }, { data: refunds }] = await Promise.all([
            supabase.from('accounts').select('id', { count: 'exact', head: true }),
            supabase.from('owners').select('id', { count: 'exact', head: true }),
            supabase.from('properties').select('id', { count: 'exact', head: true }),
            supabase.from('bookings').select('id, status, commission_amount'),
            supabase.from('payments').select('amount, payment_type, status'),
            supabase.from('refunds').select('refund_amount, status')
        ]);

        const successfulPayments = (payments || []).filter(isSuccessfulPayment);
        const advanceAmount = successfulPayments
            .filter((payment) => !isRentPayment(payment.payment_type))
            .reduce((total, payment) => total + toNumber(payment.amount), 0);
        const rentAmount = successfulPayments
            .filter((payment) => isRentPayment(payment.payment_type))
            .reduce((total, payment) => total + toNumber(payment.amount), 0);
        const refundAmount = (refunds || [])
            .filter(isVisibleRefund)
            .reduce((total, refund) => total + toNumber(refund.refund_amount), 0);
        const bookingCommission = (bookings || []).reduce(
            (total, booking) => total + toNumber(booking.commission_amount),
            0
        );
        const totalBookings = bookings?.length || 0;
        const activeBookings = (bookings || []).filter((booking) =>
            ACTIVE_BOOKING_STATUSES.has(normalize(booking.status))
        ).length;

        return {
            totalUsers: u || 0, totalOwners: o || 0, totalProperties: p || 0,
            totalBookings,
            activeBookings,
            revenueEstimate: advanceAmount + rentAmount,
            commissionEstimate: bookingCommission,
            advanceAmount,
            rentAmount,
            refundAmount
        };
    },
    subscribeToOverviewStats: (callback: (stats: OverviewStats) => void) => {
        const scheduledFetch = createScheduledFetcher(async () => {
            callback(await AnalyticsService.getOverviewStats());
        });
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            scheduledFetch.flush();
            const channel = supabase.channel('admin-stats')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => scheduledFetch.schedule())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => scheduledFetch.schedule())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => scheduledFetch.schedule())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => scheduledFetch.schedule())
                .subscribe();
            return () => {
                supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },
    subscribeToRecentActivity: (limitCount: number, callback: (activity: ActivityLog[]) => void) => {
        const fetchActivity = async () => {
            // First try audit_logs
            const { data: logs } = await supabase
                .from('audit_logs')
                .select('id, action, created_at, details, user_id')
                .order('created_at', { ascending: false })
                .limit(limitCount);

            if (logs && logs.length > 0) {
                const userIds = [...new Set(logs.map((log) => log.user_id).filter(Boolean))];
                const { data: accounts } = userIds.length > 0
                    ? await supabase.from('accounts').select('id, email').in('id', userIds)
                    : { data: [] };

                const accountMap = new Map((accounts || []).map((account) => [account.id, account.email]));

                callback(logs.map(l => ({
                    id: l.id,
                    action: l.action,
                    created_at: l.created_at,
                    details: l.details || {},
                    adminEmail: accountMap.get(l.user_id) || 'System'
                })));
                return;
            }

            // Fallback: Latest bookings and payments
            const [{ data: bookings }, { data: payments }] = await Promise.all([
                supabase.from('bookings').select('id, customer_name, status, created_at').order('created_at', { ascending: false }).limit(limitCount),
                supabase.from('payments').select('id, amount, status, created_at').order('created_at', { ascending: false }).limit(limitCount)
            ]);

            const combined: ActivityLog[] = [
                ...(bookings?.map(b => ({
                    id: b.id,
                    action: `New Booking: ${b.status}`,
                    created_at: b.created_at,
                    details: { customer: b.customer_name },
                    adminEmail: 'System'
                })) || []),
                ...(payments?.map(p => ({
                    id: p.id,
                    action: `Payment: ${p.status}`,
                    created_at: p.created_at,
                    details: { amount: p.amount },
                    adminEmail: 'System'
                })) || [])
            ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limitCount);

            callback(combined);
        };

        const scheduledFetch = createScheduledFetcher(fetchActivity);
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            scheduledFetch.flush();
            const channel = supabase.channel('recent-activity')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => scheduledFetch.schedule())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => scheduledFetch.schedule())
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => scheduledFetch.schedule())
                .subscribe();
            return () => {
                supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },
    getDailyActiveUsers: async (start: Date, end: Date) => {
        const { data } = await supabase.from('accounts').select('created_at').gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
        const map = new Map<string, number>();
        data?.forEach(x => { const d = format(new Date(x.created_at), 'yyyy-MM-dd'); map.set(d, (map.get(d) || 0) + 1); });
        const res = []; const cur = new Date(start); while (cur <= end) { const d = format(cur, 'yyyy-MM-dd'); res.push({ date: d, count: map.get(d) || 0 }); cur.setDate(cur.getDate() + 1); }
        return res;
    },
    subscribeToDailyUsers: (start: Date, end: Date, callback: (data: DailyMetric[]) => void) => {
        const scheduledFetch = createScheduledFetcher(async () => {
            callback(await AnalyticsService.getDailyActiveUsers(start, end));
        });
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            scheduledFetch.flush();
            const channel = supabase.channel('daily-users').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'accounts' }, () => scheduledFetch.schedule()).subscribe();
            return () => {
                supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },
    subscribeToDailyBookings: (start: Date, end: Date, callback: (data: DailyMetric[]) => void) => {
        const fetch = async () => {
            const { data } = await supabase.from('bookings').select('created_at').gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
            const map = new Map<string, number>();
            data?.forEach(x => { const d = format(new Date(x.created_at), 'yyyy-MM-dd'); map.set(d, (map.get(d) || 0) + 1); });
            const res = []; const cur = new Date(start); while (cur <= end) { const d = format(cur, 'yyyy-MM-dd'); res.push({ date: d, count: map.get(d) || 0 }); cur.setDate(cur.getDate() + 1); }
            callback(res);
        };
        const scheduledFetch = createScheduledFetcher(fetch);
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            scheduledFetch.flush();
            const channel = supabase.channel('daily-bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => scheduledFetch.schedule()).subscribe();
            return () => {
                supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },
    subscribeToRevenueTrend: (start: Date, end: Date, callback: (data: Array<{ date: string; amount: number }>) => void) => {
        const fetch = async () => {
            const { data: pData } = await supabase
                .from('payments')
                .select('amount, created_at, status')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString());

            const map = new Map<string, number>();
            pData?.filter(isSuccessfulPayment).forEach(x => {
                const d = format(new Date(x.created_at), 'yyyy-MM-dd');
                map.set(d, (map.get(d) || 0) + toNumber(x.amount));
            });

            const res = []; const cur = new Date(start); while (cur <= end) { const d = format(cur, 'yyyy-MM-dd'); res.push({ date: d, amount: map.get(d) || 0 }); cur.setDate(cur.getDate() + 1); }
            callback(res);
        };
        const scheduledFetch = createScheduledFetcher(fetch);
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            scheduledFetch.flush();
            const channel = supabase.channel('revenue-trend')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => scheduledFetch.schedule())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => scheduledFetch.schedule())
                .subscribe();
            return () => {
                supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },
    subscribeToOccupancyRate: (callback: (rate: number) => void) => {
        const fetch = async () => {
            const [{ data: props }, { count: occupiedCount }] = await Promise.all([
                supabase.from('properties').select('total_rooms'),
                supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'checked-in')
            ]);

            if (props && props.length > 0) {
                const totalRooms = props.reduce((a, x) => a + (x.total_rooms || 1), 0);
                const occupied = occupiedCount || 0;
                callback(Math.max(0, Math.min(100, (occupied / totalRooms) * 100)));
            } else {
                callback(0);
            }
        };
        const scheduledFetch = createScheduledFetcher(fetch);
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            scheduledFetch.flush();
            const channel = supabase.channel('occupancy-rate')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => scheduledFetch.schedule())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => scheduledFetch.schedule())
                .subscribe();
            return () => {
                supabase.removeChannel(channel);
            };
        });
        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },


    getRevenueByDay: async (start: Date, end: Date) => {
        const { data: pData } = await supabase
            .from('payments')
            .select('amount, created_at, status')
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString());

        const map = new Map<string, number>();
        pData?.filter(isSuccessfulPayment).forEach(x => {
            const d = format(new Date(x.created_at), 'yyyy-MM-dd');
            map.set(d, (map.get(d) || 0) + toNumber(x.amount));
        });

        const res = []; const cur = new Date(start); while (cur <= end) { const d = format(cur, 'yyyy-MM-dd'); res.push({ date: d, revenue: map.get(d) || 0 }); cur.setDate(cur.getDate() + 1); }
        return res;
    },

    getPropertyMetrics: async () => {
        const { data: properties } = await supabase.from('properties').select('id, title, total_rooms, status, created_at');
        const { data: bookings } = await supabase.from('bookings').select('property_id, status');

        const metrics = properties?.map(prop => {
            const propBookings = bookings?.filter(b => b.property_id === prop.id) || [];
            const activeCount = propBookings.filter(b => b.status === 'checked-in').length;
            const total = prop.total_rooms || 1;
            return {
                propertyId: prop.id,
                propertyName: prop.title,
                totalRooms: total,
                availableRooms: Math.max(0, total - activeCount),
                occupancyRate: Math.round(Number((activeCount / total) * 100)),
                totalBookings: propBookings.length,
                activeBookings: activeCount
            };
        });

        return metrics || [];
    },

    getUserGrowthMetrics: async () => {
        const { data: users } = await supabase.from('accounts').select('created_at').order('created_at', { ascending: false });
        const map = new Map<string, number>();
        users?.forEach(x => { const d = format(new Date(x.created_at), 'yyyy-MM-dd'); map.set(d, (map.get(d) || 0) + 1); });
        return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
    },

    getBookingMetrics: async () => {
        const { data: bookings } = await supabase.from('bookings').select('status, created_at');
        return {
            total: bookings?.length || 0,
            pending: bookings?.filter(b => b.status === 'pending').length || 0,
            confirmed: bookings?.filter(b => b.status === 'confirmed').length || 0,
            cancelled: bookings?.filter(b => b.status === 'cancelled').length || 0,
            checkedIn: bookings?.filter(b => b.status === 'checked-in').length || 0,
        };
    },

    getBookingsPerDay: async () => {
        const { data: bookings } = await supabase.from('bookings').select('created_at').order('created_at', { ascending: false }).limit(30);
        const map = new Map<string, number>();
        bookings?.forEach(x => { const d = format(new Date(x.created_at), 'yyyy-MM-dd'); map.set(d, (map.get(d) || 0) + 1); });
        return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
    },

    getRevenueMetrics: async () => {
        const { data: payments } = await supabase
            .from('payments')
            .select('amount, status');
        const successfulPayments = (payments || []).filter(isSuccessfulPayment);
        const total = successfulPayments.reduce((acc, payment) => acc + toNumber(payment.amount), 0);
        return { total, count: successfulPayments.length };
    },

    exportToCSV: async (type: 'bookings' | 'users' | 'properties' | 'revenue' | 'financial', startDate?: Date, endDate?: Date): Promise<boolean> => {
        let data: Array<(string | number)[]> = [];
        let headers: string[] = [];
        const reportType = type === 'financial' ? 'revenue' : type;

        // Generating report

        try {
            if (reportType === 'bookings') {
                const query = supabase.from('bookings').select('id, status, amount_paid, created_at, customers(display_name, email), properties(title)');
                if (startDate) query.gte('created_at', startDate.toISOString());
                if (endDate) query.lte('created_at', endDate.toISOString());

                const { data: bookings, error } = await query;
                if (error) throw error;

                headers = ['ID', 'Customer', 'Property', 'Status', 'Amount', 'Created At'];
                data = bookings?.map(b => [
                    b.id,
                    (b.customers as unknown as { display_name: string })?.display_name || 'N/A',
                    (b.properties as unknown as { title: string })?.title || 'N/A',
                    b.status,
                    b.amount_paid || 0,
                    format(new Date(b.created_at), 'yyyy-MM-dd HH:mm:ss')
                ]) || [];
            } else if (reportType === 'users') {
                const query = supabase.from('accounts').select('id, email, role, created_at');
                if (startDate) query.gte('created_at', startDate.toISOString());
                if (endDate) query.lte('created_at', endDate.toISOString());

                const { data: users, error } = await query;
                if (error) throw error;

                headers = ['ID', 'Email', 'Role', 'Created At'];
                data = users?.map(u => [u.id, u.email, u.role, format(new Date(u.created_at), 'yyyy-MM-dd HH:mm:ss')]) || [];
            } else if (reportType === 'properties') {
                const query = supabase.from('properties').select('id, title, city, monthly_rent, status, created_at');
                if (startDate) query.gte('created_at', startDate.toISOString());
                if (endDate) query.lte('created_at', endDate.toISOString());

                const { data: props, error } = await query;
                if (error) throw error;

                headers = ['ID', 'Title', 'City', 'Monthly Rent', 'Status', 'Created At'];
                data = props?.map(p => [p.id, p.title, p.city, p.monthly_rent, p.status, format(new Date(p.created_at), 'yyyy-MM-dd HH:mm:ss')]) || [];
            } else if (reportType === 'revenue') {
                const pQuery = supabase.from('payments').select('id, amount, status, created_at').eq('status', 'completed');
                const bQuery = supabase.from('bookings').select('id, amount_paid, commission_amount, status, created_at');

                if (startDate) {
                    pQuery.gte('created_at', startDate.toISOString());
                    bQuery.gte('created_at', startDate.toISOString());
                }
                if (endDate) {
                    pQuery.lte('created_at', endDate.toISOString());
                    bQuery.lte('created_at', endDate.toISOString());
                }

                const [{ data: payments, error: pError }, { data: bookings, error: bError }] = await Promise.all([pQuery, bQuery]);
                if (pError) throw pError;
                if (bError) throw bError;

                headers = ['ID', 'Type', 'Full Amount', 'Commission', 'Status', 'Created At'];
                const pRows = payments?.map(p => [p.id, 'Payment', p.amount, 0, p.status, format(new Date(p.created_at), 'yyyy-MM-dd HH:mm:ss')]) || [];
                const bRows = bookings?.map(b => [b.id, 'Booking Advance', b.amount_paid || 0, b.commission_amount || 0, b.status, format(new Date(b.created_at), 'yyyy-MM-dd HH:mm:ss')]) || [];
                data = [...pRows, ...bRows];
            }

            // Report data fetched

            if (data.length === 0) return false;

            // Generate CSV
            const csvContent = [
                headers.join(','),
                ...data.map(row => row.map((cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            ].join('\n');

            // Trigger download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${reportType}_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return true;
        } catch (err) {
            console.error('CSV Export Error:', err);
            return false;
        }
    }
};
