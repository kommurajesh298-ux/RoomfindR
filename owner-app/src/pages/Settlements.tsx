import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
    IoAlertCircleOutline,
    IoCalendarOutline,
    IoCheckmarkCircleOutline,
    IoCloseCircleOutline,
    IoPeopleOutline,
    IoRefreshOutline,
    IoSyncOutline,
    IoTimeOutline,
    IoWalletOutline,
} from 'react-icons/io5';

import Modal from '../components/common/Modal';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';
import {
    bookingService,
    type OwnerBookingPaymentRecord,
} from '../services/booking.service';
import { refundService, type OwnerRefundHistoryItem } from '../services/refund.service';
import type { Booking } from '../types/booking.types';

interface Settlement {
    id: string;
    payment_type?: string;
    payout_status?: string;
    week_start_date: string;
    week_end_date: string;
    total_amount: number;
    platform_fee: number;
    net_payable: number;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    provider_transfer_id?: string;
    provider_reference?: string;
    processed_at?: string;
    created_at: string;
}

type HistoryView = 'rent' | 'settlement' | 'refund';
type DateFilterKey = 'all' | 'today' | 'week' | 'month' | 'year';

type RentResidentRow = {
    bookingId: string;
    propertyTitle: string;
    roomNumber: string;
    customerName: string;
    monthlyRent: number;
    stayLabel: string;
    paidThisMonth: boolean;
    lastPaidAt?: string;
    transactionRef?: string;
    activityDate?: string;
};

type RentRoomGroup = {
    key: string;
    propertyTitle: string;
    roomNumber: string;
    totalRent: number;
    paidMembers: number;
    totalMembers: number;
    members: RentResidentRow[];
};

type LiveFinanceSummary = {
    settlementTotal: number;
    settlementCount: number;
    advanceTotal: number;
    advanceCount: number;
    rentTotal: number;
    rentCount: number;
    refundTotal: number;
    refundCount: number;
    pendingSettlementCount: number;
    pendingSettlementAmount: number;
    activeRoomCount: number;
    activeResidentCount: number;
    paidResidentCount: number;
};

const DATE_FILTER_OPTIONS: Array<{ value: DateFilterKey; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
];

const formatCurrency = (value: number | string | null | undefined) =>
    `INR ${Number(value || 0).toLocaleString('en-IN')}`;

const formatDateTime = (value?: string) => {
    if (!value) return 'Pending update';

    try {
        return format(new Date(value), 'dd MMM yyyy, HH:mm');
    } catch {
        return 'Pending update';
    }
};

const parseKnownDate = (value?: string) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getDateFilterStart = (filter: DateFilterKey) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (filter === 'all') return null;
    if (filter === 'today') return startOfToday;
    if (filter === 'week') {
        const start = new Date(startOfToday);
        start.setDate(start.getDate() - 6);
        return start;
    }
    if (filter === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
    return new Date(now.getFullYear(), 0, 1);
};

const matchesDateFilter = (value: string | undefined, filter: DateFilterKey) => {
    if (filter === 'all') return true;

    const parsed = parseKnownDate(value);
    if (!parsed) return false;

    const start = getDateFilterStart(filter);
    return start ? parsed.getTime() >= start.getTime() : true;
};

const normalizeSettlementKind = (paymentType?: string) => {
    const normalized = String(paymentType || '').trim().toLowerCase();
    return ['monthly', 'rent'].includes(normalized) ? 'rent' : 'advance';
};

const normalizePaymentState = (value: unknown) => String(value || '').trim().toLowerCase();

const isVerifiedPayment = (payment: OwnerBookingPaymentRecord) =>
    ['paid', 'completed', 'success', 'authorized'].includes(
        normalizePaymentState(payment.payment_status || payment.status),
    );

const isRentPayment = (payment: OwnerBookingPaymentRecord) =>
    ['monthly', 'rent'].includes(normalizePaymentState(payment.payment_type));

