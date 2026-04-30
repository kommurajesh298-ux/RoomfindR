import { requireAuthenticatedUser } from "../_shared/auth.ts";
import {
  assertAllowedOrigin,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import {
  buildInvoiceNumber,
  createInvoiceToken,
} from "../_shared/invoice.ts";

const TOKEN_LIFETIME_SECONDS = 15 * 60;

const normalizeId = (value: unknown): string => String(value || "").trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);

  if (!assertAllowedOrigin(req)) {
    return errorResponse(req, 403, "Origin is not allowed", "origin_not_allowed");
  }

  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed", "method_not_allowed");
  }

  try {
    const { supabase, user } = await requireAuthenticatedUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const bookingId = normalizeId(body.bookingId || body.booking_id);

    if (!bookingId) {
      return errorResponse(req, 400, "Booking id is required", "booking_id_required");
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, customer_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;

    if (!booking) {
      return errorResponse(req, 404, "Booking not found", "booking_not_found");
    }

    if (String(booking.customer_id || "") !== user.id) {
      return errorResponse(req, 403, "You cannot access this invoice", "forbidden");
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + TOKEN_LIFETIME_SECONDS;
    const invoiceNumber = buildInvoiceNumber(bookingId);
    const token = await createInvoiceToken({
      bookingId,
      invoiceNumber,
      iat: issuedAt,
      exp: expiresAt,
      nonce: crypto.randomUUID(),
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

    if (!supabaseUrl) {
      throw new Error("Missing SUPABASE_URL");
    }

    return jsonResponse(req, {
      success: true,
      invoice_number: invoiceNumber,
      download_url: `${supabaseUrl}/functions/v1/download-booking-invoice?token=${encodeURIComponent(token)}`,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create invoice link";
    if (message === "Missing bearer token" || message === "Invalid or expired auth token") {
      return errorResponse(req, 401, "Please sign in again", "auth_required");
    }
    return errorResponse(req, 500, message, "create_invoice_link_failed");
  }
});
