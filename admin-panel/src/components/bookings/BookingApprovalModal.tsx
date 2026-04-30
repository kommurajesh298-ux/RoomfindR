import React, { useEffect, useMemo, useState } from 'react';
import { FiAlertCircle, FiCheckCircle, FiClock, FiDollarSign, FiFileText, FiX } from 'react-icons/fi';
import { format } from 'date-fns';
import { BookingService } from '../../services/booking.service';

interface BookingApprovalModalProps {
    isOpen: boolean;
    onClose: () => void;
    bookingId: string;
    currentStatus: string;
    loading: boolean;
    onConfirm: (input: { status: string; notes: string }) => Promise<boolean>;
}

interface BookingPaymentRecord {
    id: string;
    amount: number | string;
    status: string;
    payment_type?: string;
    payment_method?: string;
    provider_order_id?: string;
    provider_payment_id?: string;
    created_at?: string;
    payment_date?: string;
}

interface BookingReviewDetails {
    id: string;
    status: string;
    customer_name?: string;
    customer_email?: string;
    customerName?: string;
    owner_id?: string;
    ownerName?: string;
    customer_id?: string;
    property_id?: string;
    propertyName?: string;
    monthly_rent?: number;
    amount_due?: number;
    advance_paid?: number;
    payment_status?: string;
    advance_payment_status?: string;
    rent_payment_status?: string;
    admin_approved?: boolean;
    admin_reviewed_at?: string;
    admin_review_notes?: string;
    rejection_reason?: string;
    created_at?: string;
    start_date?: string;
    end_date?: string;
    customers?: {
        name?: string;
        email?: string;
    };
    owners?: {
        name?: string;
        email?: string;
    };
    properties?: {
        title?: string;
    };
    payments?: BookingPaymentRecord[];
}

const successStatuses = new Set(['completed', 'success', 'authorized']);

const formatCurrency = (value: number | string | undefined) =>
    `INR ${Number(value || 0).toLocaleString('en-IN')}`;

const formatStatusLabel = (value?: string) =>
    String(value || 'pending')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());

const formatDateValue = (value?: string) => {
    if (!value) return 'N/A';
    return format(new Date(value), 'dd MMM yyyy, hh:mm a');
};

