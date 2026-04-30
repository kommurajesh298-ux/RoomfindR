import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

import { resolveCors } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/http.ts";
import {
  buildInvoiceNumber,
  verifyInvoiceToken,
} from "../_shared/invoice.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type BookingInvoiceRow = {
  id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  start_date: string;
  end_date: string;
  monthly_rent?: number | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  advance_paid?: number | null;
  payment_type?: string | null;
  commission_amount?: number | null;
  created_at?: string | null;
  payment_status?: string | null;
  properties?: {
    title?: string | null;
    address?: string | { text?: string | null } | null;
    city?: string | null;
  } | null;
  rooms?: {
    room_number?: string | null;
  } | null;
};

type RefundRow = {
  refund_amount?: number | null;
  reason?: string | null;
  status?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
};

const roundCurrency = (value: number): number =>
  Math.round((Number(value) || 0) * 100) / 100;

const toAmount = (value: unknown): number => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? roundCurrency(amount) : 0;
};

const pickPositiveAmount = (...values: Array<unknown>) => {
  for (const value of values) {
    const amount = toAmount(value);
    if (amount > 0) return amount;
  }
  return 0;
};

const normalizePaymentType = (value: unknown): "advance" | "full" | "monthly" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "advance" || normalized === "deposit") return "advance";
  if (normalized === "full") return "full";
  if (normalized === "monthly" || normalized === "rent" || normalized === "monthly_rent") {
    return "monthly";
  }
  return "advance";
};

const normalizePaymentStatus = (value: unknown) =>
  String(value || "").trim().toLowerCase();

const formatCurrency = (value: number): string =>
  `INR ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Number(value) || 0)}`;

const formatDate = (value?: string | null): string =>
  value ? new Date(value).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN");

const formatDateTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString("en-IN") : "";

const getDurationMonths = (startDate: string, endDate: string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = end.getTime() - start.getTime();
  if (Number.isNaN(diff) || diff <= 0) return 1;
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24 * 30.44)));
};

const resolveChargeableAmount = (booking: BookingInvoiceRow, durationMonths: number) => {
  const paymentType = normalizePaymentType(booking.payment_type);
  const paymentStatus = normalizePaymentStatus(booking.payment_status);
  const settled = ["paid", "refunded", "completed", "success"].includes(paymentStatus);
  const monthlyRent = toAmount(booking.monthly_rent);
  const fullStayAmount = roundCurrency(monthlyRent * Math.max(durationMonths, 1));

  if (paymentType === "advance") {
    return settled
      ? pickPositiveAmount(booking.amount_paid, booking.advance_paid, booking.amount_due)
      : pickPositiveAmount(booking.amount_due, booking.advance_paid, booking.amount_paid);
  }

  if (paymentType === "monthly") {
    return settled
      ? pickPositiveAmount(booking.amount_paid, booking.amount_due, booking.monthly_rent)
      : pickPositiveAmount(booking.amount_due, booking.monthly_rent, booking.amount_paid);
  }

  return settled
    ? pickPositiveAmount(booking.amount_paid, booking.amount_due, fullStayAmount, booking.monthly_rent)
    : pickPositiveAmount(booking.amount_due, fullStayAmount, booking.amount_paid, booking.monthly_rent);
};

const getAddressText = (
  value: string | { text?: string | null } | null | undefined,
): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.text || "").trim();
};

const sanitizeFilename = (value: string): string =>
  String(value || "invoice")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

const wrapText = (
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number,
): string[] => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(nextLine, size) <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    lines.push(word);
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
};

