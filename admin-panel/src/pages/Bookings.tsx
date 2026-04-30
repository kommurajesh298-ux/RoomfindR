import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import {
    FiCheckCircle,
    FiEye,
    FiSearch,
    FiFilter
} from 'react-icons/fi';
import BookingApprovalModal from '../components/bookings/BookingApprovalModal';
import BookingDetailsModal from '../components/bookings/BookingDetailsModal';
import { useAuth } from '../hooks/useAuth';
import { bookingService } from '../services/booking.service';
import type { PlatformBooking } from '../types/booking.types';
import { getBookingGstSummary } from '../utils/gst';

type BookingFilter = 'all' | 'approved' | 'checked-in' | 'rejected';

const formatCurrency = (value: number | undefined) =>
    `INR ${Number(value || 0).toLocaleString('en-IN')}`;

const formatDateRange = (start?: string, end?: string) => {
    const formatValue = (value?: string) => {
        if (!value) return 'N/A';
        return format(new Date(value), 'dd MMM yyyy');
    };

    return {
        start: formatValue(start),
        end: formatValue(end),
    };
};

const getPaymentBadge = (status: string) => {
    const normalized = String(status || '').toLowerCase();

    if (normalized === 'paid' || normalized === 'completed') {
        return 'border-blue-200/80 bg-blue-50 text-blue-700';
    }

    if (normalized === 'refunded') {
        return 'border-slate-200 bg-slate-100 text-slate-700';
    }

    if (normalized === 'failed') {
        return 'border-rose-200 bg-rose-50 text-rose-700';
    }

    return 'border-amber-200 bg-amber-50 text-amber-700';
};

const getStatusBadge = (status: string) => {
    const normalized = String(status || '').toLowerCase();

    if (['approved', 'confirmed'].includes(normalized)) {
        return 'border-sky-200 bg-sky-50 text-sky-700';
    }

    if (['checked-in', 'checked_in'].includes(normalized)) {
        return 'border-violet-200 bg-violet-50 text-violet-700';
    }

    if (['rejected', 'cancelled', 'refunded'].includes(normalized)) {
        return 'border-rose-200 bg-rose-50 text-rose-700';
    }

    return 'border-slate-200 bg-slate-100 text-slate-700';
};

const bookingFilterCardStyles: Record<BookingFilter, {
    card: string;
    label: string;
    value: string;
    active: string;
}> = {
    all: {
        card: 'border-slate-200 bg-white',
        label: 'text-slate-400',
        value: 'text-slate-900',
        active: 'ring-2 ring-slate-900/10 border-slate-300 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.55)]',
    },
    approved: {
        card: 'border-blue-100 bg-blue-50',
        label: 'text-blue-500',
        value: 'text-blue-700',
        active: 'ring-2 ring-blue-200 border-blue-200 shadow-[0_16px_28px_-24px_rgba(37,99,235,0.45)]',
    },
    'checked-in': {
        card: 'border-violet-100 bg-violet-50',
        label: 'text-violet-500',
        value: 'text-violet-700',
        active: 'ring-2 ring-violet-200 border-violet-200 shadow-[0_16px_28px_-24px_rgba(109,40,217,0.45)]',
    },
    rejected: {
        card: 'border-rose-100 bg-rose-50',
        label: 'text-rose-500',
        value: 'text-rose-700',
        active: 'ring-2 ring-rose-200 border-rose-200 shadow-[0_16px_28px_-24px_rgba(225,29,72,0.45)]',
    },
};

const matchesFilter = (booking: PlatformBooking, filter: BookingFilter) => {
    const normalizedStatus = String(booking.status || '').toLowerCase();

    if (filter === 'all') return true;
    if (filter === 'approved') {
        return ['approved', 'confirmed'].includes(normalizedStatus);
    }
    if (filter === 'checked-in') {
        return ['checked-in', 'checked_in'].includes(normalizedStatus);
    }

    return normalizedStatus === 'rejected';
};

