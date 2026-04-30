import { invokeProtectedEdgeFunction } from "./protected-edge.service";

export type BookingInvoiceLinkResponse = {
  success: boolean;
  invoice_number: string;
  download_url: string;
  expires_at: string;
};

export const invoiceService = {
  createBookingInvoiceLink: async (
    bookingId: string,
  ): Promise<BookingInvoiceLinkResponse> =>
    invokeProtectedEdgeFunction<BookingInvoiceLinkResponse>(
      "booking-invoice-link",
      { bookingId },
      "Unable to prepare the invoice QR.",
    ),
};
