import type { PlatformBooking } from '../types/booking.types';

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

const parseDateOnly = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const calculateDurationMonths = (startDate?: string, endDate?: string, checkInDate?: string | null) => {
    const anchor = parseDateOnly(checkInDate || startDate);
    const end = parseDateOnly(endDate);

    if (!anchor || !end) {
        return 1;
    }

    let monthCount = (end.getUTCFullYear() - anchor.getUTCFullYear()) * 12
        + (end.getUTCMonth() - anchor.getUTCMonth());

    if (end.getUTCDate() > anchor.getUTCDate()) {
        monthCount += 1;
    }

    return Math.max(1, monthCount);
};

export const resolveRoomGstRate = (roomCharge: number): number => {
    const normalizedCharge = toAmount(roomCharge);
    if (normalizedCharge < 1000) return 0;
    if (normalizedCharge <= 7499) return 0.12;
    return 0.18;
};

type BookingTaxLike = Partial<PlatformBooking> & {
    startDate?: string;
    endDate?: string;
    checkInDate?: string | null;
    start_date?: string;
    end_date?: string;
    check_in_date?: string | null;
    advance_paid?: number | string | null;
    amount_paid?: number | string | null;
    amount_due?: number | string | null;
    monthly_rent?: number | string | null;
    payment_type?: string | null;
    payment_status?: string | null;
    room_gst?: number | string | null;
    room_gst_rate?: number | string | null;
    platform_fee?: number | string | null;
    platform_gst?: number | string | null;
    platform_gst_rate?: number | string | null;
    total_amount?: number | string | null;
    cgst_amount?: number | string | null;
    sgst_amount?: number | string | null;
    igst_amount?: number | string | null;
};

type BookingGstSummary = {
    paymentType: 'advance' | 'full' | 'monthly';
    durationMonths: number;
    roomChargeLabel: string;
    roomCharge: number;
    roomGst: number;
    roomGstRate: number;
    platformFee: number;
    platformGst: number;
    platformGstRate: number;
    amountPaid: number;
    totalAmount: number;
    balanceDue: number;
    ownerGrossAmount: number;
    usesStructuredTaxes: boolean;
};

const hasStructuredTaxFields = (booking: BookingTaxLike) =>
    pickPositiveAmount(
        booking.roomGst,
        booking.platformFee,
        booking.platformGst,
        booking.totalAmount,
        booking.cgstAmount,
        booking.sgstAmount,
        booking.igstAmount,
        booking.room_gst,
        booking.platform_fee,
        booking.platform_gst,
        booking.total_amount,
        booking.cgst_amount,
        booking.sgst_amount,
        booking.igst_amount,
    ) > 0;

const resolveMonthlyRent = (booking: BookingTaxLike) =>
    pickPositiveAmount(booking.monthlyRent, booking.monthly_rent);

export const getBookingGstSummary = (booking: BookingTaxLike): BookingGstSummary => {
    const durationMonths = Math.max(
        Number(booking.durationMonths) || calculateDurationMonths(
            booking.startDate || booking.start_date,
            booking.endDate || booking.end_date,
            booking.checkInDate || booking.check_in_date || null,
        ),
        1,
    );
    const paymentType = normalizePaymentType(booking.paymentType || booking.payment_type);
    const paymentStatus = normalizePaymentStatus(booking.paymentStatus || booking.payment_status);
    const monthlyRent = resolveMonthlyRent(booking);
    const amountPaid = pickPositiveAmount(
        booking.amountPaid,
        booking.amount_paid,
        paymentType === 'advance' ? booking.advancePaid : 0,
        paymentType === 'advance' ? booking.advance_paid : 0,
    );
    const usesStructuredTaxes = hasStructuredTaxFields(booking);

    const settled = ['paid', 'refunded', 'completed', 'success'].includes(paymentStatus);
    const fullStayAmount = roundCurrency(monthlyRent * Math.max(durationMonths, 1));
    let legacyRoomCharge = fullStayAmount;

    if (paymentType === 'advance') {
        legacyRoomCharge = settled
            ? pickPositiveAmount(booking.amountPaid, booking.amount_paid, booking.advancePaid, booking.advance_paid, booking.amountDue, booking.amount_due)
            : pickPositiveAmount(booking.amountDue, booking.amount_due, booking.advancePaid, booking.advance_paid, booking.amountPaid, booking.amount_paid);
    } else if (paymentType === 'monthly') {
        legacyRoomCharge = settled
            ? pickPositiveAmount(booking.amountPaid, booking.amount_paid, booking.amountDue, booking.amount_due, monthlyRent)
            : pickPositiveAmount(booking.amountDue, booking.amount_due, monthlyRent, booking.amountPaid, booking.amount_paid);
    } else {
        legacyRoomCharge = settled
            ? pickPositiveAmount(booking.amountPaid, booking.amount_paid, booking.amountDue, booking.amount_due, fullStayAmount, monthlyRent)
            : pickPositiveAmount(booking.amountDue, booking.amount_due, fullStayAmount, booking.amountPaid, booking.amount_paid, monthlyRent);
    }

    const roomCharge = usesStructuredTaxes
        ? pickPositiveAmount(booking.amountDue, booking.amount_due, legacyRoomCharge, monthlyRent)
        : legacyRoomCharge;

    const roomGstRate = usesStructuredTaxes
        ? pickPositiveAmount(booking.roomGstRate, booking.room_gst_rate) || resolveRoomGstRate(roomCharge)
        : 0;
    const roomGst = usesStructuredTaxes
        ? pickPositiveAmount(booking.roomGst, booking.room_gst, roundCurrency(roomCharge * roomGstRate))
        : 0;
    const platformFee = usesStructuredTaxes ? pickPositiveAmount(booking.platformFee, booking.platform_fee) : 0;
    const platformGstRate = usesStructuredTaxes
        ? pickPositiveAmount(booking.platformGstRate, booking.platform_gst_rate) || PLATFORM_GST_RATE
        : 0;
    const platformGst = usesStructuredTaxes
        ? pickPositiveAmount(booking.platformGst, booking.platform_gst, roundCurrency(platformFee * platformGstRate))
        : 0;

    const totalAmount = usesStructuredTaxes
        ? pickPositiveAmount(booking.totalAmount, booking.total_amount, roundCurrency(roomCharge + roomGst + platformFee + platformGst))
        : roomCharge;

    const roomChargeLabel =
        paymentType === 'advance'
            ? 'Room Charges (Advance Booking)'
            : paymentType === 'monthly'
                ? 'Room Charges (Monthly Rent)'
                : `Room Charges (${durationMonths} mo)`;

    return {
        paymentType,
        durationMonths,
        roomChargeLabel,
        roomCharge,
        roomGst,
        roomGstRate,
        platformFee,
        platformGst,
        platformGstRate,
        amountPaid,
        totalAmount,
        balanceDue: roundCurrency(Math.max(0, totalAmount - amountPaid)),
        ownerGrossAmount: roundCurrency(roomCharge + roomGst),
        usesStructuredTaxes,
    };
};