const BookingApprovalModal: React.FC<BookingApprovalModalProps> = ({
    isOpen,
    onClose,
    bookingId,
    currentStatus,
    loading,
    onConfirm,
}) => {
    const [details, setDetails] = useState<BookingReviewDetails | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [decision, setDecision] = useState<'approved' | 'rejected' | 'cancelled'>('approved');
    const [notes, setNotes] = useState('');
    const [submitState, setSubmitState] = useState<'idle' | 'success'>('idle');

    useEffect(() => {
        if (!isOpen || !bookingId) return;

        const defaultDecision: 'approved' | 'rejected' | 'cancelled' =
            currentStatus === 'rejected'
                ? 'rejected'
                : currentStatus === 'cancelled'
                    ? 'cancelled'
                    : 'approved';

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDecision(defaultDecision);
        setNotes('');
        setSubmitState('idle');
        setDetailsLoading(true);

        BookingService.getBookingDetails(bookingId)
            .then((data) => setDetails(data as BookingReviewDetails))
            .catch(() => setDetails(null))
            .finally(() => setDetailsLoading(false));
    }, [bookingId, currentStatus, isOpen]);

    useEffect(() => {
        if (submitState !== 'success') return undefined;

        const timeoutId = window.setTimeout(() => {
            onClose();
        }, 900);

        return () => window.clearTimeout(timeoutId);
    }, [onClose, submitState]);

    const payments = useMemo(() => {
        return [...(details?.payments || [])].sort((a, b) => {
            const aTime = new Date(a.payment_date || a.created_at || 0).getTime();
            const bTime = new Date(b.payment_date || b.created_at || 0).getTime();
            return bTime - aTime;
        });
    }, [details?.payments]);

    const paymentSummary = useMemo(() => {
        const successful = payments.filter((payment) => successStatuses.has(String(payment.status || '').toLowerCase()));
        return {
            totalPayments: payments.length,
            successfulPayments: successful.length,
            totalCollected: successful.reduce((total, payment) => total + Number(payment.amount || 0), 0),
        };
    }, [payments]);

    if (!isOpen) return null;

    const decisionCards = [
        {
            value: 'approved' as const,
            title: 'Verify booking',
            subtitle: 'Mark this booking as verified and allow payouts.',
            accent: 'border-blue-200 bg-blue-50 text-blue-700',
            icon: FiCheckCircle,
        },
        {
            value: 'rejected' as const,
            title: 'Reject and refund',
            subtitle: 'Reject this booking and refund paid amount.',
            accent: 'border-rose-200 bg-rose-50 text-rose-700',
            icon: FiAlertCircle,
        },
        {
            value: 'cancelled' as const,
            title: 'Cancel and refund',
            subtitle: 'Mark cancelled and start refund flow.',
            accent: 'border-amber-200 bg-amber-50 text-amber-700',
            icon: FiClock,
        },
    ];

    const primaryLabel = decision === 'approved'
        ? 'Verify Booking'
        : decision === 'rejected'
            ? 'Confirm Rejection'
            : 'Confirm Cancellation';

    const successFeedback = decision === 'approved'
        ? {
            label: 'Verified',
            button: 'bg-emerald-600 hover:bg-emerald-600',
        }
        : decision === 'rejected'
            ? {
                label: 'Rejected',
                button: 'bg-rose-600 hover:bg-rose-600',
            }
            : {
                label: 'Cancelled',
                button: 'bg-amber-500 hover:bg-amber-500',
            };

    const handleSubmit = async () => {
        if (loading || submitState === 'success') return;

        const didSucceed = await onConfirm({ status: decision, notes });
        if (!didSucceed) return;

        setSubmitState('success');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={onClose} />

            <div className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_40px_120px_rgba(15,23,42,0.18)]">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-8 py-6">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">Booking Review</p>
                        <h2 className="mt-2 text-2xl font-bold text-slate-900">Review booking payment</h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Check the payment details and choose the final action.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-full border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    >
                        <FiX size={22} />
                    </button>
                </div>

                {detailsLoading ? (
                    <div className="flex min-h-[420px] items-center justify-center">
                        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900" />
                    </div>
                ) : (
                    <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1.15fr)_380px]">
                        <div className="overflow-y-auto border-r border-slate-200 px-8 py-7">
                            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Booking</p>
                                    <p className="mt-3 text-base font-bold text-slate-900">#{bookingId.slice(0, 8).toUpperCase()}</p>
                                    <p className="mt-1 text-sm text-slate-500">{details?.properties?.title || details?.propertyName || 'Property pending'}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Customer</p>
                                    <p className="mt-3 break-words text-base font-bold text-slate-900">{details?.customers?.name || details?.customerName || details?.customer_name || 'Unknown'}</p>
                                    <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-slate-500 shadow-sm">
                                        <span className="break-all">{details?.customers?.email || details?.customer_email || 'No email'}</span>
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Owner</p>
                                    <p className="mt-3 break-words text-base font-bold text-slate-900">{details?.owners?.name || details?.ownerName || 'Unknown owner'}</p>
                                    <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-slate-500 shadow-sm">
                                        <span className="break-all">{details?.owners?.email || 'Owner linked to booking'}</span>
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Current state</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">
                                            {formatStatusLabel(details?.status || currentStatus)}
                                        </span>
                                        <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${details?.admin_approved
                                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                                            : 'border-amber-200 bg-amber-50 text-amber-700'
                                            }`}>
                                            {details?.admin_approved ? 'Reviewed' : 'Pending Review'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-500">Collected</p>
                                    <p className="mt-3 text-2xl font-black text-blue-700">{formatCurrency(paymentSummary.totalCollected)}</p>
                                    <p className="mt-1 text-sm text-blue-700/80">{paymentSummary.successfulPayments} successful payment(s)</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Advance</p>
                                    <p className="mt-3 text-2xl font-black text-slate-900">{formatCurrency(details?.advance_paid)}</p>
                                    <p className="mt-1 text-sm text-slate-500">{formatStatusLabel(details?.advance_payment_status)}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Monthly rent</p>
                                    <p className="mt-3 text-2xl font-black text-slate-900">{formatCurrency(details?.monthly_rent)}</p>
                                    <p className="mt-1 text-sm text-slate-500">{formatStatusLabel(details?.rent_payment_status)}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Amount due</p>
                                    <p className="mt-3 text-2xl font-black text-slate-900">{formatCurrency(details?.amount_due)}</p>
                                    <p className="mt-1 text-sm text-slate-500">{formatStatusLabel(details?.payment_status)}</p>
                                </div>
                            </div>

                            <div className="mt-6 rounded-[28px] border border-slate-200 bg-white">
                                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">Payments</h3>
                                    </div>
                                    <div className="rounded-full bg-slate-100 px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-slate-500">
                                        {paymentSummary.totalPayments} records
                                    </div>
                                </div>

                                {payments.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-left text-sm">
                                            <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                                                <tr>
                                                    <th className="px-5 py-4">Date</th>
                                                    <th className="px-5 py-4">Type</th>
                                                    <th className="px-5 py-4">Amount</th>
                                                    <th className="px-5 py-4">Status</th>
                                                    <th className="px-5 py-4">Provider Ref</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {payments.map((payment) => {
                                                    const normalizedStatus = String(payment.status || '').toLowerCase();
                                                    const statusClasses = successStatuses.has(normalizedStatus)
                                                        ? 'bg-blue-100 text-blue-700'
                                                        : normalizedStatus.includes('fail') || normalizedStatus.includes('cancel')
                                                            ? 'bg-rose-100 text-rose-700'
                                                            : 'bg-amber-100 text-amber-700';

                                                    return (
                                                        <tr key={payment.id} className="hover:bg-slate-50/80">
                                                            <td className="px-5 py-4 text-slate-600">{formatDateValue(payment.payment_date || payment.created_at)}</td>
                                                            <td className="px-5 py-4 font-semibold capitalize text-slate-900">{payment.payment_type || payment.payment_method || 'booking'}</td>
                                                            <td className="px-5 py-4 font-bold text-slate-900">{formatCurrency(payment.amount)}</td>
                                                            <td className="px-5 py-4">
                                                                <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${statusClasses}`}>
                                                                    {payment.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-5 py-4 text-xs font-medium text-slate-500">
                                                                {payment.provider_payment_id || payment.provider_order_id || '-'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="px-5 py-14 text-center">
                                        <FiDollarSign className="mx-auto mb-3 text-slate-300" size={28} />
                                        <p className="text-sm font-semibold text-slate-500">No payments found for this booking.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="overflow-y-auto bg-slate-50/90 px-7 py-7">
                            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">Decision</p>
                                <h3 className="mt-2 text-xl font-bold text-slate-900">Complete admin verification</h3>

                                <div className="mt-6 space-y-3">
                                    {decisionCards.map((card) => {
                                        const Icon = card.icon;
                                        const isSelected = decision === card.value;
                                        return (
                                            <button
                                                key={card.value}
                                                type="button"
                                                onClick={() => setDecision(card.value)}
                                                className={`w-full rounded-2xl border p-4 text-left transition-all ${isSelected
                                                    ? `${card.accent} shadow-sm ring-2 ring-slate-900/5`
                                                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                                                    }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className={`mt-0.5 rounded-full p-2 ${isSelected ? 'bg-white/80' : 'bg-slate-100 text-slate-500'}`}>
                                                        <Icon size={18} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-bold">{card.title}</div>
                                                        <div className="mt-1 text-sm leading-6 opacity-80">{card.subtitle}</div>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                        <FiFileText />
                                        Notes
                                    </div>
                                    <textarea
                                        name="bookingApprovalNotes"
                                        value={notes}
                                        onChange={(event) => setNotes(event.target.value)}
                                        className="mt-3 h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400"
                                        placeholder={decision === 'approved'
                                            ? 'Optional verification note'
                                            : 'Short reason for this decision'}
                                    />
                                </div>

                                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Booking info</div>
                                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                                        <div className="flex items-center justify-between gap-4">
                                            <span>Created</span>
                                            <span className="font-semibold text-slate-900">{formatDateValue(details?.created_at)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-4">
                                            <span>Stay window</span>
                                            <span className="font-semibold text-slate-900">
                                                {details?.start_date ? format(new Date(details.start_date), 'dd MMM yyyy') : 'N/A'} - {details?.end_date ? format(new Date(details.end_date), 'dd MMM yyyy') : 'N/A'}
                                            </span>
                                        </div>
                                        {details?.admin_reviewed_at && (
                                            <div className="flex items-center justify-between gap-4">
                                                <span>Reviewed</span>
                                                <span className="font-semibold text-slate-900">{formatDateValue(details.admin_reviewed_at)}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-5 flex gap-3">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    disabled={loading || submitState === 'success'}
                                    className="flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100"
                                >
                                    Close
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={loading || submitState === 'success'}
                                    className={`flex flex-1 items-center justify-center rounded-2xl px-5 py-3.5 text-sm font-bold text-white transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${submitState === 'success'
                                        ? successFeedback.button
                                        : 'bg-slate-900 hover:bg-blue-700'
                                        }`}
                                >
                                    {submitState === 'success' ? (
                                        <span className="inline-flex items-center gap-2">
                                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 motion-safe:animate-pulse">
                                                <FiCheckCircle size={16} />
                                            </span>
                                            {successFeedback.label}
                                        </span>
                                    ) : loading ? 'Saving...' : primaryLabel}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookingApprovalModal;