const Bookings: React.FC = () => {
    const [bookings, setBookings] = useState<PlatformBooking[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<BookingFilter>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBooking, setSelectedBooking] = useState<PlatformBooking | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    const { admin } = useAuth();

    useEffect(() => {
        setLoading(true);
        const unsubscribe = bookingService.getAllBookings(undefined, (data) => {
            setBookings(data as PlatformBooking[]);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleAction = (booking: PlatformBooking, action: 'view' | 'status') => {
        setSelectedBooking(booking);
        if (action === 'view') setDetailsOpen(true);
        if (action === 'status') setReviewOpen(true);
    };

    const handleReviewDecision = async ({ status, notes }: { status: string; notes: string }) => {
        if (!selectedBooking || !admin) return false;

        setActionLoading(true);
        try {
            await bookingService.reviewBookingDecision(selectedBooking.id, { status, notes }, admin.uid, admin.email);
            toast.success('Booking verification saved');
            return true;
        } catch {
            toast.error('Failed to save admin review');
            return false;
        } finally {
            setActionLoading(false);
        }
    };

    const filteredBookings = useMemo(() => {
        return bookings.filter((booking) => {
            const matchesSearch =
                booking.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                booking.propertyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                booking.id.toLowerCase().includes(searchTerm.toLowerCase());

            if (!matchesSearch) return false;
            return matchesFilter(booking, filter);
        });
    }, [bookings, filter, searchTerm]);

    const filterTabs: Array<{ value: BookingFilter; label: string; count: number }> = [
        { value: 'all', label: 'All Bookings', count: bookings.length },
        { value: 'approved', label: 'Approved', count: bookings.filter((booking) => matchesFilter(booking, 'approved')).length },
        {
            value: 'checked-in',
            label: 'Checked-In',
            count: bookings.filter((booking) => matchesFilter(booking, 'checked-in')).length
        },
        { value: 'rejected', label: 'Rejected', count: bookings.filter((booking) => matchesFilter(booking, 'rejected')).length }
    ];

    return (
        <div className="space-y-5">
            <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_52px_-42px_rgba(15,23,42,0.35)]">
                <div className="border-b border-slate-200 px-5 py-5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {filterTabs.map((tab) => {
                            const styles = bookingFilterCardStyles[tab.value];

                            return (
                                <button
                                    key={tab.value}
                                    onClick={() => setFilter(tab.value)}
                                    className={[
                                        'min-w-0 rounded-2xl border p-3.5 text-left shadow-sm transition-all duration-300 xl:p-4',
                                        styles.card,
                                        filter === tab.value
                                            ? styles.active
                                            : 'hover:-translate-y-0.5 hover:shadow-[0_16px_28px_-24px_rgba(15,23,42,0.4)]'
                                    ].join(' ')}
                                >
                                    <p className={`text-[9px] font-black uppercase tracking-[0.18em] sm:text-[10px] ${styles.label}`}>
                                        {tab.label}
                                    </p>
                                    <p className={`mt-2 break-words text-[1.85rem] font-black leading-none xl:text-4xl ${styles.value}`}>
                                        {tab.count}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f7faff_100%)] px-5 py-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-col gap-3 md:flex-row">
                            <div className="relative min-w-[320px] flex-1 md:min-w-[420px]">
                                <FiSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    name="bookingSearch"
                                    placeholder="Search by customer, property, or booking ID..."
                                    className="h-14 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <button className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-white hover:text-slate-950">
                                <FiFilter />
                                Filter
                            </button>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-[1180px] text-left">
                        <thead className="bg-slate-50/80 text-slate-500">
                            <tr className="border-b border-slate-200">
                                <th className="w-[16%] px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em]">Customer</th>
                                <th className="w-[14%] px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em]">Property</th>
                                <th className="w-[18%] px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] whitespace-nowrap">Stay Window</th>
                                <th className="w-[10%] px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em]">Amount</th>
                                <th className="w-[10%] px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em]">Payment</th>
                                <th className="w-[12%] px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em]">Status</th>
                                <th className="w-[14%] px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em]">Admin Review</th>
                                <th className="w-[10%] px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.22em]">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-16 text-center">
                                        <div className="mx-auto flex max-w-sm flex-col items-center">
                                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                                                <FiSearch size={24} />
                                            </div>
                                            <p className="mt-4 text-base font-semibold text-slate-900">Loading bookings</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredBookings.length > 0 ? (
                                filteredBookings.map((booking) => (
                                    <tr key={booking.id} className="group transition-colors hover:bg-sky-50/35">
                                        <td className="px-4 py-4 align-top">
                                            <div className="flex items-start gap-3">
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#dbeafe_0%,#eff6ff_100%)] text-sm font-bold text-sky-700">
                                                    {booking.customerName.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate text-[14px] font-semibold leading-5 text-slate-950" title={booking.customerName}>{booking.customerName}</p>
                                                    <p className="mt-1 break-all text-xs uppercase tracking-[0.18em] text-slate-400">
                                                        ID {booking.id.slice(0, 8)}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <p className="truncate text-[14px] font-semibold leading-5 text-slate-900" title={booking.propertyName}>
                                                {booking.propertyName}
                                            </p>
                                            <p className="mt-1 truncate text-xs text-slate-500" title={booking.ownerName}>{booking.ownerName}</p>
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <p className="whitespace-nowrap text-[13px] font-medium leading-5 text-slate-700">
                                                {formatDateRange(booking.startDate, booking.endDate).start} - {formatDateRange(booking.startDate, booking.endDate).end}
                                            </p>
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <p className="text-lg font-black tracking-[-0.03em] text-slate-950">{formatCurrency(getBookingGstSummary(booking).amountPaid || getBookingGstSummary(booking).totalAmount)}</p>
                                            {getBookingGstSummary(booking).usesStructuredTaxes && (
                                                <p className="mt-1 text-[11px] font-semibold text-slate-400">Gross total</p>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <span className={`inline-flex w-full items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] ${getPaymentBadge(booking.paymentStatus)}`}>
                                                {booking.paymentStatus}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <span className={`inline-flex w-full items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] ${getStatusBadge(booking.status)}`}>
                                                {String(booking.status).replace('_', '-')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <div>
                                                <span
                                                    className={[
                                                        'inline-flex w-full items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]',
                                                        booking.adminApproved
                                                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                                                            : 'border-amber-200 bg-amber-50 text-amber-700'
                                                    ].join(' ')}
                                                >
                                                    <FiCheckCircle size={13} />
                                                    {booking.adminApproved ? 'Reviewed' : 'Pending'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                                                <button
                                                    onClick={() => handleAction(booking, 'view')}
                                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950"
                                                    title="View booking details"
                                                >
                                                    <FiEye />
                                                </button>
                                                <button
                                                    onClick={() => handleAction(booking, 'status')}
                                                    className="inline-flex h-10 min-w-[112px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#14315d_100%)] px-3 text-[11px] font-black uppercase tracking-[0.12em] text-white shadow-[0_22px_36px_-28px_rgba(15,23,42,0.9)] transition-all hover:-translate-y-0.5 hover:shadow-[0_28px_42px_-28px_rgba(14,56,120,0.8)]"
                                                    title="Verify booking"
                                                >
                                                    <FiCheckCircle />
                                                    Verify
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={8} className="px-6 py-20 text-center">
                                        <div className="mx-auto flex max-w-md flex-col items-center">
                                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_100%)] text-sky-600 shadow-inner">
                                                <FiSearch size={30} />
                                            </div>
                                            <h3 className="mt-5 text-2xl font-black tracking-[-0.03em] text-slate-950">No bookings found</h3>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <BookingDetailsModal
                isOpen={detailsOpen}
                onClose={() => setDetailsOpen(false)}
                bookingId={selectedBooking?.id || ''}
            />

            <BookingApprovalModal
                isOpen={reviewOpen}
                onClose={() => setReviewOpen(false)}
                onConfirm={handleReviewDecision}
                bookingId={selectedBooking?.id || ''}
                currentStatus={selectedBooking?.status || ''}
                loading={actionLoading}
            />
        </div>
    );
};

export default Bookings;

