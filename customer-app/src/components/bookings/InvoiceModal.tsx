import React from "react";
import QRCode from "qrcode";
import { toast } from "react-hot-toast";

import type { BookingWithDetails, Refund } from "../../types/booking.types";
import { formatBookingDates } from "../../utils/booking.utils";
import {
  formatInvoiceCurrency,
  getBookingInvoiceSummary,
} from "../../utils/invoice";
import { invoiceService } from "../../services/invoice.service";
import { refundService } from "../../services/refund.service";

interface InvoiceModalProps {
  booking: BookingWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
}

const QR_LIFETIME_FALLBACK_MS = 15 * 60_000;

const InvoiceModal: React.FC<InvoiceModalProps> = ({
  booking,
  isOpen,
  onClose,
}) => {
  const [refund, setRefund] = React.useState<Refund | null>(null);
  const [downloadUrl, setDownloadUrl] = React.useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = React.useState("");
  const [qrExpiresAt, setQrExpiresAt] = React.useState("");
  const [isPreparingQr, setIsPreparingQr] = React.useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = React.useState(false);
  const [qrError, setQrError] = React.useState("");
  const [now, setNow] = React.useState(() => Date.now());

  const invoiceSummary = booking ? getBookingInvoiceSummary(booking) : null;
  const qrExpiresAtMs = qrExpiresAt ? Date.parse(qrExpiresAt) : 0;
  const qrRemainingMs = qrExpiresAtMs ? Math.max(0, qrExpiresAtMs - now) : 0;
  const qrExpired = Boolean(qrExpiresAtMs) && qrRemainingMs <= 0;

  React.useEffect(() => {
    if (!isOpen || !booking) return;

    let active = true;

    refundService
      .getRefundByBookingId(booking.bookingId)
      .then((nextRefund) => {
        if (active) setRefund(nextRefund);
      })
      .catch(() => {
        if (active) setRefund(null);
      });

    return () => {
      active = false;
    };
  }, [isOpen, booking]);

  React.useEffect(() => {
    if (!isOpen || !booking) return;

    let active = true;

    const prepareQr = async () => {
      setIsPreparingQr(true);
      setQrError("");

      try {
        const response = await invoiceService.createBookingInvoiceLink(
          booking.bookingId,
        );
        const nextDownloadUrl = String(response.download_url || "").trim();
        const nextExpiresAt = String(response.expires_at || "").trim();
        if (!nextDownloadUrl) {
          throw new Error("Invoice download link is unavailable.");
        }

        const nextQrDataUrl = await QRCode.toDataURL(nextDownloadUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 240,
          color: {
            dark: "#0f172a",
            light: "#ffffff",
          },
        });

        if (!active) return;

        setDownloadUrl(nextDownloadUrl);
        setQrExpiresAt(
          nextExpiresAt ||
            new Date(Date.now() + QR_LIFETIME_FALLBACK_MS).toISOString(),
        );
        setQrCodeDataUrl(nextQrDataUrl);
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error
            ? error.message
            : "Unable to prepare the invoice QR.";
        setQrError(message);
      } finally {
        if (active) {
          setIsPreparingQr(false);
        }
      }
    };

    setRefund(null);
    setDownloadUrl("");
    setQrCodeDataUrl("");
    setQrExpiresAt("");
    setQrError("");
    void prepareQr();

    return () => {
      active = false;
    };
  }, [isOpen, booking]);

  React.useEffect(() => {
    if (!isOpen || !qrExpiresAt) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isOpen, qrExpiresAt]);

  if (!isOpen || !booking || !invoiceSummary) return null;

  const {
    propertyDetails,
    startDate,
    endDate,
    paymentStatus,
  } = booking;

  const {
    invoiceNumber,
    invoiceDate,
    durationMonths,
    roomCharge,
    roomChargeLabel,
    roomGst,
    roomGstRate,
    platformFee,
    platformGst,
    platformGstRate,
    totalAmount,
    amountPaid,
    balanceDue,
    usesStructuredTaxes,
  } = invoiceSummary;

  const qrMinutes = Math.floor(qrRemainingMs / 60_000);
  const qrSeconds = Math.floor((qrRemainingMs % 60_000) / 1000);
  const qrExpiryLabel = qrExpiresAt
    ? qrExpired
      ? "QR expired. Refresh to get a fresh invoice link."
      : `Live QR expires in ${qrMinutes}:${String(qrSeconds).padStart(2, "0")}`
    : "Preparing secure invoice QR...";

  const paymentStatusLabel =
    paymentStatus === "refunded"
      ? "Refunded"
      : balanceDue > 0
        ? "Partial"
        : "Paid";

  const paymentStatusTone =
    paymentStatus === "refunded"
      ? "bg-amber-50 text-amber-700"
      : balanceDue > 0
        ? "bg-orange-50 text-orange-600"
        : "bg-blue-50 text-blue-600";

  const downloadInvoice = async (url: string) => {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("application/pdf")) {
      const payload = await response.json().catch(() => null) as {
        error?: { message?: string } | string;
      } | null;
      const message =
        typeof payload?.error === "string"
          ? payload.error
          : payload?.error?.message || "Unable to download the invoice PDF.";
      throw new Error(message);
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `${invoiceNumber}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(blobUrl);
  };

  const refreshInvoiceQr = async () => {
    if (isPreparingQr) return;

    setIsPreparingQr(true);
    setQrError("");

    try {
      const response = await invoiceService.createBookingInvoiceLink(
        booking.bookingId,
      );
      const nextDownloadUrl = String(response.download_url || "").trim();
      const nextExpiresAt = String(response.expires_at || "").trim();
      if (!nextDownloadUrl) {
        throw new Error("Invoice download link is unavailable.");
      }

      const nextQrDataUrl = await QRCode.toDataURL(nextDownloadUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });

      setDownloadUrl(nextDownloadUrl);
      setQrExpiresAt(
        nextExpiresAt ||
          new Date(Date.now() + QR_LIFETIME_FALLBACK_MS).toISOString(),
      );
      setQrCodeDataUrl(nextQrDataUrl);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to refresh the invoice QR.";
      setQrError(message);
      toast.error(message);
    } finally {
      setIsPreparingQr(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) return;

    setIsDownloadingPdf(true);
    try {
      let liveUrl = downloadUrl;

      if (!liveUrl || qrExpired) {
        const response = await invoiceService.createBookingInvoiceLink(
          booking.bookingId,
        );
        liveUrl = String(response.download_url || "").trim();
        const nextExpiresAt = String(response.expires_at || "").trim();
        if (!liveUrl) {
          throw new Error("Invoice download link is unavailable.");
        }

        setDownloadUrl(liveUrl);
        setQrExpiresAt(
          nextExpiresAt ||
            new Date(Date.now() + QR_LIFETIME_FALLBACK_MS).toISOString(),
        );
        setQrCodeDataUrl(
          await QRCode.toDataURL(liveUrl, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 240,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          }),
        );
      }

      await downloadInvoice(liveUrl);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to download the invoice PDF.";
      toast.error(message);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
      <div className="no-scrollbar flex max-h-[90vh] h-auto w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Booking Invoice</h2>
            <p className="text-xs font-medium text-gray-500">{invoiceNumber}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="flex items-center justify-between border-b border-gray-50 pb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Date Issued
              </p>
              <p className="font-semibold text-gray-900">{invoiceDate}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Status
              </p>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${paymentStatusTone}`}
              >
                {paymentStatusLabel}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl bg-gray-50 p-4">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Property
              </p>
              <p className="line-clamp-1 text-sm font-bold text-gray-900">
                {propertyDetails?.title}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                {propertyDetails?.address?.text}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Booking
              </p>
              <p className="text-sm font-semibold text-gray-900">
                {formatBookingDates(startDate, endDate)}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {durationMonths} Month{durationMonths > 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Payment Breakdown
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white text-sm">
              <div className="flex justify-between p-3 text-gray-600">
                <span>{roomChargeLabel}</span>
                <span className="font-medium">
                  {formatInvoiceCurrency(roomCharge)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-50 p-3 text-gray-600">
                <span>
                  Room GST
                  {usesStructuredTaxes && roomGstRate > 0
                    ? ` (${Math.round(roomGstRate * 100)}%)`
                    : ''}
                </span>
                <span className="font-medium">
                  {formatInvoiceCurrency(roomGst)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-50 p-3 text-gray-600">
                <span>Platform Fee</span>
                <span className="font-medium">
                  {formatInvoiceCurrency(platformFee)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-50 p-3 text-gray-600">
                <span>
                  GST on Platform Fee
                  {usesStructuredTaxes && platformGstRate > 0
                    ? ` (${Math.round(platformGstRate * 100)}%)`
                    : ''}
                </span>
                <span className="font-medium">
                  {formatInvoiceCurrency(platformGst)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-100 bg-gray-50 p-3 font-bold text-gray-900">
                <span>Total Amount</span>
                <span>{formatInvoiceCurrency(totalAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-blue-50 bg-blue-50/30 p-3 text-blue-600">
                <span>Amount Paid</span>
                <span className="font-bold">
                  - {formatInvoiceCurrency(amountPaid)}
                </span>
              </div>
              {balanceDue > 0 && (
                <div className="flex justify-between border-t border-red-50 bg-red-50/30 p-3 text-red-600">
                  <span>Balance Due</span>
                  <span className="font-bold underline decoration-2 underline-offset-2">
                    {formatInvoiceCurrency(balanceDue)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {refund && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Refund Timeline
              </p>
              <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-blue-900">
                      Total Refund
                    </p>
                    <p className="text-xl font-black text-blue-600">
                      {formatInvoiceCurrency(refund.refundAmount)}
                    </p>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                      refund.status === "SUCCESS"
                        ? "bg-blue-100 text-blue-600"
                        : refund.status === "ONHOLD"
                          ? "bg-yellow-100 text-yellow-700"
                        : refund.status === "PROCESSING"
                          ? "bg-orange-100 text-orange-600"
                          : refund.status === "PENDING"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-600"
                    }`}
                  >
                    {refund.status === "PENDING"
                      ? "PENDING REVIEW"
                      : refund.status === "ONHOLD"
                        ? "ON HOLD"
                        : refund.status}
                  </span>
                </div>

                <div className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-[2px] before:bg-blue-200 before:content-['']">
                  <div className="relative">
                    <div className="absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-50"></div>
                    <p className="text-xs font-bold text-gray-900">
                      Refund Initiated
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {new Date(refund.createdAt).toLocaleString("en-IN")}
                    </p>
                    <p className="mt-1 text-[10px] italic text-gray-400">
                      Reason: {refund.reason}
                    </p>
                  </div>

                  {refund.status === "SUCCESS" && refund.processedAt && (
                    <div className="relative">
                      <div className="absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-50"></div>
                      <p className="text-xs font-bold text-gray-900">
                        Processed Successfully
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(refund.processedAt).toLocaleString("en-IN")}
                      </p>
                    </div>
                  )}

                  {refund.status === "FAILED" && (
                    <div className="relative">
                      <div className="absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-4 ring-red-50"></div>
                      <p className="text-xs font-bold text-gray-900">
                        Refund Failed
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Please contact support for manual processing.
                      </p>
                    </div>
                  )}

                  {refund.status === "ONHOLD" && (
                    <div className="relative">
                      <div className="absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full bg-yellow-500 ring-4 ring-yellow-50"></div>
                      <p className="text-xs font-bold text-gray-900">
                        Gateway Hold
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Cashfree is holding this refund temporarily. We will keep checking and update this invoice automatically.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4 border-t border-gray-50 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Live Invoice QR
                </p>
                <p className="mt-1 text-xs text-gray-500">{qrExpiryLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => void refreshInvoiceQr()}
                disabled={isPreparingQr}
                className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPreparingQr ? "Refreshing..." : "Refresh QR"}
              </button>
            </div>

            <div className="flex flex-col items-center justify-center rounded-3xl bg-gradient-to-b from-slate-50 to-white px-4 py-5 shadow-inner">
              <div className="rounded-[28px] border border-slate-100 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                {qrCodeDataUrl && !qrError ? (
                  <img
                    src={qrCodeDataUrl}
                    alt={`QR code for ${invoiceNumber}`}
                    className="h-44 w-44 rounded-2xl object-contain"
                  />
                ) : (
                  <div className="flex h-44 w-44 items-center justify-center rounded-2xl bg-slate-50 text-center text-xs font-semibold text-slate-400">
                    {isPreparingQr ? "Generating live invoice QR..." : "QR unavailable"}
                  </div>
                )}
              </div>

              <p className="mt-4 text-center text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
                Scan to download invoice PDF
              </p>
              <p className="mt-2 max-w-[260px] text-center text-xs leading-5 text-slate-500">
                This QR is unique to this invoice session and opens a signed PDF download link.
              </p>
              {qrError && (
                <p className="mt-3 max-w-[280px] text-center text-xs font-medium text-red-500">
                  {qrError}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-gray-500 transition-colors hover:text-gray-900"
          >
            Close
          </button>
          <button
            className="rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-black active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleDownloadPdf()}
            disabled={isDownloadingPdf || isPreparingQr}
          >
            {isDownloadingPdf ? "Preparing PDF..." : "Download PDF"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceModal;
