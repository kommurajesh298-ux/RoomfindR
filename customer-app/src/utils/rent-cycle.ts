import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

type RentDueDateInput = {
    status?: string | null;
    stayStatus?: string | null;
    vacateDate?: string | null;
    cycleNextDueDate?: string | null;
    bookingNextDueDate?: string | null;
    legacyNextPaymentDate?: string | null;
    currentCycleStartDate?: string | null;
    checkInDate?: string | null;
    startDate?: string | null;
    cycleDurationDays?: number | null;
};

const CLOSED_BOOKING_STATUSES = new Set([
    'checked-out',
    'checked_out',
    'vacated',
    'completed',
    'cancelled',
    'cancelled_by_customer',
    'cancelled-by-customer',
    'rejected',
    'refunded'
]);

const parseRentDate = (value?: string | null): Date | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? new Date(`${raw}T00:00:00`)
        : new Date(raw);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeStatus = (value?: string | null) =>
    String(value || '').trim().toLowerCase().replace(/_/g, '-');

export const resolveDisplayRentDueDate = (input: RentDueDateInput): Date | null => {
    const normalizedStatus = normalizeStatus(input.status);
    const normalizedStayStatus = normalizeStatus(input.stayStatus);

    if (
        CLOSED_BOOKING_STATUSES.has(normalizedStatus)
        || normalizedStayStatus === 'vacated'
        || Boolean(input.vacateDate)
    ) {
        return null;
    }

    const explicitNextDue =
        parseRentDate(input.cycleNextDueDate)
        || parseRentDate(input.bookingNextDueDate);

    if (explicitNextDue) {
        return explicitNextDue;
    }

    const cycleDurationDays = Math.max(1, Number(input.cycleDurationDays || 30) || 30);
    const cycleAnchor =
        parseRentDate(input.currentCycleStartDate)
        || parseRentDate(input.checkInDate)
        || parseRentDate(input.startDate);
    const legacyNextPaymentDate = parseRentDate(input.legacyNextPaymentDate);

    if (!cycleAnchor) {
        return legacyNextPaymentDate;
    }

    const computedNextDue = addDays(cycleAnchor, cycleDurationDays);

    if (!legacyNextPaymentDate) {
        return computedNextDue;
    }

    const legacyOffsetDays = differenceInCalendarDays(
        startOfDay(legacyNextPaymentDate),
        startOfDay(cycleAnchor)
    );

    if (legacyOffsetDays < 1 || legacyOffsetDays > cycleDurationDays + 7) {
        return computedNextDue;
    }

    return legacyNextPaymentDate;
};