const isActiveResidentBooking = (booking: Booking) => {
    const status = String(booking.status || '').trim().toLowerCase();
    const stayStatus = String(booking.stayStatus || '').trim().toLowerCase();

    if (['checked-out', 'checked_out', 'cancelled', 'rejected', 'refunded', 'completed', 'vacated'].includes(status)) {
        return false;
    }

    if (['vacated'].includes(stayStatus)) {
        return false;
    }

    return ['approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'payment_pending', 'paid'].includes(status)
        || ['ongoing', 'vacate_requested'].includes(stayStatus);
};

const getResidentStayLabel = (booking: Booking) => {
    const status = String(booking.status || '').trim().toLowerCase();
    if (status === 'checked-in' || status === 'checked_in') return 'Checked In';
    if (status === 'approved') return 'Approved';
    if (status === 'accepted') return 'Accepted';
    if (status === 'confirmed') return 'Confirmed';
    if (status === 'payment_pending') return 'Payment Pending';
    return 'Active';
};

const getSettlementStatusBadge = (settlement: Settlement) => {
    const normalized = String(settlement.status || '').toUpperCase();

    if (normalized === 'COMPLETED') {
        return <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-700"><IoCheckmarkCircleOutline size={14} /> Success</span>;
    }

    if (normalized === 'FAILED') {
        return <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-red-700"><IoAlertCircleOutline size={14} /> Failed</span>;
    }

    if (normalized === 'PROCESSING') {
        return <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-700"><IoSyncOutline className="animate-spin" size={14} /> Processing</span>;
    }

    return <span className="inline-flex items-center gap-1 rounded-full border border-yellow-200 bg-yellow-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-yellow-700"><IoTimeOutline size={14} /> Pending</span>;
};

const getRefundStatusBadge = (refund: OwnerRefundHistoryItem) => {
    const normalized = String(refund.status || '').toUpperCase();

    if (normalized === 'SUCCESS') {
        return <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-700"><IoCheckmarkCircleOutline size={14} /> Refunded</span>;
    }

    if (normalized === 'FAILED') {
        return <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-red-700"><IoCloseCircleOutline size={14} /> Failed</span>;
    }

    if (normalized === 'PROCESSING') {
        return <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-orange-700"><IoSyncOutline className="animate-spin" size={14} /> Processing</span>;
    }

    if (normalized === 'ONHOLD') {
        return <span className="inline-flex items-center gap-1 rounded-full border border-yellow-200 bg-yellow-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-yellow-700"><IoTimeOutline size={14} /> On Hold</span>;
    }

    return <span className="inline-flex items-center gap-1 rounded-full border border-yellow-200 bg-yellow-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-yellow-700"><IoTimeOutline size={14} /> Pending</span>;
};

const Settlements: React.FC = () => {
    const { currentUser } = useAuth();
    const [settlements, setSettlements] = useState<Settlement[]>([]);
    const [refunds, setRefunds] = useState<OwnerRefundHistoryItem[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [payments, setPayments] = useState<OwnerBookingPaymentRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeView, setActiveView] = useState<HistoryView | null>(null);
    const [dateFilter, setDateFilter] = useState<DateFilterKey>('all');

    useEffect(() => {
        if (!currentUser) {
            setSettlements([]);
            setRefunds([]);
            setBookings([]);
            setPayments([]);
            setLoading(false);
            return;
        }

        let active = true;

        const loadAll = async () => {
            try {
                const [settlementRows, refundRows, bookingRows, paymentRows] = await Promise.all([
                    bookingService.getSettlements(currentUser.uid),
                    refundService.getOwnerRefunds(currentUser.uid),
                    bookingService.getOwnerBookings(currentUser.uid),
                    bookingService.getOwnerBookingPayments(currentUser.uid),
                ]);

                if (!active) return;
                setSettlements(settlementRows as Settlement[]);
                setRefunds(refundRows);
                setBookings(bookingRows);
                setPayments(paymentRows);
            } catch (error) {
                console.error('Failed to load finance history:', error);
            } finally {
                if (active) setLoading(false);
            }
        };

        void loadAll();

        const unsubscribeSettlements = bookingService.subscribeToSettlements(currentUser.uid, (nextSettlements) => {
            if (!active) return;
            setSettlements(nextSettlements as Settlement[]);
            setLoading(false);
        });

        const unsubscribeRefunds = refundService.subscribeToOwnerRefunds(currentUser.uid, (nextRefunds) => {
            if (!active) return;
            setRefunds(nextRefunds);
            setLoading(false);
        });

        const unsubscribeBookings = bookingService.subscribeToOwnerBookings(currentUser.uid, (nextBookings) => {
            if (!active) return;
            setBookings(nextBookings);
            setLoading(false);
        });

        const unsubscribePayments = bookingService.subscribeToOwnerBookingPayments(currentUser.uid, (nextPayments) => {
            if (!active) return;
            setPayments(nextPayments);
            setLoading(false);
        });

        return () => {
            active = false;
            unsubscribeSettlements?.();
            unsubscribeRefunds?.();
            unsubscribeBookings?.();
            unsubscribePayments?.();
        };
    }, [currentUser]);

    const paymentsByBooking = useMemo(() => {
        const map = new Map<string, OwnerBookingPaymentRecord[]>();

        payments.forEach((payment) => {
            const bookingId = String(payment.booking_id || '').trim();
            if (!bookingId) return;

            const existing = map.get(bookingId) || [];
            existing.push(payment);
            existing.sort((a, b) => {
                const aTime = new Date(a.payment_date || a.created_at || 0).getTime();
                const bTime = new Date(b.payment_date || b.created_at || 0).getTime();
                return bTime - aTime;
            });
            map.set(bookingId, existing);
        });

        return map;
    }, [payments]);

    const activeRentGroups = useMemo<RentRoomGroup[]>(() => {
        const currentMonthKey = format(new Date(), 'yyyy-MM');
        const activeBookings = bookings.filter(isActiveResidentBooking);
        const grouped = new Map<string, RentRoomGroup>();

        activeBookings.forEach((booking) => {
            const bookingPayments = (paymentsByBooking.get(booking.bookingId) || []).filter(isRentPayment);
            const currentMonthPayment = bookingPayments.find((payment) => {
                const paymentKey = format(new Date(payment.payment_date || payment.created_at), 'yyyy-MM');
                return paymentKey === currentMonthKey && isVerifiedPayment(payment);
            });
            const latestVerifiedPayment = bookingPayments.find(isVerifiedPayment);

            const resident: RentResidentRow = {
                bookingId: booking.bookingId,
                propertyTitle: booking.propertyTitle,
                roomNumber: booking.roomNumber || 'Unassigned',
                customerName: booking.customerName || 'Unknown resident',
                monthlyRent: Number(booking.monthlyRent || 0),
                stayLabel: getResidentStayLabel(booking),
                paidThisMonth: Boolean(currentMonthPayment),
                lastPaidAt: currentMonthPayment?.payment_date || currentMonthPayment?.created_at || latestVerifiedPayment?.payment_date || latestVerifiedPayment?.created_at,
                transactionRef: currentMonthPayment?.provider_payment_id || currentMonthPayment?.provider_order_id || latestVerifiedPayment?.provider_payment_id || latestVerifiedPayment?.provider_order_id,
                activityDate: currentMonthPayment?.payment_date || currentMonthPayment?.created_at || latestVerifiedPayment?.payment_date || latestVerifiedPayment?.created_at || booking.createdAt,
            };

            const groupKey = `${booking.propertyId}-${resident.roomNumber}`;
            const existing = grouped.get(groupKey);

            if (existing) {
                existing.members.push(resident);
                existing.totalRent += resident.monthlyRent;
                existing.totalMembers += 1;
                if (resident.paidThisMonth) existing.paidMembers += 1;
                return;
            }

            grouped.set(groupKey, {
                key: groupKey,
                propertyTitle: resident.propertyTitle,
                roomNumber: resident.roomNumber,
                totalRent: resident.monthlyRent,
                paidMembers: resident.paidThisMonth ? 1 : 0,
                totalMembers: 1,
                members: [resident],
            });
        });

        return Array.from(grouped.values()).sort((a, b) => {
            const propertyCompare = a.propertyTitle.localeCompare(b.propertyTitle);
            if (propertyCompare !== 0) return propertyCompare;
            return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
        });
    }, [bookings, paymentsByBooking]);

    const stats = useMemo<LiveFinanceSummary>(() => {
        const completedSettlements = settlements.filter((settlement) => String(settlement.status || '').toUpperCase() === 'COMPLETED');
        const pendingSettlements = settlements.filter((settlement) => ['PENDING', 'PROCESSING'].includes(String(settlement.status || '').toUpperCase()));
        const completedAdvanceSettlements = completedSettlements.filter((settlement) => normalizeSettlementKind(settlement.payment_type) !== 'rent');
        const completedRentSettlements = completedSettlements.filter((settlement) => normalizeSettlementKind(settlement.payment_type) === 'rent');
        const residentRows = activeRentGroups.flatMap((group) => group.members);
        const paidResidentRows = residentRows.filter((resident) => resident.paidThisMonth);

        return {
            settlementTotal: completedSettlements.reduce((sum, settlement) => sum + Number(settlement.net_payable || 0), 0),
            settlementCount: completedSettlements.length,
            advanceTotal: completedAdvanceSettlements.reduce((sum, settlement) => sum + Number(settlement.net_payable || 0), 0),
            advanceCount: completedAdvanceSettlements.length,
            rentTotal: completedRentSettlements.reduce((sum, settlement) => sum + Number(settlement.net_payable || 0), 0)
                || paidResidentRows.reduce((sum, resident) => sum + Number(resident.monthlyRent || 0), 0),
            rentCount: residentRows.length,
            refundTotal: refunds.reduce((sum, refund) => sum + Number(refund.refundAmount || 0), 0),
            refundCount: refunds.length,
            pendingSettlementCount: pendingSettlements.length,
            pendingSettlementAmount: pendingSettlements.reduce((sum, settlement) => sum + Number(settlement.net_payable || 0), 0),
            activeRoomCount: activeRentGroups.length,
            activeResidentCount: residentRows.length,
            paidResidentCount: paidResidentRows.length,
        };
    }, [activeRentGroups, refunds, settlements]);

    const isEmpty = settlements.length === 0 && refunds.length === 0 && activeRentGroups.length === 0;

    const advanceSettlements = useMemo(
        () => settlements.filter((settlement) => normalizeSettlementKind(settlement.payment_type) !== 'rent'),
        [settlements],
    );

    const activeViewTitle = activeView === 'rent' ? 'Rent Ledger' : activeView === 'settlement' ? 'Advance Ledger' : 'Refund Ledger';

    const filteredRentGroups = useMemo<RentRoomGroup[]>(() => (
        activeRentGroups
            .map((group) => {
                const members = group.members.filter((member) => matchesDateFilter(member.activityDate, dateFilter));
                return {
                    ...group,
                    members,
                    totalMembers: members.length,
                    paidMembers: members.filter((member) => member.paidThisMonth).length,
                    totalRent: members.reduce((sum, member) => sum + Number(member.monthlyRent || 0), 0),
                };
            })
            .filter((group) => group.members.length > 0)
    ), [activeRentGroups, dateFilter]);

    const filteredSettlements = useMemo(
        () => advanceSettlements.filter((item) => matchesDateFilter(item.processed_at || item.created_at, dateFilter)),
        [advanceSettlements, dateFilter],
    );

    const filteredRefunds = useMemo(
        () => refunds.filter((item) => matchesDateFilter(item.processedAt || item.createdAt, dateFilter)),
        [dateFilter, refunds],
    );

    const renderRentView = () => {
        if (filteredRentGroups.length === 0) {
            return (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                    No rent rows found for this date range.
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {filteredRentGroups.map((group) => (
                    <div key={group.key} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <h3 className="rfm-pg-title-single-line text-lg font-black text-gray-900" title={group.propertyTitle}>{group.propertyTitle}</h3>
                                <p className="text-sm font-semibold text-gray-500">Room {group.roomNumber}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[280px]">
                                <div className="rounded-2xl bg-white px-3 py-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Members</p>
                                    <p className="mt-0.5 text-lg font-black text-gray-900">{group.totalMembers}</p>
                                </div>
                                <div className="rounded-2xl bg-white px-3 py-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Paid</p>
                                    <p className="mt-0.5 text-lg font-black text-blue-700">{group.paidMembers}</p>
                                </div>
                                <div className="rounded-2xl bg-white px-3 py-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Rent</p>
                                    <p className="mt-0.5 text-lg font-black text-gray-900">{formatCurrency(group.totalRent)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-[720px] w-full">
                                <thead className="bg-white">
                                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-gray-400">
                                        <th className="px-4 py-3">Member</th>
                                        <th className="px-4 py-3">Stay</th>
                                        <th className="px-4 py-3">Rent</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Last Paid</th>
                                        <th className="px-4 py-3">Txn Ref</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {group.members.map((member) => (
                                        <tr key={member.bookingId} className="border-t border-gray-100 align-top">
                                            <td className="px-4 py-3">
                                                <p className="text-sm font-black text-gray-900">{member.customerName}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                                                    {member.stayLabel}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm font-black text-gray-900">{formatCurrency(member.monthlyRent)}</td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
                                                        member.paidThisMonth
                                                            ? 'border border-blue-200 bg-blue-100 text-blue-700'
                                                            : 'border border-orange-200 bg-orange-100 text-orange-700'
                                                    }`}
                                                >
                                                    {member.paidThisMonth ? <IoCheckmarkCircleOutline size={14} /> : <IoTimeOutline size={14} />}
                                                    {member.paidThisMonth ? 'Paid' : 'Unpaid'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm font-semibold text-gray-600">
                                                {member.lastPaidAt ? formatDateTime(member.lastPaidAt) : 'Pending'}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-semibold text-gray-500">
                                                <span className="break-all">{member.transactionRef || 'Pending'}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderSettlementView = () => {
        if (filteredSettlements.length === 0) {
            return (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                    No advance rows found for this date range.
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {filteredSettlements.map((item) => (
                    <div key={item.id} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-black text-gray-900">
                                        {format(new Date(item.week_start_date), 'dd MMM')} - {format(new Date(item.week_end_date), 'dd MMM yyyy')}
                                    </h3>
                                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                                        Advance
                                    </span>
                                </div>
                                <p className="text-sm font-semibold text-gray-500">Advance payout summary</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[300px]">
                                <div className="rounded-2xl bg-white px-3 py-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Gross</p>
                                    <p className="mt-0.5 text-lg font-black text-gray-900">{formatCurrency(item.total_amount)}</p>
                                </div>
                                <div className="rounded-2xl bg-white px-3 py-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-500">Fee</p>
                                    <p className="mt-0.5 text-lg font-black text-orange-700">- {formatCurrency(item.platform_fee)}</p>
                                </div>
                                <div className="rounded-2xl bg-white px-3 py-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Net</p>
                                    <p className="mt-0.5 text-lg font-black text-blue-700">{formatCurrency(item.net_payable)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-[920px] w-full">
                                <thead className="bg-white">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Advance ID</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Created</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Processed</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Transfer</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-t border-gray-100 align-top">
                                        <td className="px-4 py-3 text-sm font-semibold text-gray-500">
                                            <span className="break-all">{item.id}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {getSettlementStatusBadge(item)}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-bold text-gray-700">{formatDateTime(item.created_at)}</td>
                                        <td className="px-4 py-4 text-sm font-bold text-gray-700">
                                            {String(item.status || '').toUpperCase() === 'COMPLETED' ? formatDateTime(item.processed_at) : String(item.status || '').toUpperCase()}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-bold text-gray-700">
                                            <span className="break-all">{item.provider_reference || item.provider_transfer_id || 'Pending'}</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderRefundView = () => {
        if (filteredRefunds.length === 0) {
            return (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                    No refund rows found for this date range.
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {filteredRefunds.map((refund) => (
                    <div key={refund.id} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-black text-gray-900">{refund.customerName || 'Unknown customer'}</h3>
                                    {getRefundStatusBadge(refund)}
                                </div>
                                <p className="mt-1 text-sm text-gray-500">{refund.propertyTitle || 'Unknown property'}</p>
                            </div>
                        </div>

                        <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-100">
                            <table className="min-w-[620px] w-full">
                                <thead className="bg-gray-50 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">
                                    <tr>
                                        <th className="px-4 py-3">Guest</th>
                                        <th className="px-4 py-3">Property</th>
                                        <th className="px-4 py-3">Amount</th>
                                        <th className="px-4 py-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-t border-gray-100">
                                        <td className="px-4 py-4 text-sm font-black text-gray-900">{refund.customerName || 'Unknown customer'}</td>
                                        <td className="px-4 py-4 text-sm font-semibold text-gray-600">{refund.propertyTitle || 'Unknown property'}</td>
                                        <td className="px-4 py-4 text-sm font-black text-orange-700">{formatCurrency(refund.refundAmount)}</td>
                                        <td className="px-4 py-4 text-sm font-semibold text-gray-600">{String(refund.status || 'pending').toUpperCase()}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-100">
                            <table className="min-w-[920px] w-full">
                                <thead className="bg-gray-50 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">
                                    <tr>
                                        <th className="px-4 py-3">Booking</th>
                                        <th className="px-4 py-3">Payment</th>
                                        <th className="px-4 py-3">Refund Ref</th>
                                        <th className="px-4 py-3">Created</th>
                                        <th className="px-4 py-3">Updated</th>
                                        <th className="px-4 py-3">Reason</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-t border-gray-100">
                                        <td className="px-4 py-4 text-sm font-bold text-gray-700"><span className="break-all">{refund.bookingId}</span></td>
                                        <td className="px-4 py-4 text-sm font-bold text-gray-700"><span className="break-all">{refund.paymentId || 'Pending'}</span></td>
                                        <td className="px-4 py-4 text-sm font-bold text-gray-700"><span className="break-all">{refund.providerRefundId || 'Pending'}</span></td>
                                        <td className="px-4 py-4 text-sm font-bold text-gray-700">{formatDateTime(refund.createdAt)}</td>
                                        <td className="px-4 py-4 text-sm font-bold text-gray-700">{formatDateTime(refund.processedAt)}</td>
                                        <td className="px-4 py-4 text-sm font-bold text-gray-700">{refund.reason || 'Booking rejected'}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-20 md:pb-8">
            <div className="mx-auto max-w-7xl space-y-6 px-4 py-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm md:p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Settlement Total</p>
                        <p className="mt-2 text-2xl font-black text-gray-900 md:mt-3 md:text-3xl">{formatCurrency(stats.settlementTotal)}</p>
                        <p className="mt-1 text-[11px] leading-4 text-gray-500 md:mt-2 md:text-xs">{stats.settlementCount} completed settlement records</p>
                    </div>
                    <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm md:p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Advance Total</p>
                        <p className="mt-2 text-2xl font-black text-indigo-700 md:mt-3 md:text-3xl">{formatCurrency(stats.advanceTotal)}</p>
                        <p className="mt-1 text-[11px] leading-4 text-indigo-600/80 md:mt-2 md:text-xs">{stats.advanceCount} completed advance settlements</p>
                    </div>
                    <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4 shadow-sm md:p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Rent Total</p>
                        <p className="mt-2 text-2xl font-black text-blue-700 md:mt-3 md:text-3xl">{formatCurrency(stats.rentTotal)}</p>
                        <p className="mt-1 text-[11px] leading-4 text-blue-600/80 md:mt-2 md:text-xs">{stats.paidResidentCount}/{stats.rentCount} current residents paid this month</p>
                    </div>
                    <div className="rounded-3xl border border-orange-100 bg-orange-50 p-4 shadow-sm md:p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-orange-500">Refund Total</p>
                        <p className="mt-2 text-2xl font-black text-orange-700 md:mt-3 md:text-3xl">{formatCurrency(stats.refundTotal)}</p>
                        <p className="mt-1 text-[11px] leading-4 text-orange-600/80 md:mt-2 md:text-xs">{stats.refundCount} refund records</p>
                    </div>
                    <div className="rounded-3xl border border-yellow-100 bg-yellow-50 p-4 shadow-sm md:p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-yellow-600">Pending Settlements</p>
                        <p className="mt-2 text-2xl font-black text-yellow-700 md:mt-3 md:text-3xl">{stats.pendingSettlementCount}</p>
                        <p className="mt-1 text-[11px] leading-4 text-yellow-700/80 md:mt-2 md:text-xs">{formatCurrency(stats.pendingSettlementAmount)} waiting to settle</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-3xl border border-gray-100 bg-white p-10 text-center shadow-sm">
                        <LoadingSpinner size="lg" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">Loading payment ledgers</h3>
                            <p className="mt-2 text-sm text-gray-500">Fetching live rent, settlement, and refund data.</p>
                        </div>
                    </div>
                ) : isEmpty ? (
                    <div className="rounded-3xl border border-gray-100 bg-white p-10 text-center shadow-sm">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 text-gray-300">
                            <IoWalletOutline size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">No Payment History Yet</h3>
                        <p className="mt-2 text-sm text-gray-500">Rent rows, settlements, and refund records will appear here automatically as activity starts.</p>
                    </div>
                ) : (
                    <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-2xl font-black text-gray-900">Payment History Center</h2>
                            </div>
                            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                                {stats.activeRoomCount} active rooms · {stats.activeResidentCount} current residents
                            </div>
                        </div>

                        <div className="mt-6 grid gap-4 lg:grid-cols-3">
                            <button
                                type="button"
                                onClick={() => setActiveView('rent')}
                                className="rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                                        <IoPeopleOutline size={24} />
                                    </div>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-wider text-blue-700">
                                        {stats.rentCount} residents
                                    </span>
                                </div>
                                <h3 className="mt-4 text-xl font-black text-gray-900">Rent History</h3>
                                <p className="mt-2 text-sm text-gray-600">
                                    View room-wise current residents, monthly rent amount, and paid or unpaid status for each member.
                                </p>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveView('settlement')}
                                className="rounded-3xl border border-indigo-100 bg-indigo-50 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm">
                                        <IoCalendarOutline size={24} />
                                    </div>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-wider text-indigo-700">
                                        {advanceSettlements.length} records
                                    </span>
                                </div>
                                <h3 className="mt-4 text-xl font-black text-gray-900">Advance History</h3>
                                <p className="mt-2 text-sm text-gray-600">
                                    View only advance payout records with gross, fee, net payout, and transfer references.
                                </p>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveView('refund')}
                                className="rounded-3xl border border-orange-100 bg-orange-50 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-orange-600 shadow-sm">
                                        <IoRefreshOutline size={24} />
                                    </div>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-wider text-orange-700">
                                        {refunds.length} records
                                    </span>
                                </div>
                                <h3 className="mt-4 text-xl font-black text-gray-900">Refund History</h3>
                                <p className="mt-2 text-sm text-gray-600">
                                    View customer name, transaction IDs, refund amount, dates, and provider references in one refund list.
                                </p>
                            </button>
                        </div>
                    </section>
                )}
            </div>

            <Modal
                isOpen={Boolean(activeView)}
                onClose={() => setActiveView(null)}
                title={activeViewTitle}
                className="max-w-6xl rounded-[28px]"
            >
                <div className="space-y-5">
                    <div className="flex items-center justify-end border-b border-gray-100 pb-4">
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-600">
                            <span>Range</span>
                            <select
                                name="settlementDateRange"
                                value={dateFilter}
                                onChange={(event) => setDateFilter(event.target.value as DateFilterKey)}
                                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none transition focus:border-blue-400"
                            >
                                {DATE_FILTER_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {activeView === 'rent' && renderRentView()}
                    {activeView === 'settlement' && renderSettlementView()}
                    {activeView === 'refund' && renderRefundView()}
                </div>
            </Modal>
        </div>
    );
};

export default Settlements;
