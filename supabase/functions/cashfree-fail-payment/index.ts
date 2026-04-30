import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { assertAllowedOrigin, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { buildRateLimitKey, enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";
import {
  deactivateBookingPaymentsForRetry,
  fetchBookingForAccess,
  fetchPaymentByInput,
} from "../_shared/cashfree-payments.ts";

const getObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

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
    const bookingId = String(payload?.bookingId || payload?.booking_id || "").trim();
    const orderId = String(payload?.orderId || payload?.order_id || "").trim();
    const paymentType = String(payload?.paymentType || payload?.payment_type || "").trim();
    const metadata = getObject(payload?.metadata);
    const reason = String(
      payload?.reason ||
      payload?.failureReason ||
      payload?.failure_reason ||
      "Payment cancelled by customer",
    ).trim();

    if (!bookingId && !orderId) {
      return jsonResponse(req, { success: false, error: "Missing bookingId or orderId" }, 400);
    }

    const { supabase, user } = await requireAuthenticatedUser(req);
    const failPaymentLimit = await enforceRateLimit(
      buildRateLimitKey("cashfree-fail-payment", user.id, getClientIp(req)),
      10,
      10,
    );
    if (!failPaymentLimit.allowed) {
      return jsonResponse(
        req,
        { success: false, error: "Too many payment cancellation requests. Please try again shortly." },
        429,
      );
    }
    const payment = await fetchPaymentByInput(supabase, {
      orderId: orderId || undefined,
      bookingId: bookingId || undefined,
    });

    const resolvedBookingId = bookingId || String(payment?.booking_id || "").trim();
    if (!resolvedBookingId) {
      return jsonResponse(req, { success: true, booking_id: bookingId || null, payment_ids: [] });
    }

    const booking = await fetchBookingForAccess(supabase, resolvedBookingId);
    if (user.id !== booking.customer_id && user.id !== booking.owner_id) {
      return jsonResponse(req, { success: false, error: "Unauthorized" }, 401);
    }

    const cleanup = await deactivateBookingPaymentsForRetry(supabase, {
      bookingId: resolvedBookingId,
      paymentType: paymentType || payment?.payment_type || undefined,
      metadata: metadata || getObject(payment?.metadata) || null,
      reason,
      replacementOrderId: null,
    });

    return jsonResponse(req, {
      success: true,
      booking_id: resolvedBookingId,
      payment_ids: cleanup.paymentIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update payment status";
    const statusCode = /unauthorized|token/i.test(message)
      ? 401
      : /not found/i.test(message)
        ? 404
        : 400;

    return jsonResponse(req, { success: false, error: message }, statusCode);
  }
});
