import type { BookingWithDetails } from "../types/booking.types";
import { getBookingGstSummary } from "./gst";

export const buildInvoiceNumber = (bookingId: string): string =>
  `INV-${String(bookingId || "").slice(0, 8).toUpperCase()}`;

export const formatInvoiceDate = (createdAt?: string | null): string =>
  createdAt
    ? new Date(createdAt).toLocaleDateString("en-IN")
    : new Date().toLocaleDateString("en-IN");

export const formatInvoiceCurrency = (amount: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(Number(amount) || 0);

export const getBookingInvoiceSummary = (booking: BookingWithDetails) => {
  const gstSummary = getBookingGstSummary(booking);

  return {
    invoiceNumber: buildInvoiceNumber(booking.bookingId),
    invoiceDate: formatInvoiceDate(booking.createdAt),
    durationMonths: gstSummary.durationMonths,
    amountPaid: gstSummary.amountPaid,
    roomCharge: gstSummary.roomCharge,
    roomChargeLabel: gstSummary.roomChargeLabel,
    roomGst: gstSummary.roomGst,
    roomGstRate: gstSummary.roomGstRate,
    platformFee: gstSummary.platformFee,
    platformGst: gstSummary.platformGst,
    platformGstRate: gstSummary.platformGstRate,
    totalAmount: gstSummary.totalAmount,
    balanceDue: gstSummary.balanceDue,
    usesStructuredTaxes: gstSummary.usesStructuredTaxes,
  };
};
