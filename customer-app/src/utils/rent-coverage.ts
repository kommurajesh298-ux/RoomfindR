import { addMonths, differenceInCalendarDays, format, startOfDay } from "date-fns";
import type { MonthlyPayment } from "../types/booking.types";
import { resolveDisplayRentDueDate } from "./rent-cycle";

type RentCoverageInput = {
  status?: string | null;
  stayStatus?: string | null;
  vacateDate?: string | null;
  paymentType?: string | null;
  paymentStatus?: string | null;
  durationMonths?: number | null;
  cycleNextDueDate?: string | null;
  bookingNextDueDate?: string | null;
  legacyNextPaymentDate?: string | null;
  currentCycleStartDate?: string | null;
  checkInDate?: string | null;
  startDate?: string | null;
  cycleDurationDays?: number | null;
  payments?: MonthlyPayment[] | null;
  today?: Date;
};

export type RentCoverageSummary = {
  effectiveCycleStartDate: Date | null;
  effectiveNextDueDate: Date | null;
  coveredThroughDate: Date | null;
  coveredThroughMonth: string | null;
  currentCycleMonth: string | null;
  isCurrentCycleSettled: boolean;
  isPrepaidFullStay: boolean;
  dueDaysRemaining: number | null;
};

const CLOSED_BOOKING_STATUSES = new Set([
  "checked-out",
  "checked_out",
  "vacated",
  "completed",
  "cancelled",
  "cancelled_by_customer",
  "cancelled-by-customer",
  "rejected",
  "refunded",
]);

const normalizeStatus = (value?: string | null) =>
  String(value || "").trim().toLowerCase().replace(/_/g, "-");

const isSettledStatus = (value?: string | null) =>
  ["paid", "completed", "success", "authorized"].includes(normalizeStatus(value));

const parseDate = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeMonthToken = (value?: string | null) => {
  const parsed = parseDate(value);
  return parsed ? format(parsed, "yyyy-MM") : null;
};

const getLatestSettledPayment = (payments?: MonthlyPayment[] | null) =>
  [...(payments || [])]
    .filter((payment) => ["paid", "completed"].includes(String(payment.status || "").toLowerCase()))
    .sort((left, right) => {
      const rightTime = Date.parse(right.paidAt || "") || 0;
      const leftTime = Date.parse(left.paidAt || "") || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return String(right.month || "").localeCompare(String(left.month || ""));
    })[0] || null;

export const resolveRentCoverageSummary = (
  input: RentCoverageInput,
): RentCoverageSummary => {
  const normalizedStatus = normalizeStatus(input.status);
  const normalizedStayStatus = normalizeStatus(input.stayStatus);

  if (
    CLOSED_BOOKING_STATUSES.has(normalizedStatus) ||
    normalizedStayStatus === "vacated" ||
    Boolean(input.vacateDate)
  ) {
    return {
      effectiveCycleStartDate: null,
      effectiveNextDueDate: null,
      coveredThroughDate: null,
      coveredThroughMonth: null,
      currentCycleMonth: null,
      isCurrentCycleSettled: false,
      isPrepaidFullStay: false,
      dueDaysRemaining: null,
    };
  }

  const anchor =
    parseDate(input.currentCycleStartDate) ||
    parseDate(input.checkInDate) ||
    parseDate(input.startDate);
  const today = startOfDay(input.today || new Date());
  const defaultNextDueDate = resolveDisplayRentDueDate({
    status: input.status,
    stayStatus: input.stayStatus,
    vacateDate: input.vacateDate,
    cycleNextDueDate: input.cycleNextDueDate,
    bookingNextDueDate: input.bookingNextDueDate,
    legacyNextPaymentDate: input.legacyNextPaymentDate,
    currentCycleStartDate: input.currentCycleStartDate,
    checkInDate: input.checkInDate,
    startDate: input.startDate,
    cycleDurationDays: input.cycleDurationDays,
  });
  const latestSettledPayment = getLatestSettledPayment(input.payments);
  const isPrepaidFullStay =
    normalizeStatus(input.paymentType) === "full" &&
    isSettledStatus(input.paymentStatus) &&
    Boolean(anchor);

  if (isPrepaidFullStay && anchor) {
    const monthsCovered = Math.max(1, Number(input.durationMonths || 0) || 1);
    const coveredThroughDate = addMonths(anchor, monthsCovered);
    const effectiveNextDueDate =
      defaultNextDueDate && defaultNextDueDate > coveredThroughDate
        ? defaultNextDueDate
        : coveredThroughDate;

    return {
      effectiveCycleStartDate: anchor,
      effectiveNextDueDate,
      coveredThroughDate,
      coveredThroughMonth: format(addMonths(anchor, monthsCovered - 1), "yyyy-MM"),
      currentCycleMonth: format(anchor, "yyyy-MM"),
      isCurrentCycleSettled: effectiveNextDueDate > today,
      isPrepaidFullStay: true,
      dueDaysRemaining: differenceInCalendarDays(
        startOfDay(effectiveNextDueDate),
        today,
      ),
    };
  }

  const currentCycleMonth = normalizeMonthToken(input.currentCycleStartDate || input.checkInDate || input.startDate);
  const latestSettledMonth = latestSettledPayment?.month || null;
  const effectiveNextDueDate = defaultNextDueDate;

  return {
    effectiveCycleStartDate: anchor,
    effectiveNextDueDate,
    coveredThroughDate: latestSettledMonth ? parseDate(`${latestSettledMonth}-01`) : null,
    coveredThroughMonth: latestSettledMonth,
    currentCycleMonth,
    isCurrentCycleSettled: Boolean(
      currentCycleMonth &&
        latestSettledMonth &&
        latestSettledMonth === currentCycleMonth,
    ),
    isPrepaidFullStay: false,
    dueDaysRemaining: effectiveNextDueDate
      ? differenceInCalendarDays(startOfDay(effectiveNextDueDate), today)
      : null,
  };
};
