import { requireAuthenticatedUser } from "../_shared/auth.ts";
import {
  fetchCashfreePgOrder,
  fetchCashfreePgOrderPayments,
  fetchCashfreeRefund,
  fetchCashfreeTransfer,
} from "../_shared/cashfree.ts";
import {
  fetchBookingForAccess,
  fetchPaymentByInput,
} from "../_shared/cashfree-payments.ts";
import { assertAllowedOrigin, errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { buildRateLimitKey, enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";

const getRole = async (supabase: any, userId: string): Promise<string> => {
  const { data, error } = await supabase
    .from("accounts")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return String(data?.role || "").toLowerCase();
};

const canAccessBooking = (
  userId: string,
  role: string,
  booking: { customer_id?: string | null; owner_id?: string | null },
): boolean =>
  role === "admin" ||
  userId === String(booking.customer_id || "") ||
  userId === String(booking.owner_id || "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (!assertAllowedOrigin(req)) {
    return errorResponse(req, 403, "Origin is not allowed");
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const kind = String(payload?.kind || payload?.type || "").trim().toLowerCase();
    const orderId = String(payload?.orderId || payload?.order_id || "").trim();
    const bookingId = String(payload?.bookingId || payload?.booking_id || "").trim();
    const refundId = String(payload?.refundId || payload?.refund_id || "").trim();
    const transferId = String(payload?.transferId || payload?.transfer_id || "").trim();

    if (!kind) {
      return errorResponse(req, 400, "Missing kind");
    }

    const { supabase, user } = await requireAuthenticatedUser(req);
    const gatewayProbeLimit = await enforceRateLimit(
      buildRateLimitKey("cashfree-gateway-probe", user.id, getClientIp(req)),
      20,
      10,
    );
    if (!gatewayProbeLimit.allowed) {
      return errorResponse(req, 429, "Too many gateway probe requests");
    }
    const role = await getRole(supabase, user.id);

    if (["order", "payments", "refund"].includes(kind)) {
      if (!orderId && !bookingId) {
        return errorResponse(req, 400, "Missing orderId or bookingId");
      }

      const payment = await fetchPaymentByInput(supabase, {
        orderId: orderId || undefined,
        bookingId: bookingId || undefined,
      });

      if (!payment) {
        return errorResponse(req, 404, "Payment not found");
      }

      const booking = await fetchBookingForAccess(supabase, payment.booking_id);
      if (!canAccessBooking(user.id, role, booking)) {
        return errorResponse(req, 401, "Unauthorized");
      }

      const effectiveOrderId = String(payment.provider_order_id || orderId || "").trim();
      if (!effectiveOrderId) {
        return errorResponse(req, 400, "Missing provider order id");
      }

      if (kind === "order") {
        const data = await fetchCashfreePgOrder(effectiveOrderId);
        return jsonResponse(req, {
          success: true,
          kind,
          booking_id: payment.booking_id,
          order_id: effectiveOrderId,
          data,
        });
      }

      if (kind === "payments") {
        const data = await fetchCashfreePgOrderPayments(effectiveOrderId);
        return jsonResponse(req, {
          success: true,
          kind,
          booking_id: payment.booking_id,
          order_id: effectiveOrderId,
          data,
        });
      }

      if (!refundId) {
        return errorResponse(req, 400, "Missing refundId");
      }

      const data = await fetchCashfreeRefund(effectiveOrderId, refundId);
      return jsonResponse(req, {
        success: true,
        kind,
        booking_id: payment.booking_id,
        order_id: effectiveOrderId,
        refund_id: refundId,
        data,
      });
    }

    if (kind === "transfer") {
      if (!transferId) {
        return errorResponse(req, 400, "Missing transferId");
      }

      const { data: settlement, error } = await supabase
        .from("settlements")
        .select("id, owner_id, booking_id, provider_transfer_id")
        .eq("provider_transfer_id", transferId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!settlement) {
        return errorResponse(req, 404, "Settlement not found");
      }

      if (role !== "admin" && user.id !== String(settlement.owner_id || "")) {
        return errorResponse(req, 401, "Unauthorized");
      }

      const data = await fetchCashfreeTransfer(transferId);
      return jsonResponse(req, {
        success: true,
        kind,
        settlement_id: settlement.id,
        booking_id: settlement.booking_id,
        transfer_id: transferId,
        data,
      });
    }

    return errorResponse(req, 400, "Unsupported kind");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cashfree probe failed";
    const status = /unauthorized|token/i.test(message)
      ? 401
      : /not found/i.test(message)
        ? 404
        : 400;

    return errorResponse(req, status, message);
  }
});
