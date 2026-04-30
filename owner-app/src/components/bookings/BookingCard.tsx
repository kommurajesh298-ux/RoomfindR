import React, { useEffect, useState } from 'react';
import {
    IoCheckmarkCircle,
    IoCloseCircle,
    IoEye,
    IoCalendarOutline,
    IoPersonOutline,
    IoLocationOutline,
    IoWalletOutline
} from 'react-icons/io5';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import type { Booking } from '../../types/booking.types';
import type { Property } from '../../types/property.types';
import { refundService, type OwnerRefund } from '../../services/refund.service';
import { getBookingGstSummary } from '../../utils/gst';

interface BookingWithDetails extends Booking {
    customerDetails?: {
        photoUrl?: string;
        displayName?: string;
        phoneNumber?: string;
    };
}

interface BookingCardProps {
    booking: Booking & { propertyDetails?: Property; customerDetails?: Record<string, unknown> };
    onAccept: (id: string) => void;
    onReject: (id: string) => void;
    onCheckIn: (id: string, propertyId: string, roomId: string) => void;
    onCheckOut: (id: string, propertyId: string, roomId: string) => void;
    onApproveVacate: (id: string, roomId: string) => void;
    onViewDetails: (booking: Booking) => void;
}

const BookingCard: React.FC<BookingCardProps> = ({
    booking,
    onAccept,
    onReject,
    onCheckIn,
    onCheckOut,
    onApproveVacate,
    onViewDetails
}) => {
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isAcceptedLocally, setIsAcceptedLocally] = useState(false);
    const [refund, setRefund] = useState<OwnerRefund | null>(null);

    const getStatusColor = (rawStatus: string) => {
        const s = rawStatus?.toLowerCase()?.replace(/_/g, '-') || 'unknown';
        switch (s) {
            case 'pending':
            case 'requested':
            case 'payment-pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'paid': return 'bg-blue-100 text-blue-800 border-blue-200';
            case 'approved':
            case 'confirmed':
                return 'bg-blue-100 text-blue-800 border-blue-200';
            case 'checked-in': return 'bg-purple-100 text-purple-800 border-purple-200';
            case 'checked-out': return 'bg-gray-100 text-gray-800 border-gray-200';
            case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
            case 'cancelled':
            case 'cancelled-by-customer':
                return 'bg-orange-50 text-orange-700 border-orange-100';
            default: return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    const getPaymentStatusColor = (status: Booking['paymentStatus']) => {
        switch (status) {
            case 'paid': return 'bg-blue-100 text-blue-800';
            case 'pending': return 'bg-yellow-100 text-yellow-800';
            case 'failed': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    useEffect(() => {
        const normalizedStatus = booking.status?.toLowerCase().replace(/_/g, '-');
        if (!['rejected', 'cancelled', 'refunded'].includes(normalizedStatus)) {
            setRefund(null);
            return;
        }

        return refundService.subscribeToRefund(booking.bookingId, setRefund);
    }, [booking.bookingId, booking.status]);

    const getRefundBadge = () => {
        if (!refund) return null;

        const copy = refund.status === 'SUCCESS'
            ? 'Refund Success'
            : refund.status === 'FAILED'
                ? 'Refund Failed'
                : refund.status === 'ONHOLD'
                    ? 'Refund On Hold'
                : refund.status === 'PENDING'
                    ? 'Refund Review'
                    : 'Refund Processing';

        const tone = refund.status === 'SUCCESS'
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : refund.status === 'FAILED'
                ? 'bg-red-50 text-red-700 border-red-200'
                : refund.status === 'ONHOLD'
                    ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                : refund.status === 'PENDING'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-orange-50 text-orange-700 border-orange-200';

        return (
            <div className={`px-3 py-1 rounded-full text-[11px] font-semibold border ${tone}`}>
                {copy}
            </div>
        );
    };

    const handleAction = async (action: () => Promise<void> | void, isAcceptAction: boolean = false) => {
        setIsActionLoading(true);
        try {
            await action();
            if (isAcceptAction) {
                setIsAcceptedLocally(true);
            }
        } catch (error: unknown) {
            console.error('Action failed:', error);
            const msg = (error as Error).message || 'Action failed. Please try again.';
            toast.error(msg, { duration: 4000 });
        } finally {
            setIsActionLoading(false);
        }
    };

    const startDate = new Date(booking.startDate);
    const endDate = new Date(booking.endDate);
    const normalizedStatus = booking.status?.toLowerCase().replace(/_/g, '-');
    const gstSummary = getBookingGstSummary(booking);
    const customerVisibleAmount = gstSummary.amountPaid > 0 ? gstSummary.amountPaid : gstSummary.totalAmount;
    const amountLabel = gstSummary.usesStructuredTaxes ? 'Customer Paid' : 'Advance Paid';

    return (
        <div
            data-testid="owner-booking-card"
            className="bg-white rounded-2xl rounded-[22px] shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow duration-300"
        >
            <div className="p-4 md:p-5">
                {/* Header: Status & Price */}
                <div className="flex items-start justify-between gap-3 mb-3 md:mb-4">
                    <div className="flex flex-col items-start gap-1">
                        <div className={`px-3 py-1 rounded-full text-[11px] md:text-xs font-semibold border ${getStatusColor(booking.status)}`}>
                            {booking.status.replace('CANCELLED_BY_CUSTOMER', 'CANCELLED').charAt(0).toUpperCase() +
                                booking.status.replace('CANCELLED_BY_CUSTOMER', 'CANCELLED').slice(1).replace('-', ' ')}
                        </div>
                        {getRefundBadge()}
                    </div>
                    <div className="text-right shrink-0">
                        <div className="text-[11px] md:text-sm text-gray-500">{amountLabel}</div>
                        <div className="text-xl md:text-lg font-black text-primary-600 leading-tight">Rs {customerVisibleAmount.toLocaleString('en-IN')}</div>
                        {gstSummary.usesStructuredTaxes && (
                            <div className="mt-1 text-[10px] font-semibold text-gray-400">
                                Owner share Rs {gstSummary.ownerGrossAmount.toLocaleString('en-IN')}
                            </div>
                        )}
                    </div>
                </div>

                {/* Customer Info */}
                <div className="flex items-center gap-3 mb-3 md:mb-4 p-3 bg-gray-50 rounded-2xl">
                    <div className="w-11 h-11 md:w-12 md:h-12 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 overflow-hidden shrink-0">
                        {(booking as BookingWithDetails).customerDetails?.photoUrl ? (
                            <img src={(booking as BookingWithDetails).customerDetails?.photoUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <IoPersonOutline size={22} />
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">{booking.customerName || (booking as BookingWithDetails).customerDetails?.displayName || 'Customer'}</div>
                        <div className="text-xs text-gray-500">{booking.customerPhone || (booking as BookingWithDetails).customerDetails?.phoneNumber || 'No phone'}</div>
                    </div>
                </div>

                {/* Property & Dates */}
                <div className="space-y-2.5 mb-4 md:mb-5">
                    <div className="flex items-start gap-2 text-sm">
                        <IoLocationOutline className="mt-0.5 text-gray-400 shrink-0" />
                        <div className="min-w-0">
                            <div className="font-semibold text-gray-800 truncate">{booking.propertyTitle || booking.propertyDetails?.title || 'Unknown Property'}</div>
                            <div className="text-[11px] text-primary-500 font-bold uppercase tracking-wide">Room {booking.roomNumber || 'N/A'}</div>
                        </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <div className="flex items-start gap-2 text-sm min-w-0">
                            <IoCalendarOutline className="text-gray-400 mt-0.5 shrink-0" />
                            <div className="text-gray-700 min-w-0 leading-snug">
                                <div className="font-medium break-words">{format(startDate, 'dd MMM yyyy')} - {format(endDate, 'dd MMM yyyy')}</div>
                            </div>
                        </div>
                        <div className="justify-self-start sm:justify-self-end">
                            <span className="inline-flex px-2.5 py-1 bg-gray-100 rounded-lg text-[11px] font-semibold text-gray-600">
                                {booking.durationMonths} {booking.durationMonths === 1 ? 'Month' : 'Months'}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                        <IoWalletOutline className="text-gray-400 shrink-0" />
                        <div className={`inline-flex px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wide ${getPaymentStatusColor(booking.paymentStatus)}`}>
                            Payment: {booking.paymentStatus.toUpperCase()}
                        </div>
                    </div>
                </div>

                <div className="pt-3 md:pt-4 border-t border-gray-100">
                    {(booking.status === 'pending' || booking.status === 'requested' || booking.status === 'PAID' || booking.status === 'payment_pending') && (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => handleAction(() => onAccept(booking.bookingId), true)}
                                    disabled={isActionLoading || isAcceptedLocally || (normalizedStatus === 'payment-pending' && booking.paymentStatus?.toLowerCase() !== 'paid')}
                                    className={`min-h-[44px] ${isAcceptedLocally ? 'bg-blue-100 text-blue-700 pointer-events-none' : 'bg-blue-600 hover:bg-blue-700 text-white'} py-2.5 px-3 rounded-xl text-[13px] font-semibold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed`}
                                >
                                    {isAcceptedLocally ? (
                                        <><IoCheckmarkCircle className="animate-bounce" /> Accepted!</>
                                    ) : (
                                        <>
                                            <IoCheckmarkCircle />
                                            {(normalizedStatus === 'paid' || normalizedStatus === 'payment-pending')
                                                ? (booking.paymentStatus?.toLowerCase() === 'paid' ? 'Approve Paid' : 'Waiting...')
                                                : 'Accept'}
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => handleAction(() => onReject(booking.bookingId))}
                                    disabled={isActionLoading}
                                    className="min-h-[44px] bg-red-50 hover:bg-red-100 text-red-600 py-2.5 px-3 rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <IoCloseCircle /> Reject
                                </button>
                            </div>
                        </>
                    )}

                    {(booking.status === 'approved' || booking.status === 'accepted' || booking.status === 'confirmed') && (
                        <button
                            onClick={() => handleAction(() => onCheckIn(booking.bookingId, booking.propertyId, booking.roomId))}
                            disabled={isActionLoading}
                            className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white py-2.5 px-4 rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            Mark as Checked-In
                        </button>
                    )}

                    {booking.status === 'checked-in' && (
                        <button
                            onClick={() => handleAction(() => onCheckOut(booking.bookingId, booking.propertyId, booking.roomId))}
                            disabled={isActionLoading}
                            className="w-full min-h-[44px] bg-orange-600 hover:bg-orange-700 text-white py-2.5 px-4 rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            Mark as Checked-Out
                        </button>
                    )}

                    {((booking.status === 'vacate_requested') || (booking.status === 'checked-in' && booking.vacateDate)) && (
                        <button
                            onClick={() => handleAction(() => onApproveVacate(booking.bookingId, booking.roomId))}
                            disabled={isActionLoading}
                            className="w-full min-h-[44px] bg-red-600 hover:bg-red-700 text-white py-2.5 px-4 rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 animate-pulse"
                        >
                            Approve Vacate Request
                        </button>
                    )}

                    <div className="flex gap-2 w-full mt-2">
                        <button
                            onClick={() => onViewDetails(booking)}
                            className="w-full min-h-[44px] bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 rounded-xl text-[13px] font-bold transition-colors flex items-center justify-center gap-2"
                        >
                            <IoEye /> View Profile & Details
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
};

export default BookingCard;

