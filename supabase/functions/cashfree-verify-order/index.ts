import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { assertAllowedOrigin, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { buildRateLimitKey, enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";
import {
  fetchBookingForAccess,
  fetchPaymentByInput,
  verifyCashfreePaymentStatus,
} from "../_shared/cashfree-payments.ts";

// Keep this entrypoint intentionally thin; compatibility is handled in shared helpers.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (!assertAllowedOrigin(req)) {
    return jsonResponse(req, { success: false, error: "Origin is not allowed" }, 403);
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const orderId = String(payload?.orderId || payload?.order_id || "").trim();
    const bookingId = String(payload?.bookingId || payload?.booking_id || "").trim();
    const paymentType = String(payload?.paymentType || payload?.payment_type || "").trim();
    const rawMetadata = payload?.metadata;
    const metadata = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
      ? rawMetadata as Record<string, unknown>
      : undefined;

    if (!orderId && !bookingId) {
      return jsonResponse(
        req,
        { success: false, error: "Missing orderId or bookingId" },
        400,
      );
    }

    const { supabase, user } = await requireAuthenticatedUser(req);
    const verifyOrderLimit = await enforceRateLimit(
      buildRateLimitKey("cashfree-verify-order", user.id, getClientIp(req)),
      20,
      10,
    );
    if (!verifyOrderLimit.allowed) {
      return jsonResponse(
        req,
        { success: false, error: "Too many verification requests. Please try again shortly." },
        429,
      );
    }
    const payment = await fetchPaymentByInput(supabase, {
      orderId: orderId || undefined,
      bookingId: bookingId || undefined,
      paymentType: paymentType || undefined,
      metadata,
    });

    if (!payment) {
      if (bookingId && !orderId) {
        const booking = await fetchBookingForAccess(supabase, bookingId);
        if (user.id !== booking.customer_id && user.id !== booking.owner_id) {
          return jsonResponse(req, { success: false, error: "Unauthorized" }, 401);
        }

        return jsonResponse(req, {
          success: false,
          status: "pending",
          booking_id: bookingId,
          order_status: null,
        });
      }

      return jsonResponse(req, { success: false, error: "Payment not found" }, 404);
    }

    const booking = await fetchBookingForAccess(supabase, payment.booking_id);
    if (user.id !== booking.customer_id && user.id !== booking.owner_id) {
      return jsonResponse(req, { success: false, error: "Unauthorized" }, 401);
    }

    const result = await verifyCashfreePaymentStatus(supabase, {
      orderId: orderId || payment.provider_order_id || undefined,
      bookingId: payment.booking_id,
      paymentType: paymentType || payment.payment_type || undefined,
      metadata,
    });

    return jsonResponse(req, {
      success: true,
      status: result.status,
      booking_id: result.bookingId,
      order_status: result.orderStatus || null,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String((error as { message?: string } | null)?.message || JSON.stringify(error) || "Verification failed");
    const statusCode = /unauthorized|token/i.test(message)
      ? 401
      : /not found/i.test(message)
        ? 404
        : 400;

    return jsonResponse(req, { success: false, error: message }, statusCode);
  }
});
