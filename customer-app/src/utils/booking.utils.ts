import { addMonths, differenceInMonths, format } from 'date-fns';
import type { CancellationPolicy, MonthlyPayment } from '../types/booking.types';

export const getStatusColor = (status: string): string => {
    const normalizedStatus = status.toLowerCase();
    const colors: Record<string, string> = {
        requested: 'bg-amber-100 text-amber-700 border-amber-200',
        pending: 'bg-amber-100 text-amber-700 border-amber-200',
        payment_pending: 'bg-slate-100 text-slate-700 border-slate-200 animate-pulse',
        payment_failed: 'bg-rose-100 text-rose-700 border-rose-200',
        accepted: 'bg-orange-100 text-orange-700 border-orange-200',
        approved: 'bg-orange-100 text-orange-700 border-orange-200',
        cancelled: 'bg-rose-100 text-rose-700 border-rose-200',
        'checked-in': 'bg-blue-100 text-blue-700 border-blue-200',
        'checked_in': 'bg-blue-100 text-blue-700 border-blue-200',
        'checked-out': 'bg-slate-100 text-slate-700 border-slate-200',
        checked_out: 'bg-slate-100 text-slate-700 border-slate-200',
        rejected: 'bg-rose-100 text-rose-700 border-rose-200',
        completed: 'bg-blue-100 text-blue-700 border-blue-200',
        cancelled_by_customer: 'bg-orange-100 text-orange-700 border-orange-200',
        vacate_requested: 'bg-orange-100 text-orange-700 border-orange-200',
        refunded: 'bg-blue-100 text-blue-700 border-blue-200',
        paid: 'bg-blue-100 text-blue-700 border-blue-200',
        failed: 'bg-rose-100 text-rose-700 border-rose-200',
        payment_refunded: 'bg-blue-100 text-blue-700 border-blue-200'
    };

    return colors[normalizedStatus] || colors[status] || 'bg-slate-100 text-slate-700';
};

export const calculateCancellationPolicy = (): CancellationPolicy => {
    const fixedFee = 20.00;

    return {
        canCancel: true,
        isFree: false,
        penaltyAmount: fixedFee,
        reason: 'A standard platform cancellation fee of Rs20 applies to all cancellations.'
    };
};

export const formatBookingDates = (startDate: string, endDate: string): string => {
    const start = new Date(startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const end = new Date(endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
};

export const buildMonthlyPaymentTimeline = (input: {
    startDate: string;
    endDate?: string;
    durationMonths: number;
    monthlyAmount: number;
    payments: MonthlyPayment[];
    rentCycleStartMonth?: string;
    rentCanPay?: boolean;
}): MonthlyPayment[] => {
    const startRaw = input.startDate ? new Date(input.startDate) : new Date();
    const start = Number.isNaN(startRaw.getTime()) ? new Date() : startRaw;
    const endRaw = input.endDate ? new Date(input.endDate) : null;
    const end = endRaw && !Number.isNaN(endRaw.getTime()) ? endRaw : null;
    const totalCycles = Math.max(
        1,
        input.durationMonths > 0
            ? input.durationMonths
            : end
                ? differenceInMonths(end, start) + 1
                : 1
    );

    const paymentPriority = (payment: MonthlyPayment) => {
        switch (payment.status) {
            case 'paid':
            case 'completed':
                return 4;
            case 'overdue':
                return 3;
            case 'pending':
                return 2;
            case 'failed':
                return 1;
            default:
                return 0;
        }
    };

    const paymentTimestamp = (payment: MonthlyPayment) => {
        const parsed = Date.parse(payment.paidAt || '');
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const latestPaymentByMonth = new Map<string, MonthlyPayment>();
    input.payments.forEach((payment) => {
        if (!payment?.month) return;
        const existing = latestPaymentByMonth.get(payment.month);
        if (!existing) {
            latestPaymentByMonth.set(payment.month, payment);
            return;
        }

        const existingPriority = paymentPriority(existing);
        const nextPriority = paymentPriority(payment);
        const existingTimestamp = paymentTimestamp(existing);
        const nextTimestamp = paymentTimestamp(payment);
        if (nextTimestamp > existingTimestamp || (nextTimestamp === existingTimestamp && nextPriority >= existingPriority)) {
            latestPaymentByMonth.set(payment.month, payment);
        }
    });

    const rows: MonthlyPayment[] = [];
    for (let index = 0; index < totalCycles; index += 1) {
        const cycleDate = addMonths(start, index);
        const month = format(cycleDate, 'yyyy-MM');
        const existing = latestPaymentByMonth.get(month);

        if (existing) {
            rows.push({
                ...existing,
                amount: Number(existing.amount || input.monthlyAmount || 0),
            });
            continue;
        }

        let status: MonthlyPayment['status'] = 'upcoming';
        if (input.rentCycleStartMonth && month === input.rentCycleStartMonth) {
            status = input.rentCanPay ? 'pending' : 'upcoming';
        } else if (input.rentCycleStartMonth && month < input.rentCycleStartMonth) {
            status = 'overdue';
        }

        rows.push({
            paymentId: '',
            bookingId: '',
            month,
            amount: input.monthlyAmount,
            paidAt: '',
            status,
        });
    }

    return rows.reverse();
};

export const buildActualMonthlyPaymentHistory = (payments: MonthlyPayment[]): MonthlyPayment[] => {
    const historyStatuses = new Set<MonthlyPayment['status']>(['paid', 'completed', 'pending', 'failed']);

    const paymentPriority = (payment: MonthlyPayment) => {
        switch (payment.status) {
            case 'paid':
            case 'completed':
                return 4;
            case 'failed':
                return 3;
            case 'pending':
                return 2;
            default:
                return 0;
        }
    };

    const paymentTimestamp = (payment: MonthlyPayment) => {
        const parsed = Date.parse(payment.paidAt || '');
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const latestPaymentByMonth = new Map<string, MonthlyPayment>();

    payments.forEach((payment) => {
        if (!payment?.month || !historyStatuses.has(payment.status)) return;

        const existing = latestPaymentByMonth.get(payment.month);
        if (!existing) {
            latestPaymentByMonth.set(payment.month, payment);
            return;
        }

        const existingPriority = paymentPriority(existing);
        const nextPriority = paymentPriority(payment);

        const existingTimestamp = paymentTimestamp(existing);
        const nextTimestamp = paymentTimestamp(payment);

        if (nextTimestamp > existingTimestamp || (nextTimestamp === existingTimestamp && nextPriority >= existingPriority)) {
            latestPaymentByMonth.set(payment.month, payment);
        }
    });

    return Array.from(latestPaymentByMonth.values()).sort((left, right) => {
        const monthOrder = String(right.month || '').localeCompare(String(left.month || ''));
        if (monthOrder !== 0) return monthOrder;
        return paymentTimestamp(right) - paymentTimestamp(left);
    });
};