const buildPdfResponse = (
  req: Request,
  pdfBytes: Uint8Array,
  filename: string,
): Response => {
  const origin = req.headers.get("origin");
  const { headers } = resolveCors(origin);

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

const drawKeyValueRow = (input: {
  page: Awaited<ReturnType<PDFDocument["addPage"]>>;
  label: string;
  value: string;
  y: number;
  labelFont: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  valueFont: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  valueColor?: ReturnType<typeof rgb>;
}) => {
  input.page.drawText(input.label, {
    x: 56,
    y: input.y,
    size: 11,
    font: input.labelFont,
    color: rgb(0.45, 0.5, 0.58),
  });
  input.page.drawText(input.value, {
    x: 410,
    y: input.y,
    size: 11,
    font: input.valueFont,
    color: input.valueColor || rgb(0.1, 0.13, 0.19),
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    const { headers } = resolveCors(origin);
    return new Response("ok", { status: 200, headers });
  }

  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed", "method_not_allowed");
  }

  try {
    const token = new URL(req.url).searchParams.get("token") || "";
    if (!token) {
      return errorResponse(req, 400, "Missing invoice token", "token_required");
    }

    const payload = await verifyInvoiceToken(token);
    const supabase = createServiceClient();

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        customer_name,
        customer_phone,
        customer_email,
        start_date,
        end_date,
        monthly_rent,
        amount_due,
        amount_paid,
        advance_paid,
        payment_type,
        commission_amount,
        created_at,
        payment_status,
        properties(title, address, city),
        rooms(room_number)
      `)
      .eq("id", payload.bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!booking) {
      return errorResponse(req, 404, "Booking not found", "booking_not_found");
    }

    const { data: refund, error: refundError } = await supabase
      .from("refunds")
      .select("refund_amount, reason, status, processed_at, created_at")
      .eq("booking_id", payload.bookingId)
      .maybeSingle();

    if (refundError) throw refundError;

    const invoiceNumber = buildInvoiceNumber(payload.bookingId);
    const durationMonths = getDurationMonths(booking.start_date, booking.end_date);
    const paymentType = normalizePaymentType(booking.payment_type);
    const roomCharge = resolveChargeableAmount(booking, durationMonths);
    const roomChargeLabel =
      paymentType === "advance"
        ? "Room Charges (Advance Booking)"
        : paymentType === "monthly"
          ? "Room Charges (Monthly Rent)"
          : `Room Charges (${durationMonths} mo)`;
    const roomGst = 0;
    const platformFee = 0;
    const platformGst = 0;
    const totalAmount = roundCurrency(roomCharge + roomGst + platformFee + platformGst);
    const amountPaid = roundCurrency(
      Number(booking.amount_paid || booking.advance_paid || 0),
    );
    const balanceDue = roundCurrency(Math.max(0, totalAmount - amountPaid));
    const addressText = getAddressText(booking.properties?.address);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const semiBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pageHeight = page.getHeight();
    const pageWidth = page.getWidth();
    let y = pageHeight - 56;

    page.drawText("RoomFindR Booking Invoice", {
      x: 56,
      y,
      size: 22,
      font: boldFont,
      color: rgb(0.08, 0.12, 0.2),
    });
    y -= 26;

    page.drawText(invoiceNumber, {
      x: 56,
      y,
      size: 11,
      font: semiBoldFont,
      color: rgb(0.27, 0.34, 0.44),
    });

    page.drawText("Verified QR download", {
      x: pageWidth - 174,
      y,
      size: 10,
      font: semiBoldFont,
      color: rgb(0.15, 0.43, 0.87),
    });
    y -= 28;

    page.drawLine({
      start: { x: 56, y },
      end: { x: pageWidth - 56, y },
      thickness: 1,
      color: rgb(0.9, 0.92, 0.95),
    });
    y -= 28;

    page.drawText("Issued On", {
      x: 56,
      y,
      size: 10,
      font: boldFont,
      color: rgb(0.45, 0.5, 0.58),
    });
    page.drawText(formatDate(booking.created_at), {
      x: 56,
      y: y - 15,
      size: 13,
      font: semiBoldFont,
      color: rgb(0.08, 0.12, 0.2),
    });

    page.drawText("QR Valid Until", {
      x: 240,
      y,
      size: 10,
      font: boldFont,
      color: rgb(0.45, 0.5, 0.58),
    });
    page.drawText(formatDateTime(new Date(payload.exp * 1000).toISOString()), {
      x: 240,
      y: y - 15,
      size: 13,
      font: semiBoldFont,
      color: rgb(0.08, 0.12, 0.2),
    });

    page.drawText("Status", {
      x: 430,
      y,
      size: 10,
      font: boldFont,
      color: rgb(0.45, 0.5, 0.58),
    });
    page.drawText(balanceDue > 0 ? "Partial" : "Paid", {
      x: 430,
      y: y - 15,
      size: 13,
      font: semiBoldFont,
      color: balanceDue > 0 ? rgb(0.9, 0.35, 0.1) : rgb(0.15, 0.43, 0.87),
    });
    y -= 54;

    page.drawRectangle({
      x: 56,
      y: y - 84,
      width: pageWidth - 112,
      height: 96,
      color: rgb(0.97, 0.98, 0.99),
      borderColor: rgb(0.91, 0.93, 0.96),
      borderWidth: 1,
    });

    page.drawText("Property", {
      x: 72,
      y: y - 18,
      size: 10,
      font: boldFont,
      color: rgb(0.45, 0.5, 0.58),
    });
    page.drawText(String(booking.properties?.title || "Property"), {
      x: 72,
      y: y - 36,
      size: 14,
      font: semiBoldFont,
      color: rgb(0.08, 0.12, 0.2),
    });

    const wrappedAddress = wrapText(addressText || String(booking.properties?.city || ""), regularFont, 10, 220);
    let addressY = y - 52;
    wrappedAddress.slice(0, 2).forEach((line) => {
      page.drawText(line, {
        x: 72,
        y: addressY,
        size: 10,
        font: regularFont,
        color: rgb(0.39, 0.45, 0.53),
      });
      addressY -= 13;
    });

    page.drawText("Booking Window", {
      x: 340,
      y: y - 18,
      size: 10,
      font: boldFont,
      color: rgb(0.45, 0.5, 0.58),
    });
    page.drawText(`${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`, {
      x: 340,
      y: y - 36,
      size: 12,
      font: semiBoldFont,
      color: rgb(0.08, 0.12, 0.2),
    });
    page.drawText(
      `${durationMonths} month${durationMonths > 1 ? "s" : ""}${booking.rooms?.room_number ? ` | Room ${booking.rooms.room_number}` : ""}`,
      {
        x: 340,
        y: y - 54,
        size: 10,
        font: regularFont,
        color: rgb(0.39, 0.45, 0.53),
      },
    );
    y -= 118;

    page.drawText("Customer", {
      x: 56,
      y,
      size: 10,
      font: boldFont,
      color: rgb(0.45, 0.5, 0.58),
    });
    y -= 18;
    page.drawText(String(booking.customer_name || "Customer"), {
      x: 56,
      y,
      size: 13,
      font: semiBoldFont,
      color: rgb(0.08, 0.12, 0.2),
    });
    y -= 14;
    page.drawText(String(booking.customer_email || ""), {
      x: 56,
      y,
      size: 10,
      font: regularFont,
      color: rgb(0.39, 0.45, 0.53),
    });
    y -= 12;
    if (booking.customer_phone) {
      page.drawText(String(booking.customer_phone), {
        x: 56,
        y,
        size: 10,
        font: regularFont,
        color: rgb(0.39, 0.45, 0.53),
      });
      y -= 22;
    } else {
      y -= 10;
    }

    page.drawText("Payment Breakdown", {
      x: 56,
      y,
      size: 11,
      font: boldFont,
      color: rgb(0.08, 0.12, 0.2),
    });
    y -= 20;

    page.drawRectangle({
      x: 56,
      y: y - 156,
      width: pageWidth - 112,
      height: 168,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.91, 0.93, 0.96),
      borderWidth: 1,
    });

    drawKeyValueRow({
      page,
      label: roomChargeLabel,
      value: formatCurrency(roomCharge),
      y: y - 18,
      labelFont: regularFont,
      valueFont: semiBoldFont,
    });
    drawKeyValueRow({
      page,
      label: "Room GST",
      value: formatCurrency(roomGst),
      y: y - 42,
      labelFont: regularFont,
      valueFont: semiBoldFont,
    });
    drawKeyValueRow({
      page,
      label: "Platform Fee",
      value: formatCurrency(platformFee),
      y: y - 66,
      labelFont: regularFont,
      valueFont: semiBoldFont,
    });
    drawKeyValueRow({
      page,
      label: "GST on Platform Fee",
      value: formatCurrency(platformGst),
      y: y - 90,
      labelFont: regularFont,
      valueFont: semiBoldFont,
    });
    drawKeyValueRow({
      page,
      label: "Total Amount",
      value: formatCurrency(totalAmount),
      y: y - 114,
      labelFont: semiBoldFont,
      valueFont: boldFont,
    });
    drawKeyValueRow({
      page,
      label: "Amount Paid",
      value: `- ${formatCurrency(amountPaid)}`,
      y: y - 138,
      labelFont: regularFont,
      valueFont: boldFont,
      valueColor: rgb(0.1, 0.43, 0.87),
    });
    if (balanceDue > 0) {
      drawKeyValueRow({
        page,
        label: "Balance Due",
        value: formatCurrency(balanceDue),
        y: y - 162,
        labelFont: regularFont,
        valueFont: boldFont,
        valueColor: rgb(0.87, 0.16, 0.16),
      });
    }

    y -= balanceDue > 0 ? 196 : 178;

    if (refund) {
      const refundStatus = String(refund.status || "").toUpperCase();
      page.drawText("Refund Summary", {
        x: 56,
        y,
        size: 11,
        font: boldFont,
        color: rgb(0.08, 0.12, 0.2),
      });
      y -= 18;

      page.drawRectangle({
        x: 56,
        y: y - 72,
        width: pageWidth - 112,
        height: 84,
        color: rgb(0.95, 0.98, 1),
        borderColor: rgb(0.84, 0.9, 0.97),
        borderWidth: 1,
      });

      drawKeyValueRow({
        page,
        label: "Refund Amount",
        value: formatCurrency(roundCurrency(Number(refund.refund_amount || 0))),
        y: y - 18,
        labelFont: regularFont,
        valueFont: boldFont,
        valueColor: rgb(0.1, 0.43, 0.87),
      });
      drawKeyValueRow({
        page,
        label: "Refund Status",
        value: refundStatus || "PENDING",
        y: y - 42,
        labelFont: regularFont,
        valueFont: semiBoldFont,
      });

      const refundReason = String(refund.reason || "").trim();
      if (refundReason) {
        const lines = wrapText(`Reason: ${refundReason}`, regularFont, 10, pageWidth - 144);
        let reasonY = y - 64;
        lines.slice(0, 2).forEach((line) => {
          page.drawText(line, {
            x: 72,
            y: reasonY,
            size: 10,
            font: regularFont,
            color: rgb(0.39, 0.45, 0.53),
          });
          reasonY -= 12;
        });
      }

      y -= 100;
    }

    page.drawLine({
      start: { x: 56, y },
      end: { x: pageWidth - 56, y },
      thickness: 1,
      color: rgb(0.9, 0.92, 0.95),
    });
    y -= 20;

    page.drawText(
      "This PDF was generated from a unique signed QR invoice link.",
      {
        x: 56,
        y,
        size: 10,
        font: regularFont,
        color: rgb(0.39, 0.45, 0.53),
      },
    );
    y -= 12;
    page.drawText(`Verification nonce: ${payload.nonce}`, {
      x: 56,
      y,
      size: 9,
      font: regularFont,
      color: rgb(0.55, 0.6, 0.68),
    });

    const pdfBytes = await pdfDoc.save();
    const filename = `${sanitizeFilename(invoiceNumber)}.pdf`;
    return buildPdfResponse(req, pdfBytes, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate invoice PDF";
    const status = message === "Invoice token expired" ? 410 : 400;
    return errorResponse(req, status, message, "invoice_download_failed");
  }
});
