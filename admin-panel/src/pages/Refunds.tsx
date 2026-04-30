import React, { useEffect, useMemo, useState } from 'react';
import { paymentService, type RefundRow } from '../services/payment.service';
import toast from 'react-hot-toast';
import { getBookingGstSummary } from '../utils/gst';

type RefundMode = 'full' | 'partial';

type RefundApprovalDraft = {
    mode: RefundMode;
    refundAmount: number;
    commissionAmount: number;
    reason: string;
};

const getRefundBookingSummary = (refund: RefundRow) =>
    refund.bookings ? getBookingGstSummary({
        ...refund.bookings,
        amountPaid: Number(refund.bookings.amount_paid ?? 0),
        advancePaid: Number(refund.bookings.advance_paid ?? 0),
        amountDue: Number(refund.bookings.amount_due ?? 0),
        monthlyRent: Number(refund.bookings.monthly_rent ?? 0),
        paymentType: (refund.bookings.payment_type as 'advance' | 'full' | 'monthly') || 'advance',
        commissionAmount: Number(refund.bookings.commission_amount ?? 0),
        roomGst: Number(refund.bookings.room_gst ?? 0),
        roomGstRate: Number(refund.bookings.room_gst_rate ?? 0),
        platformFee: Number(refund.bookings.platform_fee ?? 0),
        platformGst: Number(refund.bookings.platform_gst ?? 0),
        platformGstRate: Number(refund.bookings.platform_gst_rate ?? 0),
        totalAmount: Number(refund.bookings.total_amount ?? 0),
        cgstAmount: Number(refund.bookings.cgst_amount ?? 0),
        sgstAmount: Number(refund.bookings.sgst_amount ?? 0),
        igstAmount: Number(refund.bookings.igst_amount ?? 0),
        startDate: refund.bookings.start_date,
        endDate: refund.bookings.end_date,
        checkInDate: refund.bookings.check_in_date || null,
        paymentStatus: 'paid',
    }) : null;

const getPaidAmount = (refund: RefundRow) => {
    const summary = getRefundBookingSummary(refund);
    return Number(summary?.amountPaid || summary?.totalAmount || refund.payments?.amount || refund.amount || refund.refund_amount || 0);
};

const getNormalizedRefundStatus = (refund: RefundRow) =>
    String(refund.status || '').toUpperCase();

const getRawRefundStatus = (refund: RefundRow) =>
    String(refund.raw_status || '').toUpperCase();

const isPendingApproval = (refund: RefundRow) =>
    getRawRefundStatus(refund) === 'PENDING';

const isRefundOnHold = (refund: RefundRow) =>
    getNormalizedRefundStatus(refund) === 'ONHOLD' || getRawRefundStatus(refund) === 'ONHOLD';

const getDisplayStatus = (refund: RefundRow) => {
    if (isPendingApproval(refund)) return 'PENDING APPROVAL';
    if (isRefundOnHold(refund)) return 'ON HOLD';
    return getNormalizedRefundStatus(refund);
};

const getStatusTone = (refund: RefundRow) => {
    const rawStatus = getRawRefundStatus(refund);
    const normalizedStatus = getNormalizedRefundStatus(refund);

    if (rawStatus === 'PENDING') return 'bg-amber-100 text-amber-800';
    if (normalizedStatus === 'ONHOLD' || rawStatus === 'ONHOLD') return 'bg-yellow-100 text-yellow-800';
    if (normalizedStatus === 'SUCCESS') return 'bg-blue-100 text-blue-700';
    if (normalizedStatus === 'FAILED') return 'bg-red-100 text-red-700';
    return 'bg-orange-100 text-orange-700';
};

const canReviewRefund = (refund: RefundRow) =>
    isPendingApproval(refund);

const createRefundApprovalDraft = (refund: RefundRow): RefundApprovalDraft => {
    const paidAmount = getPaidAmount(refund);
    return {
        mode: 'full',
        refundAmount: paidAmount,
        commissionAmount: 0,
        reason: String(refund.reason || 'Booking rejected'),
    };
};

