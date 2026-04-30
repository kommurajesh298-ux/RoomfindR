import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookingWithDetails } from '../../types/booking.types';
import { getStatusColor } from '../../utils/booking.utils';
import { refundService } from '../../services/refund.service';
import type { Refund } from '../../types/booking.types';
import RefundTracker from './RefundTracker';

interface BookingCardProps {
    booking: BookingWithDetails;
    listType: 'active' | 'history';
    onViewInvoice: (id: string) => void;
    onViewPortal: () => void;
    onMonthlyPayments: (id: string) => void;
    onVacate: (booking: BookingWithDetails) => void;
    onRetryBooking: () => void;
    onMoveToHistory?: () => void;
    onHideFromHistory?: () => void;
    isRetryingPayment?: boolean;
}

const BookingCard: React.FC<BookingCardProps> = React.memo(({
    booking,
    listType,
    onViewInvoice,
    onViewPortal,
    onMonthlyPayments,
    onVacate,
    onRetryBooking,
    onMoveToHistory,
    onHideFromHistory,
    isRetryingPayment = false
}) => {
    const navigate = useNavigate();
    const {
        bookingId,
        propertyDetails,
        propertyTitle,
        startDate,
        status,
        amountPaid,
        durationMonths,
        roomNumber
    } = booking;

    const statusColor = getStatusColor(status);
    const isCancelled = ['cancelled', 'rejected', 'CANCELLED_BY_CUSTOMER'].includes(status);

    const [refund, setRefund] = useState<Refund | null>(null);

    useEffect(() => {
        if (isCancelled || status === 'refunded') {
            return refundService.subscribeToRefund(bookingId, (data) => {
                setRefund(data);
            });
        }
    }, [bookingId, isCancelled, status]);

    const getRefundStatusColor = (s: string) => {
        switch (s) {
            case 'PENDING': return 'bg-amber-500/20 text-amber-700 border-amber-200';
            case 'PROCESSING': return 'bg-orange-500/20 text-orange-700 border-orange-200';
            case 'ONHOLD': return 'bg-yellow-500/20 text-yellow-700 border-yellow-200';
            case 'SUCCESS': return 'bg-blue-500/20 text-blue-600 border-blue-200';
            case 'PROCESSED': return 'bg-blue-500/20 text-blue-600 border-blue-200';
            case 'FAILED': return 'bg-rose-500/20 text-rose-600 border-rose-200';
            default: return 'bg-gray-500/20 text-gray-600 border-gray-200';
        }
    };

    const displayRoom = booking.rooms?.room_number || roomNumber || 'Not Assigned';
    const displayTitle = propertyDetails?.title || propertyTitle || 'Unknown Property';
    const displayLocation = propertyDetails?.address?.text || propertyDetails?.city || 'Location not available';
    const isPaymentPending = booking.paymentStatus === 'pending' || booking.paymentStatus === 'payment_pending';
    const isPaymentFailed = booking.paymentStatus === 'failed' || booking.status === 'payment_failed';
    const needsPaymentAction = isPaymentPending || isPaymentFailed;
    const hasCompletedPayment = booking.paymentStatus === 'paid' || booking.paymentStatus === 'refunded';
    const hasRefundLifecycle = status === 'rejected' || status === 'refunded' || Boolean(refund);
    const showRefundTracker = hasRefundLifecycle && hasCompletedPayment;
    const showActiveClearOption = listType === 'active'
        && Boolean(onMoveToHistory)
        && (needsPaymentAction || isCancelled || hasRefundLifecycle);
    const amountLabel = isCancelled && needsPaymentAction ? 'Cancelled' : (needsPaymentAction ? 'Retry' : 'Paid');
    const amountValue = needsPaymentAction
        ? (booking.amountDue ?? booking.advancePaid ?? amountPaid)
        : (amountPaid || booking.advancePaid || booking.amountDue || 0);
    const amountValueClassName = isCancelled && needsPaymentAction
        ? 'text-white/80'
        : (needsPaymentAction ? 'text-red-200' : 'text-white');
    const showPaymentBadge = Boolean(booking.paymentStatus) && !isCancelled && status !== 'rejected' && status !== 'refunded';

    return (
        <div className={`rfm-booking-card group bg-white rounded-[24px] sm:rounded-[28px] border border-gray-100/80 overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_50px_rgba(249,115,22,0.14)] transition-all duration-500 flex flex-col ${isCancelled || status === 'rejected' ? 'opacity-95' : ''} active:scale-[0.98] animate-in fade-in zoom-in-95 duration-500`}>
            {/* Top Section: Property Image & Status */}
            <div className="relative h-40 sm:h-56 overflow-hidden">
                <img
                    src={booking.rooms?.images?.[0] || propertyDetails?.images?.[0] || `${import.meta.env.BASE_URL}assets/images/properties/hostel-1.avif`}
                    alt={displayTitle}
                    className={`w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000 ${isCancelled ? 'grayscale' : ''}`}
                    loading="lazy"
                    decoding="async"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                {showActiveClearOption && onMoveToHistory && (
                    <button
                        type="button"
                        onClick={onMoveToHistory}
                        className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition-all hover:bg-black/60 active:scale-95"
                        aria-label="Move booking to history"
                        title="Move to history"
                    >
                        ×
                    </button>
                )}

                {listType === 'history' && onHideFromHistory && (
                    <button
                        type="button"
                        onClick={onHideFromHistory}
                        className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition-all hover:bg-black/60 active:scale-95"
                        aria-label="Clean history card"
                        title="Clean history"
                    >
                        ×
                    </button>
                )}

                {/* Status Badges - Floating Pill */}
                <div className="absolute top-3 left-3 flex flex-col gap-2">
                    <div className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.1em] backdrop-blur-md border border-white/30 shadow-2xl ${statusColor} ring-1 ring-black/5`}>
                        {status.toUpperCase().replace('CANCELLED_BY_CUSTOMER', 'CANCELLED').replace('-', ' ').replace('_', ' ')}
                    </div>
                    {showPaymentBadge && (
                    <div className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.1em] backdrop-blur-md border border-white/30 shadow-2xl ${getStatusColor(booking.paymentStatus)} ring-1 ring-black/5 flex items-center gap-1`}>
                            {booking.paymentStatus === 'pending' && <span>Retry Needed</span>}
                            {booking.paymentStatus === 'payment_pending' && <span>Retry Needed</span>}
                            {booking.paymentStatus === 'paid' && <span>Paid ✓</span>}
                            {booking.paymentStatus === 'failed' && <span>Retry Needed</span>}
                        </div>
                    )}
                    {refund && (
                        <div className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.1em] backdrop-blur-md border border-white/30 shadow-2xl ${getRefundStatusColor(refund.status)} ring-1 ring-black/5 flex items-center gap-1`}>
                            {refund.status === 'PENDING' && <span>Refund Review</span>}
                            {refund.status === 'PROCESSING' && <span>Refund Processing ⏳</span>}
                            {refund.status === 'ONHOLD' && <span>Refund On Hold</span>}
                            {(refund.status === 'SUCCESS' || refund.status === 'PROCESSED') && <span>Refunded ✓</span>}
                            {refund.status === 'FAILED' && <span>Refund Failed ✕</span>}
                        </div>
                    )}
                </div>

                {/* Property Info Layered on Image */}
                <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end gap-2">
                    <div className="flex-1 min-w-0">
                        <h3 className="font-extrabold text-[15px] sm:text-xl text-white mb-0.5 line-clamp-1 drop-shadow-lg tracking-tight leading-tight">
                            {displayTitle}
                        </h3>
                        <div className="flex items-center gap-1 text-white/90">
                            <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            </svg>
                            <p className="text-[10px] font-semibold line-clamp-1 opacity-90">
                                {displayLocation}
                            </p>
                        </div>
                    </div>
                    <div className="bg-white/10 backdrop-blur-xl px-2.5 py-1.5 rounded-xl border border-white/20 shadow-2xl text-right shrink-0">
                        <span className="block text-[7px] font-black text-white/60 leading-none mb-0.5 uppercase tracking-widest">
                            {amountLabel}
                        </span>
                        <span className={`text-[12px] sm:text-base font-black leading-none ${amountValueClassName}`}>
                            ₹{amountValue.toLocaleString()}
                        </span>
                    </div>
                </div>
            </div>

            {/* Content Section */}
            <div className="p-3 sm:p-5 flex-1 flex flex-col gap-3 sm:gap-5">
                {/* Details Grid */}
                {!showRefundTracker && (
                    <div className="grid grid-cols-2 gap-3 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                        <div className="space-y-0.5">
                            <div className="flex items-center gap-1 opacity-40">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <p className="text-[8px] font-black uppercase tracking-widest leading-none">Check-in</p>
                            </div>
                            <p className="text-[11px] font-bold text-slate-700 leading-none">
                                {new Date(startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </p>
                        </div>
                        <div className="space-y-0.5">
                            <div className="flex items-center gap-1 opacity-40">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                                <p className="text-[8px] font-black uppercase tracking-widest leading-none">Room</p>
                            </div>
                            <p className="text-[11px] font-bold text-slate-700 leading-none truncate">
                                {displayRoom}
                            </p>
                        </div>
                    </div>
                )}

                {showRefundTracker && (
                    <RefundTracker refund={refund} status={status} />
                )}

                {/* Action Row */}
                <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                    <div className="flex gap-2 flex-1">
                        {isCancelled ? (
                            <button
                                onClick={() => navigate(`/property/${booking.propertyId}`)}
                                className="w-full py-2.5 text-[10px] font-black text-white bg-[var(--rf-color-action)] hover:bg-[var(--rf-color-action-hover)] rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-orange-200 active:scale-95"
                            >
                                Book Again
                            </button>
                        ) : (
                            <>
                                {(status === 'checked-in' || status === 'checked_in') && (
                                    <>
                                        <button
                                            onClick={() => onViewPortal()}
                                            className="flex-1 rounded-2xl border border-blue-200/70 bg-[linear-gradient(135deg,#EFF6FF_0%,#DBEAFE_100%)] px-3 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-blue-700 shadow-[0_10px_22px_rgba(37,99,235,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-[linear-gradient(135deg,#DBEAFE_0%,#BFDBFE_100%)] hover:text-blue-800 hover:shadow-[0_14px_28px_rgba(37,99,235,0.18)] active:scale-95"
                                        >
                                            Portal
                                        </button>

                                        {/* Vacate Button Logic */}
                                        {booking.vacateDate ? (
                                            <div className="flex-1 rounded-2xl border border-amber-200/80 bg-[linear-gradient(135deg,#FFF7ED_0%,#FFEDD5_100%)] px-2 py-3 text-amber-700 shadow-[0_10px_24px_rgba(245,158,11,0.12)] flex items-center justify-center gap-1.5">
                                                <span className="text-base">⏳</span>
                                                <span className="text-[9px] font-black uppercase tracking-[0.18em]">Vacate Pending</span>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => onVacate(booking)}
                                                className="flex-1 rounded-2xl border border-rose-200/80 bg-[linear-gradient(135deg,#FFF1F2_0%,#FFE4E6_100%)] px-3 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-rose-600 shadow-[0_10px_22px_rgba(244,63,94,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:border-rose-300 hover:bg-[linear-gradient(135deg,#FFE4E6_0%,#FECDD3_100%)] hover:text-rose-700 hover:shadow-[0_14px_28px_rgba(244,63,94,0.18)] active:scale-95"
                                            >
                                                Vacate
                                            </button>
                                        )}
                                    </>
                                )}

                                {needsPaymentAction ? (
                                    <button
                                        onClick={() => onRetryBooking()}
                                        disabled={isRetryingPayment}
                                        className="flex-1 py-2.5 text-[10px] font-black text-white bg-[var(--rf-color-action)] hover:bg-[var(--rf-color-action-hover)] rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-orange-200 active:scale-95 disabled:opacity-60"
                                    >
                                        {isRetryingPayment ? 'Opening PG...' : 'Retry Booking'}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => onViewInvoice(bookingId)}
                                        className="flex-1 rounded-2xl border border-slate-200/80 bg-[linear-gradient(135deg,#FFFFFF_0%,#F8FAFC_100%)] px-3 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 shadow-[0_10px_22px_rgba(15,23,42,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-[linear-gradient(135deg,#F8FAFC_0%,#EEF2FF_100%)] hover:text-slate-800 hover:shadow-[0_14px_28px_rgba(71,85,105,0.16)] active:scale-95"
                                    >
                                        Invoice
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {!isCancelled && durationMonths > 1 && (status === 'accepted' || status === 'checked-in' || status === 'approved' || status === 'confirmed') && (
                        <button
                            onClick={() => onMonthlyPayments(bookingId)}
                            className="shrink-0 w-10 h-10 flex items-center justify-center text-white bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl shadow-lg shadow-indigo-200 active:scale-95 transition-all"
                            title="Pay Monthly"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});

BookingCard.displayName = 'BookingCard';

export default BookingCard;

