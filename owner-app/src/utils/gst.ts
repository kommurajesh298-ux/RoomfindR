import type { BookingWithDetails } from '../types/booking.types';

const PLATFORM_GST_RATE = 0.18;

const roundCurrency = (value: number): number =>
    Math.round((Number(value) || 0) * 100) / 100;

const toAmount = (value: unknown): number => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? roundCurrency(amount) : 0;
};

const pickPositiveAmount = (...values: Array<unknown>): number => {
    for (const value of values) {
        const amount = toAmount(value);
        if (amount > 0) {
            return amount;
        }
    }
    return 0;
};

const normalizePaymentType = (value: unknown): 'advance' | 'full' | 'monthly' => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'advance' || normalized === 'deposit') return 'advance';
    if (normalized === 'full') return 'full';
    if (normalized === 'monthly' || normalized === 'rent' || normalized === 'monthly_rent') {
        return 'monthly';
    }
    return 'advance';
};

const normalizePaymentStatus = (value: unknown): string =>
    String(value || '').trim().toLowerCase();

const resolveMonthlyRent = (booking: BookingWithDetails): number => {
    if (Number.isFinite(booking.monthlyRent) && booking.monthlyRent > 0) {
        return roundCurrency(booking.monthlyRent);
    }

    return roundCurrency(booking.propertyDetails?.pricePerMonth || 0);
};

export const resolveRoomGstRate = (roomCharge: number): number => {
    const normalizedCharge = toAmount(roomCharge);
    if (normalizedCharge < 1000) return 0;
    if (normalizedCharge <= 7499) return 0.12;
    return 0.18;
};

type InvoiceChargeContext = {
    paymentType: 'advance' | 'full' | 'monthly';
    paymentStatus: string;
    durationMonths: number;
    roomCharge: number;
    roomChargeLabel: string;
    amountPaid: number;
    usesStructuredTaxes: boolean;
    roomGstRate: number;
    roomGst: number;
    platformFee: number;
    platformGstRate: number;
    platformGst: number;
    totalAmount: number;
    balanceDue: number;
    ownerGrossAmount: number;
};

const hasStructuredTaxFields = (booking: BookingWithDetails) =>
    pickPositiveAmount(
        booking.roomGst,
        booking.platformFee,
        booking.platformGst,
        booking.totalAmount,
        booking.cgstAmount,
        booking.sgstAmount,
        booking.igstAmount,
    ) > 0;

const resolveLegacyChargeableAmount = (
    booking: BookingWithDetails,
    paymentType: 'advance' | 'full' | 'monthly',
    paymentStatus: string,
    monthlyRent: number,
    durationMonths: number,
): number => {
    const settled = ['paid', 'refunded', 'completed', 'success'].includes(paymentStatus);
    const fullStayAmount = roundCurrency(monthlyRent * Math.max(durationMonths, 1));

    if (paymentType === 'advance') {
        return settled
            ? pickPositiveAmount(booking.amountPaid, booking.advancePaid, booking.amountDue)
            : pickPositiveAmount(booking.amountDue, booking.advancePaid, booking.amountPaid);
    }

    if (paymentType === 'monthly') {
        return settled
            ? pickPositiveAmount(booking.amountPaid, booking.amountDue, monthlyRent)
            : pickPositiveAmount(booking.amountDue, monthlyRent, booking.amountPaid);
    }

    return settled
        ? pickPositiveAmount(booking.amountPaid, booking.amountDue, fullStayAmount, monthlyRent)
        : pickPositiveAmount(booking.amountDue, fullStayAmount, booking.amountPaid, monthlyRent);
};

export const getBookingGstSummary = (booking: BookingWithDetails): InvoiceChargeContext => {
    const durationMonths = Math.max(Number(booking.durationMonths) || 1, 1);
    const monthlyRent = resolveMonthlyRent(booking);
    const paymentType = normalizePaymentType(booking.paymentType);
    const paymentStatus = normalizePaymentStatus(booking.paymentStatus);
    const amountPaid = pickPositiveAmount(
        booking.amountPaid,
        paymentType === 'advance' ? booking.advancePaid : 0,
    );
    const usesStructuredTaxes = hasStructuredTaxFields(booking);

    const legacyRoomCharge = resolveLegacyChargeableAmount(
        booking,
        paymentType,
        paymentStatus,
        monthlyRent,
        durationMonths,
    );

    const roomCharge = usesStructuredTaxes
        ? pickPositiveAmount(booking.amountDue, legacyRoomCharge, monthlyRent)
        : legacyRoomCharge;

    const roomGstRate = usesStructuredTaxes
        ? toAmount(booking.roomGstRate) > 0
            ? toAmount(booking.roomGstRate)
            : resolveRoomGstRate(roomCharge)
        : 0;

    const roomGst = usesStructuredTaxes
        ? pickPositiveAmount(booking.roomGst, roundCurrency(roomCharge * roomGstRate))
        : 0;

    const platformFee = usesStructuredTaxes ? toAmount(booking.platformFee) : 0;
    const platformGstRate = usesStructuredTaxes
        ? toAmount(booking.platformGstRate) > 0
            ? toAmount(booking.platformGstRate)
            : PLATFORM_GST_RATE
        : 0;
    const platformGst = usesStructuredTaxes
        ? pickPositiveAmount(booking.platformGst, roundCurrency(platformFee * platformGstRate))
        : 0;

    const totalAmount = usesStructuredTaxes
        ? pickPositiveAmount(
            booking.totalAmount,
            roundCurrency(roomCharge + roomGst + platformFee + platformGst),
        )
        : roomCharge;

    const balanceDue = roundCurrency(Math.max(0, totalAmount - amountPaid));

    const roomChargeLabel =
        paymentType === 'advance'
            ? 'Room Charges (Advance Booking)'
            : paymentType === 'monthly'
                ? 'Room Charges (Monthly Rent)'
                : `Room Charges (${durationMonths} mo)`;

    return {
        paymentType,
        paymentStatus,
        durationMonths,
        roomCharge,
        roomChargeLabel,
        amountPaid,
        usesStructuredTaxes,
        roomGstRate,
        roomGst,
        platformFee,
        platformGstRate,
        platformGst,
        totalAmount,
        balanceDue,
        ownerGrossAmount: roundCurrency(roomCharge + roomGst),
    };
};
