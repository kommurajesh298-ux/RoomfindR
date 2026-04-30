import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import toast from 'react-hot-toast';
import type { Booking, MonthlyPayment } from '../../../types/booking.types';
import type { Property } from '../../../types/property.types';
import { bookingService } from '../../../services/booking.service';
import { paymentService } from '../../../services/payment.service';
import PaymentErrorOverlay from '../../payments/PaymentErrorOverlay';
import { supabase } from '../../../services/supabase-config';
import { buildActualMonthlyPaymentHistory } from '../../../utils/booking.utils';
import { resolveRentCoverageSummary } from '../../../utils/rent-coverage';

import { format, addMonths } from 'date-fns';
import { FaCheckCircle, FaClock, FaArrowRight, FaCalendarAlt } from 'react-icons/fa';

interface PaymentsTabProps {
    booking: Booking;
    property: Property;
}

const isSettledRentStatus = (status?: string | null): boolean =>
    ['paid', 'completed'].includes(String(status || '').trim().toLowerCase());

const PaymentsTab = ({ booking, property }: PaymentsTabProps) => {
    const { currentUser } = useAuth();
    const navigate = useNavigate();
    const [payments, setPayments] = useState<MonthlyPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const [showPaymentError, setShowPaymentError] = useState(false);
    const [rentCycleStartDate, setRentCycleStartDate] = useState(booking.currentCycleStartDate || '');
    const [rentCycleStartMonth, setRentCycleStartMonth] = useState('');
    const [rentCanPay, setRentCanPay] = useState(false);
    const [nextDueDate, setNextDueDate] = useState(booking.nextDueDate || '');
    const [today, setToday] = useState(() => new Date());

    const refreshRentCycle = useCallback(async () => {
        try {
            const cycle = await bookingService.getBookingRentCycle(booking.bookingId);
            if (!cycle) return;
            setRentCanPay(cycle.canPayRent);
            setRentCycleStartDate(cycle.effectiveCycleStartDate || cycle.currentCycleStartDate || '');
            setRentCycleStartMonth(
                (cycle.effectiveCycleStartDate || cycle.currentCycleStartDate)
                    ? format(new Date(cycle.effectiveCycleStartDate || cycle.currentCycleStartDate || ''), 'yyyy-MM')
                    : ''
            );
            setNextDueDate(cycle.effectiveNextDueDate || cycle.nextDueDate || '');
        } catch (error) {
            if (import.meta.env.DEV) {
                console.warn('[PaymentsTab] Failed to refresh rent cycle:', error);
            }
        }
    }, [booking.bookingId]);

    useEffect(() => {
        let active = true;

        const unsubscribe = bookingService.subscribeToMonthlyPayments(booking.bookingId, (data) => {
            if (!active) return;
            setPayments(data);
            void refreshRentCycle().finally(() => {
                if (active) setLoading(false);
            });
        });

        const bookingChannel = supabase
            .channel(`customer-rent-cycle-${booking.bookingId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'bookings',
                filter: `id=eq.${booking.bookingId}`
            }, () => {
                void refreshRentCycle();
            })
            .subscribe();

        void refreshRentCycle();

        return () => {
            active = false;
            unsubscribe();
            supabase.removeChannel(bookingChannel);
        };
    }, [booking.bookingId, refreshRentCycle]);

    useEffect(() => {
        let dailyInterval: number | null = null;
        const now = new Date();
        const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const timeoutMs = Math.max(nextMidnight.getTime() - now.getTime(), 1000);

        const timeoutId = window.setTimeout(() => {
            setToday(new Date());
            dailyInterval = window.setInterval(() => {
                setToday(new Date());
            }, 24 * 60 * 60 * 1000);
        }, timeoutMs);

        return () => {
            window.clearTimeout(timeoutId);
            if (dailyInterval) {
                window.clearInterval(dailyInterval);
            }
        };
    }, []);

    const historyPayments = useMemo(
        () => buildActualMonthlyPaymentHistory(payments),
        [payments]
    );

    const pendingPayment = useMemo(
        () => historyPayments.find((payment) => payment.status === 'pending') || null,
        [historyPayments]
    );

    const failedPayment = useMemo(
        () => historyPayments.find((payment) => payment.status === 'failed') || null,
        [historyPayments]
    );

    const rentCoverage = useMemo(() => resolveRentCoverageSummary({
        status: booking.status,
        stayStatus: booking.stayStatus,
        vacateDate: booking.vacateDate,
        paymentType: booking.paymentType,
        paymentStatus: booking.paymentStatus,
        durationMonths: booking.durationMonths,
        payments: historyPayments,
        cycleNextDueDate: nextDueDate,
        bookingNextDueDate: booking.nextDueDate,
        legacyNextPaymentDate: booking.nextPaymentDate,
        currentCycleStartDate: rentCycleStartDate || booking.currentCycleStartDate || null,
        checkInDate: booking.checkInDate || null,
        startDate: booking.startDate,
        cycleDurationDays: booking.cycleDurationDays,
        today,
    }), [
        booking.checkInDate,
        booking.currentCycleStartDate,
        booking.cycleDurationDays,
        booking.durationMonths,
        booking.nextDueDate,
        booking.nextPaymentDate,
        booking.paymentStatus,
        booking.paymentType,
        booking.startDate,
        booking.stayStatus,
        booking.status,
        booking.vacateDate,
        historyPayments,
        nextDueDate,
        rentCycleStartDate,
        today,
    ]);

    const currentCycleMonth = useMemo(() => {
        if (rentCoverage.currentCycleMonth) return rentCoverage.currentCycleMonth;
        if (rentCycleStartMonth) return rentCycleStartMonth;
        if (rentCycleStartDate) {
            return format(new Date(rentCycleStartDate), 'yyyy-MM');
        }
        if (booking.currentCycleStartDate) {
            return format(new Date(booking.currentCycleStartDate), 'yyyy-MM');
        }
        return '';
    }, [booking.currentCycleStartDate, rentCoverage.currentCycleMonth, rentCycleStartDate, rentCycleStartMonth]);

    const currentCyclePayment = useMemo(
        () => historyPayments.find((item) => item.month === currentCycleMonth) || null,
        [currentCycleMonth, historyPayments]
    );

    const latestVerifiedPayment = useMemo(
        () => historyPayments.find((payment) => payment.status === 'paid' || payment.status === 'completed') || null,
        [historyPayments]
    );

    const isCurrentCycleSettled = useMemo(() => {
        if (rentCoverage.isCurrentCycleSettled) {
            return true;
        }

        if (currentCyclePayment && isSettledRentStatus(currentCyclePayment.status)) {
            return true;
        }

        return Boolean(
            currentCycleMonth
            && latestVerifiedPayment
            && latestVerifiedPayment.month === currentCycleMonth
            && isSettledRentStatus(latestVerifiedPayment.status)
        );
    }, [currentCycleMonth, currentCyclePayment, latestVerifiedPayment, rentCoverage.isCurrentCycleSettled]);

    const isVerificationPending = currentCyclePayment?.status === 'pending';
    const retryTargetPayment = currentCyclePayment?.status === 'failed'
        ? currentCyclePayment
        : (!currentCyclePayment && failedPayment ? failedPayment : null);
    const canRetryCurrentCycle = Boolean(retryTargetPayment);
    const canStartCurrentCyclePayment = rentCanPay
        && !rentCoverage.isPrepaidFullStay
        && !isVerificationPending
        && !canRetryCurrentCycle
        && !isCurrentCycleSettled;
    const actionableCycleMonth = currentCycleMonth || retryTargetPayment?.month || pendingPayment?.month || '';

    const effectiveDueDate = rentCoverage.effectiveNextDueDate;

    const currentCycleLabel = useMemo(() => {
        const cycleStart = rentCoverage.effectiveCycleStartDate
            ? format(rentCoverage.effectiveCycleStartDate, 'yyyy-MM-dd')
            : (rentCycleStartDate || booking.currentCycleStartDate || '');
        const cycleEnd = effectiveDueDate;

        if (cycleStart && cycleEnd) {
            return `${format(new Date(cycleStart), 'dd MMM yyyy')} - ${format(cycleEnd, 'dd MMM yyyy')}`;
        }

        if (actionableCycleMonth) {
            return format(new Date(`${actionableCycleMonth}-01T00:00:00`), 'MMMM yyyy');
        }

        return 'Current cycle';
    }, [actionableCycleMonth, booking.currentCycleStartDate, effectiveDueDate, rentCoverage.effectiveCycleStartDate, rentCycleStartDate]);

    const dueDaysRemaining = rentCoverage.dueDaysRemaining;

    const fullStayHistory = useMemo(() => {
        if (!rentCoverage.isPrepaidFullStay || !rentCoverage.effectiveCycleStartDate) {
            return [] as MonthlyPayment[];
        }

        const monthsCovered = Math.max(1, Number(booking.durationMonths || 0) || 1);
        const paidAt = booking.createdAt || booking.startDate;

        return Array.from({ length: monthsCovered }, (_, index) => ({
            paymentId: `full-stay-${booking.bookingId}-${index}`,
            bookingId: booking.bookingId,
            month: format(addMonths(rentCoverage.effectiveCycleStartDate as Date, monthsCovered - index - 1), 'yyyy-MM'),
            amount: Number(property.pricePerMonth || booking.monthlyRent || 0),
            paidAt,
            status: 'paid' as const,
            metadata: {
                payment_type: 'full',
                covered_months: monthsCovered,
            },
        }));
    }, [
        booking.bookingId,
        booking.createdAt,
        booking.durationMonths,
        booking.monthlyRent,
        booking.startDate,
        property.pricePerMonth,
        rentCoverage.effectiveCycleStartDate,
        rentCoverage.isPrepaidFullStay,
    ]);

    const paymentHistoryRows = rentCoverage.isPrepaidFullStay && !historyPayments.length
        ? fullStayHistory
        : historyPayments;

    useEffect(() => {
        if (!currentCyclePayment || currentCyclePayment.status !== 'pending') return;

        let active = true;
        const verifyPendingCycle = async () => {
            const verify = await paymentService.verifyPaymentStatus({
                bookingId: booking.bookingId,
                orderId: currentCyclePayment.orderId,
                paymentType: 'monthly',
                metadata: { month: currentCyclePayment.month || currentCycleMonth }
            });

            if (!active || verify?.status !== 'failed') return;

            setPayments((previous) => previous.map((payment) => (
                payment.month === (currentCyclePayment.month || currentCycleMonth)
                    ? { ...payment, status: 'failed' }
                    : payment
            )));
        };

        void verifyPendingCycle();

        return () => {
            active = false;
        };
    }, [booking.bookingId, currentCycleMonth, currentCyclePayment]);

    useEffect(() => {
        if (!currentCycleMonth || !isCurrentCycleSettled || !rentCanPay) return;

        let active = true;

        const reconcileSettledCycle = async () => {
            const verify = await paymentService.verifyPaymentStatus({
                bookingId: booking.bookingId,
                paymentType: 'monthly',
                metadata: { month: currentCycleMonth },
                forceServer: true,
            });

            if (!active || verify?.status !== 'paid') return;
            await refreshRentCycle();
        };

        void reconcileSettledCycle();

        return () => {
            active = false;
        };
    }, [booking.bookingId, currentCycleMonth, isCurrentCycleSettled, refreshRentCycle, rentCanPay]);

    const handlePayRent = async (monthStr: string) => {
        if (!currentUser) return;

        setProcessing(true);
        try {
            const verify = await paymentService.verifyPaymentStatus({
                bookingId: booking.bookingId,
                paymentType: 'monthly',
                metadata: { month: monthStr },
                forceServer: true,
            });
            if (verify?.status === 'paid') {
                toast('This rent cycle is already verified. Refreshing the timeline.', { icon: 'i' });
                await refreshRentCycle();
                return;
            }

            const params = new URLSearchParams();
            params.set('booking_id', booking.bookingId);
            params.set('context', 'rent');
            params.set('month', monthStr);
            params.set('amount', String(property.pricePerMonth));
            params.set('app', String(import.meta.env.VITE_APP_TYPE || 'customer').toLowerCase());

            navigate(`/payment?${params.toString()}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Payment initiation failed';
            toast.error(msg);
            setPaymentError(msg);
            setShowPaymentError(true);
        } finally {
            setProcessing(false);
        }
    };

    const joinedDateRaw = booking.startDate ? new Date(booking.startDate) : new Date();
    const joinedDate = isNaN(joinedDateRaw.getTime()) ? new Date() : joinedDateRaw;

    const currentPaymentSummary = useMemo(() => {
        if (isVerificationPending) {
            return {
                accent: 'text-blue-700',
                background: 'bg-blue-50 border-blue-100',
                detailAccent: 'text-blue-700/80',
                label: 'Payment Status',
                value: 'Verification in progress',
                detail: 'We are checking your latest rent payment with Cashfree and the backend. This screen will refresh automatically after confirmation.',
            };
        }

        if (isCurrentCycleSettled) {
            const paidPayment = currentCyclePayment && isSettledRentStatus(currentCyclePayment.status)
                ? currentCyclePayment
                : latestVerifiedPayment;
            const paidOn = paidPayment?.paidAt ? format(new Date(paidPayment.paidAt), 'dd MMM yyyy') : '';

            return {
                accent: 'text-emerald-700',
                background: 'bg-emerald-50 border-emerald-100',
                detailAccent: 'text-emerald-700/80',
                label: 'Payment Received',
                value: paidOn ? `Paid on ${paidOn}` : 'Current cycle verified',
                detail: effectiveDueDate
                    ? `This rent cycle is already verified. Your next rent window opens on ${format(effectiveDueDate, 'dd MMM yyyy')}.`
                    : 'This rent cycle is already verified.',
            };
        }

        if (rentCoverage.isPrepaidFullStay) {
            const monthsCovered = Math.max(1, Number(booking.durationMonths || 0) || 1);
            const coveredMonthLabel = rentCoverage.coveredThroughMonth
                ? format(new Date(`${rentCoverage.coveredThroughMonth}-01T00:00:00`), 'MMMM yyyy')
                : `${monthsCovered} month${monthsCovered === 1 ? '' : 's'}`;

            return {
                accent: 'text-emerald-700',
                background: 'bg-emerald-50 border-emerald-100',
                detailAccent: 'text-emerald-700/80',
                label: 'Full Stay Covered',
                value: `${monthsCovered} month${monthsCovered === 1 ? '' : 's'} paid`,
                detail: effectiveDueDate
                    ? `This booking was prepaid in full. Coverage runs through ${coveredMonthLabel}, and the next rent window opens on ${format(effectiveDueDate, 'dd MMM yyyy')}.`
                    : `This booking was prepaid in full and is covered through ${coveredMonthLabel}.`,
            };
        }

        if (canStartCurrentCyclePayment && !latestVerifiedPayment && !currentCyclePayment) {
            return {
                accent: 'text-red-700',
                background: 'bg-red-50 border-red-100',
                detailAccent: 'text-red-700/80',
                label: 'Current Rent Cycle',
                value: currentCycleLabel,
                detail: 'No verified rent payment has been received for this cycle yet.',
            };
        }

        if (!effectiveDueDate) {
            return {
                accent: 'text-slate-700',
                background: 'bg-slate-50 border-slate-100',
                detailAccent: 'text-slate-600',
                label: 'Payment Status',
                value: 'Due date will appear soon',
                detail: 'We will show the next rent due date here as soon as the current cycle is ready.',
            };
        }

        const dueDateLabel = format(effectiveDueDate, 'dd MMM yyyy');
        const dayText = dueDaysRemaining === 1 ? 'day' : 'days';

        if (canRetryCurrentCycle || canStartCurrentCyclePayment) {
            if ((dueDaysRemaining ?? 0) < 0) {
                return {
                    accent: 'text-red-700',
                    background: 'bg-red-50 border-red-100',
                    detailAccent: 'text-red-700/80',
                    label: 'Payment Due',
                    value: `${Math.abs(dueDaysRemaining ?? 0)} ${Math.abs(dueDaysRemaining ?? 0) === 1 ? 'day' : 'days'} overdue`,
                    detail: `Rent for ${currentCycleLabel} was due on ${dueDateLabel}. Complete the payment now to keep your booking up to date.`,
                };
            }

            if ((dueDaysRemaining ?? 0) === 0) {
                return {
                    accent: 'text-red-700',
                    background: 'bg-red-50 border-red-100',
                    detailAccent: 'text-red-700/80',
                    label: 'Payment Due',
                    value: 'Due today',
                    detail: `Rent for ${currentCycleLabel} must be completed today, ${dueDateLabel}.`,
                };
            }

            return {
                accent: 'text-red-700',
                background: 'bg-red-50 border-red-100',
                detailAccent: 'text-red-700/80',
                label: 'Payment Due',
                value: `${dueDaysRemaining} ${dayText} left`,
                detail: `Rent for ${currentCycleLabel} is due on ${dueDateLabel}. This countdown updates automatically every day.`,
            };
        }

        if ((dueDaysRemaining ?? 0) > 5) {
            return {
                accent: 'text-emerald-700',
                background: 'bg-emerald-50 border-emerald-100',
                detailAccent: 'text-emerald-700/80',
                label: 'Next Rent Window',
                value: `${dueDaysRemaining} days remaining`,
                detail: `Your next rent due date is ${dueDateLabel}. The countdown changes automatically each day until payment opens.`,
            };
        }

        if ((dueDaysRemaining ?? 0) > 1) {
            return {
                accent: 'text-amber-700',
                background: 'bg-amber-50 border-amber-100',
                detailAccent: 'text-amber-700/80',
                label: 'Next Rent Window',
                value: `${dueDaysRemaining} days remaining`,
                detail: `Your next rent due date is ${dueDateLabel}. The payment window is getting closer, and the countdown updates daily.`,
            };
        }

        if ((dueDaysRemaining ?? 0) === 1) {
            return {
                accent: 'text-red-700',
                background: 'bg-red-50 border-red-100',
                detailAccent: 'text-red-700/80',
                label: 'Next Rent Window',
                value: '1 day remaining',
                detail: `Your next rent due date is tomorrow, ${dueDateLabel}. The payment window will open automatically.`,
            };
        }

        if ((dueDaysRemaining ?? 0) === 0) {
            return {
                accent: 'text-orange-700',
                background: 'bg-orange-50 border-orange-100',
                detailAccent: 'text-orange-700/80',
                label: 'Next Rent Window',
                value: 'Opens today',
                detail: `Your next rent due date is today, ${dueDateLabel}. You can start the payment now.`,
            };
        }

        if (latestVerifiedPayment?.paidAt) {
            return {
                accent: 'text-slate-700',
                background: 'bg-slate-50 border-slate-100',
                detailAccent: 'text-slate-600',
                label: 'Last Verified Payment',
                value: `Paid on ${format(new Date(latestVerifiedPayment.paidAt), 'dd MMM yyyy')}`,
                detail: `Your next rent due date was ${dueDateLabel}. This space will keep updating automatically for the current cycle.`,
            };
        }

        return {
            accent: 'text-slate-700',
            background: 'bg-slate-50 border-slate-100',
            detailAccent: 'text-slate-600',
            label: 'Payment Status',
            value: 'Waiting for due date',
            detail: 'Your rent timeline will appear here once the current booking cycle is ready.',
        };
    }, [
        canRetryCurrentCycle,
        canStartCurrentCyclePayment,
        currentCycleLabel,
        dueDaysRemaining,
        effectiveDueDate,
        isVerificationPending,
        isCurrentCycleSettled,
        latestVerifiedPayment,
        currentCyclePayment,
        booking.durationMonths,
        rentCoverage.coveredThroughMonth,
        rentCoverage.isPrepaidFullStay,
    ]);

    if (loading) {
        return <div className="p-8 flex justify-center"><div className="w-8 h-8 border-4 border-[#2563eb] border-t-transparent rounded-full animate-spin" /></div>;
    }

    return (
        <div className="p-4 space-y-4 font-['Inter',_sans-serif]">
            <div className="grid grid-cols-2 gap-3">
                <div className="h-[84px] bg-white rounded-[14px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <FaCalendarAlt className="text-[#2563eb]" size={18} />
                    <div>
                        <p className="text-[11px] text-[#6B7280] font-medium leading-none mb-1 uppercase tracking-widest">Joined Date</p>
                        <p className="text-[15px] font-semibold text-[#111827] leading-none">{format(joinedDate, 'dd MMM yyyy')}</p>
                    </div>
                </div>

                <div className="h-[84px] bg-white rounded-[14px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <FaClock className="text-orange-500" size={18} />
                    <div>
                        <p className="text-[11px] text-[#6B7280] font-medium leading-none mb-1 uppercase tracking-widest">Rent/Month</p>
                        <p className="text-[15px] font-semibold text-[#111827] leading-none">INR {property.pricePerMonth.toLocaleString()}</p>
                    </div>
                </div>

                <div className="h-[84px] bg-white rounded-[14px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <FaCalendarAlt className={(canRetryCurrentCycle || canStartCurrentCyclePayment) ? 'text-red-500' : 'text-blue-500'} size={18} />
                    <div>
                        <p className="text-[11px] text-[#6B7280] font-bold leading-none mb-1 uppercase tracking-widest">
                            {rentCoverage.isPrepaidFullStay
                                ? 'Covered Until'
                                : (canRetryCurrentCycle || canStartCurrentCyclePayment)
                                    ? 'Due Date'
                                    : 'Next Due'}
                        </p>
                        <p className={`text-[15px] font-black leading-none ${(canRetryCurrentCycle || canStartCurrentCyclePayment) ? 'text-red-600' : 'text-[#111827]'}`}>
                            {rentCoverage.isPrepaidFullStay && rentCoverage.coveredThroughDate
                                ? format(rentCoverage.coveredThroughDate, 'dd MMM yyyy')
                                : effectiveDueDate
                                ? format(effectiveDueDate, 'dd MMM yyyy')
                                : (canRetryCurrentCycle || canStartCurrentCyclePayment)
                                    ? format(new Date(nextDueDate || booking.nextDueDate || new Date().toISOString()), 'dd MMM yyyy')
                                    : format(addMonths(new Date(), 1), 'dd MMM yyyy')
                            }
                        </p>
                    </div>
                </div>

                <div className="h-[84px] bg-white rounded-[14px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <FaArrowRight className="text-purple-500" size={18} />
                    <div>
                        <p className="text-[11px] text-[#6B7280] font-medium leading-none mb-1 uppercase tracking-widest">Deposit</p>
                        <p className="text-[15px] font-semibold text-[#111827] leading-none">INR {booking.advancePaid.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-[18px] border border-gray-100 shadow-sm p-5 space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-[16px] font-bold text-[#111827]">Current Payment</h3>
                    {isVerificationPending ? (
                        <div className="flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Verification Pending</span>
                        </div>
                    ) : isCurrentCycleSettled ? (
                        <div className="flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Paid</span>
                        </div>
                    ) : canRetryCurrentCycle || canStartCurrentCyclePayment ? (
                        <div className="flex items-center gap-1.5 bg-red-50 px-2 py-1 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                            <span className="text-[10px] font-black text-red-600 uppercase tracking-widest">Action Required</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Not Due Yet</span>
                        </div>
                    )}
                </div>

                <div className={`rounded-[16px] border p-4 ${currentPaymentSummary.background}`}>
                    <div className="flex items-start gap-3">
                        <div className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-white ${currentPaymentSummary.accent}`}>
                            {isVerificationPending ? (
                                <FaClock className="animate-pulse" size={16} />
                            ) : (
                                <FaCalendarAlt size={16} />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${currentPaymentSummary.accent}`}>
                                {currentPaymentSummary.label}
                            </p>
                            <p className={`mt-1 text-[18px] font-black leading-tight ${currentPaymentSummary.accent}`}>
                                {currentPaymentSummary.value}
                            </p>
                            <p className={`mt-1 text-[13px] font-semibold leading-5 ${currentPaymentSummary.detailAccent}`}>
                                {currentPaymentSummary.detail}
                            </p>
                        </div>
                    </div>
                </div>

                {(canRetryCurrentCycle || canStartCurrentCyclePayment) && (
                    <div className="space-y-4">
                        <div className="bg-red-50/30 border border-red-100 rounded-xl p-3">
                            <p className="text-[11px] text-red-600/80 font-bold uppercase tracking-widest mb-1">Billing Period</p>
                            <p className="text-[15px] font-black text-red-700">{currentCycleLabel}</p>
                            <p className="text-[12px] text-red-600 font-medium mt-1">
                                Complete the current rent cycle to keep future payments and due dates moving normally.
                            </p>
                        </div>

                        <button
                            onClick={() => handlePayRent(actionableCycleMonth)}
                            disabled={processing || !actionableCycleMonth}
                            className="w-full h-[52px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[15px] font-bold rounded-[14px] flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            {processing
                                ? 'Processing...'
                                : canRetryCurrentCycle
                                    ? `Retry Rent Payment INR ${property.pricePerMonth.toLocaleString()}`
                                    : `Pay Rent INR ${property.pricePerMonth.toLocaleString()}`}
                            {!processing && <FaArrowRight size={14} />}
                        </button>
                    </div>
                )}
            </div>

            <div>
                <h3 className="text-[16px] font-semibold text-[#111827] mb-4 px-1">Payment History</h3>
                <div className="space-y-3">
                    {paymentHistoryRows.map((payment) => (
                        <div key={payment.month} className="bg-white rounded-[18px] border border-gray-100 p-4 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className={`w-[40px] h-[40px] rounded-[12px] flex items-center justify-center shrink-0 ${payment.status === 'paid' || payment.status === 'completed' ? 'bg-blue-50 text-blue-600' : payment.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                                    {payment.status === 'paid' || payment.status === 'completed' ? <FaCheckCircle size={16} /> : <FaClock size={16} />}
                                </div>
                                <div>
                                    <p className="text-[15px] font-semibold text-[#111827] leading-tight">
                                        {format(new Date(`${payment.month}-01T00:00:00`), 'MMMM yyyy')}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${
                                            payment.status === 'paid' || payment.status === 'completed'
                                                ? 'text-blue-600'
                                                : payment.status === 'failed'
                                                    ? 'text-red-500'
                                                    : 'text-amber-600'
                                        }`}>
                                            {payment.status}
                                        </span>
                                        {(payment.status === 'paid' || payment.status === 'completed') && payment.paidAt && (
                                            <span className="text-[11px] text-[#6B7280]">
                                                Paid {format(new Date(payment.paidAt), 'dd MMM')}
                                            </span>
                                        )}
                                        {rentCoverage.isPrepaidFullStay && (
                                            <span className="text-[11px] text-emerald-600 font-semibold">
                                                Full stay coverage
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[14px] font-black text-[#111827]">INR {Number(payment.amount || property.pricePerMonth || 0).toLocaleString()}</p>
                                <p className="text-[10px] text-[#94A3B8] font-bold uppercase">Rent</p>
                            </div>
                        </div>
                    ))}
                    {!paymentHistoryRows.length && (
                        <div className="bg-white rounded-[18px] border border-dashed border-slate-200 p-5 text-center text-slate-500 shadow-sm">
                            <p className="text-[14px] font-semibold text-slate-700">No verified rent payments yet</p>
                            <p className="mt-1 text-[12px]">
                                Monthly rent will appear here only after a real Cashfree payment is verified by the backend.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <PaymentErrorOverlay
                open={showPaymentError}
                message={paymentError || 'Payment could not be started. Please try again.'}
                onClose={() => setShowPaymentError(false)}
                onGoBookings={() => {
                    setShowPaymentError(false);
                    window.location.href = '/bookings';
                }}
                onViewDetails={() => {
                    const params = new URLSearchParams();
                    if (paymentError) params.set('message', paymentError);
                    params.set('context', 'payments_tab');
                    window.location.href = `/payment/error?${params.toString()}`;
                }}
            />
        </div>
    );
};

export default PaymentsTab;