const RefundApprovalModal: React.FC<{
    refund: RefundRow;
    busy: boolean;
    onClose: () => void;
    onApprove: (input: {
        refundAmount: number;
        commissionAmount: number;
        refundReason: string;
    }) => Promise<void>;
    onReject: (reason: string) => Promise<void>;
}> = ({ refund, busy, onClose, onApprove, onReject }) => {
    const paidAmount = getPaidAmount(refund);
    const bookingSummary = getRefundBookingSummary(refund);
    const initialDraft = useMemo(() => createRefundApprovalDraft(refund), [refund]);
    const [mode, setMode] = useState<RefundMode>(initialDraft.mode);
    const [refundAmount, setRefundAmount] = useState<number>(initialDraft.refundAmount);
    const [commissionAmount, setCommissionAmount] = useState<number>(initialDraft.commissionAmount);
    const [reason, setReason] = useState<string>(initialDraft.reason);

    const handleCommissionChange = (value: string) => {
        const nextCommission = Math.max(0, Number(value || 0));
        const safeCommission = Number.isFinite(nextCommission) ? nextCommission : 0;
        const nextRefundAmount = Math.max(0, paidAmount - safeCommission);
        setCommissionAmount(Number(nextRefundAmount < paidAmount ? safeCommission.toFixed(2) : safeCommission));
        setRefundAmount(Number(nextRefundAmount.toFixed(2)));
        setMode(nextRefundAmount === paidAmount ? 'full' : 'partial');
    };

    const handleRefundAmountChange = (value: string) => {
        const parsed = Number(value || 0);
        const safeRefundAmount = Number.isFinite(parsed)
            ? Math.min(Math.max(parsed, 0), paidAmount)
            : paidAmount;
        const nextCommission = Math.max(0, paidAmount - safeRefundAmount);
        setRefundAmount(Number(safeRefundAmount.toFixed(2)));
        setCommissionAmount(Number(nextCommission.toFixed(2)));
        setMode(safeRefundAmount === paidAmount ? 'full' : 'partial');
    };

    const submitApprove = async () => {
        await onApprove({
            refundAmount: Number(refundAmount.toFixed(2)),
            commissionAmount: Number(commissionAmount.toFixed(2)),
            refundReason: mode === 'partial' ? 'partial_refund' : 'booking_rejected'
        });
    };

    const submitReject = async () => {
        await onReject(reason || 'Refund rejected by admin');
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3 backdrop-blur-sm sm:p-4">
            <div className="flex min-h-full items-start justify-center py-2 sm:py-4">
                <div className="flex w-full max-w-2xl max-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)] sm:max-h-[calc(100vh-2rem)]">
                <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-6 py-5">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Refund Review</p>
                        <h2 className="mt-1 text-2xl font-black text-slate-900">Approve booking refund</h2>
                        <p className="mt-1 text-sm text-slate-500">Cashfree will return the money to the customer’s original payment method after approval.</p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-500 transition hover:bg-slate-200 disabled:opacity-50"
                    >
                        Close
                    </button>
                </div>

                <div className="min-h-0 overflow-y-auto px-6 py-6">
                    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-5">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Booking Details</p>
                            <div className="mt-4 space-y-3 text-sm text-slate-600">
                                <div className="flex justify-between gap-4">
                                    <span className="font-semibold text-slate-500">Customer</span>
                                    <span className="text-right font-bold text-slate-900">{refund.bookings?.customer_name || 'Unknown customer'}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="font-semibold text-slate-500">Property</span>
                                    <span className="text-right font-bold text-slate-900">{refund.bookings?.properties?.title || 'Unknown property'}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="font-semibold text-slate-500">Booking ID</span>
                                    <span className="text-right font-mono text-xs font-bold text-slate-900">{refund.booking_id}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="font-semibold text-slate-500">Paid Amount</span>
                                    <span className="text-right text-lg font-black text-slate-900">INR {paidAmount.toLocaleString('en-IN')}</span>
                                </div>
                                {bookingSummary?.usesStructuredTaxes && (
                                    <>
                                        <div className="flex justify-between gap-4">
                                            <span className="font-semibold text-slate-500">Owner Share</span>
                                            <span className="text-right font-bold text-slate-900">INR {bookingSummary.ownerGrossAmount.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="font-semibold text-slate-500">Platform Fee + GST</span>
                                            <span className="text-right font-bold text-orange-600">INR {(bookingSummary.platformFee + bookingSummary.platformGst).toLocaleString('en-IN')}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-100 p-5">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Refund Type</p>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMode('full');
                                        setCommissionAmount(0);
                                        setRefundAmount(paidAmount);
                                    }}
                                    className={`rounded-2xl border px-4 py-4 text-left transition ${mode === 'full' ? 'border-orange-300 bg-orange-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                >
                                    <p className="text-sm font-black text-slate-900">Full Refund</p>
                                    <p className="mt-1 text-xs text-slate-500">Return the complete amount with no deduction.</p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMode('partial')}
                                    className={`rounded-2xl border px-4 py-4 text-left transition ${mode === 'partial' ? 'border-orange-300 bg-orange-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                >
                                    <p className="text-sm font-black text-slate-900">Partial Refund</p>
                                    <p className="mt-1 text-xs text-slate-500">Deduct commission and send the remainder to the customer.</p>
                                </button>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-100 p-5">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Approval Note</p>
                            <textarea
                                name="refundApprovalReason"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                className="mt-4 min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
                                placeholder="Reason visible in refund records"
                            />
                        </div>
                    </div>

                    <div className="space-y-5">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Refund Breakdown</p>
                            <div className="mt-4 space-y-4">
                                <label className="block">
                                    <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Refund Amount</span>
                                    <input
                                        type="number"
                                        name="refundAmount"
                                        min={0}
                                        max={paidAmount}
                                        step="0.01"
                                        value={refundAmount}
                                        onChange={(event) => handleRefundAmountChange(event.target.value)}
                                        disabled={busy || mode === 'full'}
                                        className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100 disabled:text-slate-400"
                                    />
                                </label>

                                <label className="block">
                                    <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Commission Deduction</span>
                                    <input
                                        type="number"
                                        name="refundCommissionAmount"
                                        min={0}
                                        max={paidAmount}
                                        step="0.01"
                                        value={commissionAmount}
                                        onChange={(event) => handleCommissionChange(event.target.value)}
                                        disabled={busy || mode === 'full'}
                                        className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100 disabled:text-slate-400"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="rounded-2xl bg-slate-900 p-5 text-white">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-white/50">Approval Summary</p>
                            <div className="mt-4 space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-white/70">Paid</span>
                                    <span className="font-bold">INR {paidAmount.toLocaleString('en-IN')}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-white/70">Commission</span>
                                    <span className="font-bold">INR {commissionAmount.toLocaleString('en-IN')}</span>
                                </div>
                                <div className="flex justify-between border-t border-white/10 pt-3 text-base">
                                    <span className="font-black">Refund to customer</span>
                                    <span className="font-black text-orange-300">INR {refundAmount.toLocaleString('en-IN')}</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-3">
                            <button
                                type="button"
                                onClick={submitApprove}
                                disabled={busy || refundAmount <= 0 || refundAmount > paidAmount}
                                className="h-12 rounded-2xl bg-[var(--rf-color-action)] text-sm font-black uppercase tracking-[0.2em] text-white transition hover:bg-[var(--rf-color-action-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {busy ? 'Approving...' : 'Approve Refund'}
                            </button>
                            <button
                                type="button"
                                onClick={submitReject}
                                disabled={busy}
                                className="h-12 rounded-2xl border border-red-200 bg-red-50 text-sm font-black uppercase tracking-[0.2em] text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {busy ? 'Updating...' : 'Reject Refund'}
                            </button>
                        </div>
                    </div>
                </div>
                </div>
            </div>
            </div>
        </div>
    );
};

const Refunds: React.FC = () => {
    const [refunds, setRefunds] = useState<RefundRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('ALL');
    const [processing, setProcessing] = useState<string | null>(null);
    const [selectedRefund, setSelectedRefund] = useState<RefundRow | null>(null);

    useEffect(() => {
        const unsubscribe = paymentService.subscribeToRefunds((data) => {
            setRefunds(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const processingRefunds = refunds.filter((refund: RefundRow) => {
            const normalizedStatus = getNormalizedRefundStatus(refund);
            return !isPendingApproval(refund) && ['PROCESSING', 'ONHOLD'].includes(normalizedStatus);
        });

        if (!processingRefunds.length) return;

        let cancelled = false;

        const syncRefunds = async () => {
            const syncTargets = processingRefunds.map((refund) =>
                paymentService.syncRefund({
                    refundId: refund.id,
                    paymentId: refund.payment_id,
                    bookingId: refund.booking_id
                }).catch((error) => {
                    if (!cancelled) {
                        console.error('[Refunds] Silent refund sync failed:', error);
                    }
                    return null;
                })
            );

            await Promise.allSettled(syncTargets);
        };

        void syncRefunds();
        const timer = window.setInterval(() => {
            void syncRefunds();
        }, 5000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [refunds]);

    const filteredRefunds = useMemo(() => {
        return refunds.filter((refund: RefundRow) => {
            if (filterStatus === 'ALL') return true;
            const normalizedStatus = getNormalizedRefundStatus(refund);
            const rawStatus = getRawRefundStatus(refund);

            if (filterStatus === 'PENDING') {
                return rawStatus === 'PENDING';
            }

            if (filterStatus === 'ONHOLD') {
                return normalizedStatus === 'ONHOLD' || rawStatus === 'ONHOLD';
            }

            if (filterStatus === 'PROCESSING') {
                return rawStatus !== 'PENDING' && normalizedStatus === 'PROCESSING';
            }

            return normalizedStatus === filterStatus;
        });
    }, [filterStatus, refunds]);

    const stats = useMemo(() => ({
        total: refunds.length,
        pending: refunds.filter((refund: RefundRow) => isPendingApproval(refund)).length,
        onHold: refunds.filter((refund: RefundRow) => isRefundOnHold(refund)).length,
        processing: refunds.filter((refund: RefundRow) => !isPendingApproval(refund) && getNormalizedRefundStatus(refund) === 'PROCESSING').length,
        success: refunds.filter((refund: RefundRow) => getNormalizedRefundStatus(refund) === 'SUCCESS').length,
        failed: refunds.filter((refund: RefundRow) => getNormalizedRefundStatus(refund) === 'FAILED').length,
        totalAmount: refunds
            .filter((refund: RefundRow) => getNormalizedRefundStatus(refund) === 'SUCCESS')
            .reduce((accumulator: number, refund: RefundRow) => accumulator + Number(refund.refund_amount || 0), 0)
    }), [refunds]);

    const handleApproveRefund = async (refund: RefundRow, input: {
        refundAmount: number;
        commissionAmount: number;
        refundReason: string;
    }) => {
        setProcessing(refund.id);
        try {
            const result = await paymentService.processRefund({
                refundId: refund.id,
                paymentId: refund.payment_id,
                bookingId: refund.booking_id,
                reason: refund.reason || 'Booking rejected',
                refundReason: input.refundReason,
                refundAmount: input.refundAmount,
                commissionAmount: input.commissionAmount
            });

            if (result.success) {
                toast.success('Refund sent to Cashfree. Final result will update after backend verification.');
                setSelectedRefund(null);
            } else {
                toast.error(result.error || 'Refund processing failed');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Refund processing failed';
            toast.error(message);
            console.error('[Refunds] Error processing refund:', error);
        } finally {
            setProcessing(null);
        }
    };

    const handleRejectRefund = async (refund: RefundRow, reason: string) => {
        setProcessing(refund.id);
        try {
            const result = await paymentService.rejectRefund({
                refundId: refund.id,
                paymentId: refund.payment_id,
                bookingId: refund.booking_id,
                reason
            });

            if (result.success) {
                toast.success('Refund request rejected.');
                setSelectedRefund(null);
            } else {
                toast.error(result.error || 'Refund rejection failed');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Refund rejection failed';
            toast.error(message);
            console.error('[Refunds] Error rejecting refund:', error);
        } finally {
            setProcessing(null);
        }
    };

    const exportToCSV = () => {
        const headers = ['Refund ID', 'Booking ID', 'Customer', 'Property', 'Paid Amount', 'Refund Amount', 'Commission', 'Status', 'Date'];
        const csvData = filteredRefunds.map((refund: RefundRow) => [
            refund.id,
            refund.booking_id,
            refund.bookings?.customer_name || '',
            refund.bookings?.properties?.title || '',
            getPaidAmount(refund),
            refund.refund_amount,
            refund.commission_amount ?? 0,
            getDisplayStatus(refund),
            new Date(refund.created_at).toLocaleDateString()
        ]);

        const csvContent = [headers, ...csvData].map((row) => row.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'refunds_report.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Refund Monitoring</h1>
                    <p className="text-sm text-gray-500">Track refunds that start only after an admin-reviewed reject or cancel decision.</p>
                </div>
                <button
                    onClick={exportToCSV}
                    className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-bold text-white shadow-lg transition-all hover:bg-black"
                >
                    Export CSV
                </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total Refunds</p>
                    <p className="text-2xl font-black text-gray-900">{stats.total}</p>
                    <p className="mt-1 text-xs text-gray-400">{stats.pending} pending approval</p>
                </div>
                <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-orange-500">Processing</p>
                    <p className="text-2xl font-black text-orange-700">{stats.processing}</p>
                    <p className="mt-1 text-xs text-orange-600/80">Gateway processing only</p>
                </div>
                <div className="rounded-xl border border-yellow-100 bg-yellow-50 p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-600">On Hold</p>
                    <p className="text-2xl font-black text-yellow-700">{stats.onHold}</p>
                    <p className="mt-1 text-xs text-yellow-700/80">Awaiting gateway release</p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Successful</p>
                    <p className="text-2xl font-black text-blue-700">INR {stats.totalAmount.toLocaleString('en-IN')}</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-red-50 p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">Failed</p>
                    <p className="text-2xl font-black text-red-700">{stats.failed}</p>
                </div>
            </div>

            <div className="flex w-fit gap-2 rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
                {[
                    { value: 'ALL', label: 'ALL' },
                    { value: 'PENDING', label: 'PENDING APPROVAL' },
                    { value: 'PROCESSING', label: 'PROCESSING' },
                    { value: 'ONHOLD', label: 'ON HOLD' },
                    { value: 'SUCCESS', label: 'SUCCESS' },
                    { value: 'FAILED', label: 'FAILED' }
                ].map((status) => (
                    <button
                        key={status.value}
                        onClick={() => setFilterStatus(status.value)}
                        className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${filterStatus === status.value ? 'bg-[var(--rf-color-action)] text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        {status.label}
                    </button>
                ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                            <th className="p-4">Customer</th>
                            <th className="p-4">Property</th>
                            <th className="p-4 text-center">Paid / Refund</th>
                            <th className="p-4 text-center">Status</th>
                            <th className="p-4">Date Initiated</th>
                            <th className="p-4 text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {filteredRefunds.map((refund: RefundRow) => (
                            <tr key={refund.id} className="transition-colors hover:bg-gray-50/50">
                                <td className="p-4">
                                    <p className="text-sm font-bold text-gray-900">{refund.bookings?.customer_name || 'Unknown'}</p>
                                    <p className="text-[10px] font-medium text-gray-400">BKR-{refund.booking_id.slice(0, 8).toUpperCase()}</p>
                                </td>
                                <td className="p-4 text-sm font-medium text-gray-600">
                                    {refund.bookings?.properties?.title || '-'}
                                </td>
                                <td className="p-4 text-center">
                                    <div className="space-y-1">
                                        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Paid INR {getPaidAmount(refund).toLocaleString('en-IN')}</p>
                                        <p className="text-sm font-bold text-gray-900">Refund INR {Number(refund.refund_amount || 0).toLocaleString('en-IN')}</p>
                                        {Number(refund.commission_amount || 0) > 0 && (
                                            <p className="text-[11px] font-semibold text-orange-600">Commission INR {Number(refund.commission_amount || 0).toLocaleString('en-IN')}</p>
                                        )}
                                        {getRefundBookingSummary(refund)?.usesStructuredTaxes && (
                                            <p className="text-[11px] font-semibold text-slate-500">
                                                Owner share INR {getRefundBookingSummary(refund)!.ownerGrossAmount.toLocaleString('en-IN')}
                                            </p>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4 text-center">
                                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${getStatusTone(refund)}`}>
                                        {getDisplayStatus(refund)}
                                    </span>
                                </td>
                                <td className="p-4 text-sm font-medium text-gray-500">
                                    {new Date(refund.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </td>
                                <td className="p-4 text-center">
                                    {canReviewRefund(refund) ? (
                                        <button
                                            onClick={() => setSelectedRefund(refund)}
                                            disabled={processing === refund.id}
                                            className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {processing === refund.id ? 'Updating...' : 'Review'}
                                        </button>
                                    ) : (
                                        <span className="text-xs text-gray-400">-</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {filteredRefunds.length === 0 && !loading && (
                            <tr>
                                <td colSpan={6} className="p-20 text-center">
                                    <div className="flex flex-col items-center">
                                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-50">
                                            <svg className="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                        </div>
                                        <p className="text-xs font-bold uppercase tracking-widest text-gray-400">No refunds found</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedRefund && (
                <RefundApprovalModal
                    key={selectedRefund.id}
                    refund={selectedRefund}
                    busy={processing === selectedRefund.id}
                    onClose={() => setSelectedRefund(null)}
                    onApprove={(input) => handleApproveRefund(selectedRefund, input)}
                    onReject={(reason) => handleRejectRefund(selectedRefund, reason)}
                />
            )}
        </div>
    );
};

export default Refunds;
