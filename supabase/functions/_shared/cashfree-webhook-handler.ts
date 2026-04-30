import { createServiceClient } from "./supabase.ts";
import { handleCorsPreflight, jsonResponse } from "./http.ts";
import {
  fetchPaymentByGatewayMeta,
  fetchPaymentById,
  invalidateCashfreeOrderCache,
  isProcessedStatus,
  lower,
  markBookingFailed,
  markBookingPaid,
  updatePaymentWithCompatibility,
  upper,
} from "./cashfree-payments.ts";

const getRequiredEnv = (key: string): string => {
  const value = (Deno.env.get(key) || "").trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const getWebhookSecret = (): string => {
  const secret = String(
    Deno.env.get("CASHFREE_WEBHOOK_SECRET") ||
      Deno.env.get("CASHFREE_CLIENT_SECRET") ||
      "",
  ).trim();

  if (!secret) throw new Error("Missing CASHFREE_WEBHOOK_SECRET");
  return secret;
};

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= (left.codePointAt(index) ?? 0) ^ (right.codePointAt(index) ?? 0);
  }

  return result === 0;
};

const verifySignature = async (
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): Promise<boolean> => {
  if (!timestamp || !signature || !secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(timestamp + rawBody),
  );

  return timingSafeEqual(toBase64(signed), signature);
};

const mapRefundStatus = (status: string): string => {
  const normalized = upper(status);
  if (["SUCCESS", "PROCESSED"].includes(normalized)) return "SUCCESS";
  if (["FAILED", "CANCELLED", "REJECTED"].includes(normalized)) return "FAILED";
  if (normalized === "ONHOLD") return "ONHOLD";
  if (normalized === "PENDING") return "PROCESSING";
  return "PROCESSING";
};

const mapLegacyRefundStatus = (status: string): string => {
  const normalized = upper(status);
  if (["SUCCESS", "PROCESSED"].includes(normalized)) return "success";
  if (["FAILED", "CANCELLED", "REJECTED"].includes(normalized)) return "failed";
  if (normalized === "PENDING") return "pending";
  return "processing";
};

const isRefundEvent = (eventType: string): boolean =>
  ["refund_status_webhook", "auto_refund_status_webhook"].includes(eventType);

const isAllowedPaymentEvent = (eventType: string): boolean =>
  [
    "success_payment",
    "failed_payment",
    "user_dropped_payment",
    "payment_success_webhook",
    "payment_failed_webhook",
    "payment_user_dropped_webhook",
  ].includes(eventType);

const isSuccessEvent = (eventType: string): boolean =>
  ["success_payment", "payment_success_webhook"].includes(eventType);

const isFailureEvent = (eventType: string): boolean =>
  [
    "failed_payment",
    "user_dropped_payment",
    "payment_failed_webhook",
    "payment_user_dropped_webhook",
  ].includes(eventType);

const extractOrderId = (payload: any): string | null =>
  payload?.data?.order?.order_id ||
  payload?.order_id ||
  payload?.orderId ||
  payload?.data?.order_id ||
  null;

const extractGatewayPaymentId = (payload: any): string | null =>
  payload?.data?.payment?.cf_payment_id ||
  payload?.data?.payment?.payment_id ||
  payload?.payment_id ||
  payload?.data?.payment_id ||
  null;

const extractWebhookAmount = (payload: any): number | null => {
  const raw =
    payload?.data?.payment?.payment_amount ??
    payload?.data?.payment?.amount ??
    payload?.data?.order?.order_amount ??
    payload?.payment_amount ??
    payload?.amount ??
    null;

  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const extractRefundDetails = (payload: any) => {
  const refund =
    payload?.data?.refund ||
    payload?.data?.auto_refund ||
    payload?.refund ||
    payload?.data ||
    {};

  return {
    refundId: refund?.refund_id || payload?.refund_id || null,
    providerRefundId:
      refund?.cf_refund_id || refund?.provider_refund_id || null,
    refundStatus:
      refund?.refund_status || refund?.status || payload?.refund_status || null,
    refundAmount: refund?.refund_amount || payload?.refund_amount || null,
    refundReason:
      refund?.refund_reason || payload?.refund_reason || payload?.reason || null,
    orderId: refund?.order_id || payload?.order_id || null,
    paymentId:
      refund?.cf_payment_id ||
      refund?.payment_id ||
      payload?.payment_id ||
      null,
  };
};

const parseWebhookPayload = async (req: Request) => {
  const rawBody = await req.text();
  let payload: any = {};

  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = {};
  }

  return { rawBody, payload };
};

const verifyWebhookSignature = async (req: Request, rawBody: string) => {
  const secret = getWebhookSecret();
  const signature = req.headers.get("x-webhook-signature") || "";
  const timestamp = req.headers.get("x-webhook-timestamp") || "";
  const timestampMs = Number(timestamp) * 1000;

  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return { ok: false as const, error: "Stale webhook" };
  }

  const valid = await verifySignature(rawBody, timestamp, signature, secret);
  if (!valid) {
    return { ok: false as const, error: "Invalid signature" };
  }

  return { ok: true as const, timestamp };
};

const buildEventMeta = (payload: any, timestamp: string) => {
  const rawEventType =
    payload?.type ||
    payload?.event_type ||
    payload?.eventType ||
    payload?.data?.event_type ||
    "";

  const eventType = lower(rawEventType);
  const orderId = extractOrderId(payload);
  const paymentId = extractGatewayPaymentId(payload);
  const eventId =
    payload?.event_id ||
    payload?.data?.event_id ||
    `${eventType}:${orderId || ""}:${paymentId || ""}:${timestamp || ""}`;

  return {
    eventType,
    orderId,
    paymentId,
    eventId,
  };
};

const ensureIdempotency = async (supabase: any, meta: ReturnType<typeof buildEventMeta>, payload: any) => {
  if (!meta.eventId) return { ok: true as const };

  const { error } = await supabase.from("payment_attempts").insert({
    provider_event_id: String(meta.eventId),
    provider: "cashfree",
    provider_order_id: meta.orderId || null,
    provider_payment_id: meta.paymentId || null,
    status: "pending",
    raw_payload: payload,
  });

  if (error && error.code === "23505") {
    return { ok: false as const, duplicate: true as const };
  }

  if (error) throw error;
  return { ok: true as const };
};

const markPaymentAttemptStatus = async (
  supabase: any,
  paymentId: string,
  status: "success" | "failed",
) => {
  await supabase.from("payment_attempts")
    .update({ status })
    .eq("payment_id", paymentId);
};

const markPaymentRefunded = async (supabase: any, paymentId: string) => {
  await updatePaymentWithCompatibility(supabase, paymentId, {
    status: "refunded",
  });
};

const updateBookingRefunded = async (
  supabase: any,
  bookingId: string,
  paymentType?: string | null,
) => {
  const bookingUpdate: Record<string, unknown> = {
    status: "refunded",
    payment_status: "refunded",
  };

  const normalizedPaymentType = lower(paymentType || "");
  if (normalizedPaymentType === "monthly" || normalizedPaymentType === "rent") {
    bookingUpdate.rent_payment_status = "refunded";
  } else {
    bookingUpdate.advance_payment_status = "refunded";
  }

  await supabase.from("bookings").update(bookingUpdate).eq("id", bookingId);
};

const bookingHasOtherCompletedPayment = async (
  supabase: any,
  bookingId: string,
  paymentId: string,
) => {
  const { data, error } = await supabase
    .from("payments")
    .select("id")
    .eq("booking_id", bookingId)
    .in("status", ["completed", "success", "authorized"])
    .neq("id", paymentId)
    .limit(1);

  if (error) throw error;
  return !!(data && data.length > 0);
};

const shouldUpdateBookingToRefunded = async (
  supabase: any,
  booking: any,
  paymentId: string,
  refundReason: string | null,
) => {
  const reason = lower(refundReason || "");
  if (["duplicate_payment", "partial_payment", "auto_refund"].includes(reason)) {
    return false;
  }

  const hasOtherCompletedPayment = await bookingHasOtherCompletedPayment(
    supabase,
    booking.id,
    paymentId,
  );

  if (hasOtherCompletedPayment) return false;

  return [
    "rejected",
    "cancelled",
    "cancelled_by_customer",
    "cancelled-by-customer",
    "refunded",
  ].includes(lower(booking.status || "")) ||
    ["booking_failed", "payment_failed"].includes(reason);
};

const findRefundByMeta = async (
  supabase: any,
  input: { refundId?: string | null; providerRefundId?: string | null },
) => {
  if (!input.refundId && !input.providerRefundId) return null;

  let query = supabase.from("refunds").select("*");

  if (input.refundId && input.providerRefundId) {
    query = query.or(
      `refund_id.eq.${input.refundId},provider_refund_id.eq.${input.providerRefundId}`,
    );
  } else if (input.refundId) {
    query = query.eq("refund_id", input.refundId);
  } else if (input.providerRefundId) {
    query = query.eq("provider_refund_id", input.providerRefundId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const handleRefundWebhook = async (supabase: any, payload: any) => {
  const details = extractRefundDetails(payload);
  if (!details.refundId && !details.providerRefundId && !details.orderId && !details.paymentId) {
    return { handled: false as const };
  }

  let refund = await findRefundByMeta(supabase, {
    refundId: details.refundId,
    providerRefundId: details.providerRefundId,
  });

  let payment = null;

  if (!refund) {
    payment = await fetchPaymentByGatewayMeta(supabase, {
      orderId: details.orderId,
      paymentId: details.paymentId,
    });

    if (!payment) return { handled: false as const };

    const nextStatus = mapRefundStatus(String(details.refundStatus || "PROCESSING"));
    const legacyRefundStatus = mapLegacyRefundStatus(nextStatus);
    const refundId = details.refundId || `refund_${payment.id}`;

    const { data: created, error } = await supabase.from("refunds").insert({
      payment_id: payment.id,
      booking_id: payment.booking_id,
      customer_id: payment.customer_id || null,
      refund_amount: Number(details.refundAmount || payment.amount || 0),
      reason: details.refundReason || "Auto refund processed by gateway.",
      refund_reason: lower(details.refundReason || "auto_refund"),
      status: legacyRefundStatus,
      refund_status: nextStatus,
      refund_id: refundId,
      initiated_by: null,
      requested_by: null,
      provider: "cashfree",
      gateway_refund_id: details.providerRefundId || null,
      provider_refund_id: details.providerRefundId || null,
      processed_at: nextStatus === "SUCCESS" ? new Date().toISOString() : null,
      metadata: {
        initiated_by_role: "system",
        source: "cashfree-webhook",
      },
    }).select("*").single();

    if (error) throw error;
    refund = created;
  } else if (refund.payment_id) {
    payment = await fetchPaymentById(supabase, refund.payment_id);
  }

  if (!refund) return { handled: false as const };

  const nextStatus = mapRefundStatus(String(details.refundStatus || refund.status || "PROCESSING"));
  const legacyRefundStatus = mapLegacyRefundStatus(nextStatus);
  const update: Record<string, unknown> = {
    status: legacyRefundStatus,
    refund_status: nextStatus,
    gateway_refund_id: details.providerRefundId || refund.gateway_refund_id,
    provider_refund_id: details.providerRefundId || refund.provider_refund_id,
  };

  if (details.refundId && !refund.refund_id) {
    update.refund_id = details.refundId;
  }

  if (details.refundAmount) {
    update.refund_amount = Number(details.refundAmount);
  }

  if (details.refundReason) {
    update.refund_reason = lower(details.refundReason);
    update.reason = details.refundReason;
  }

  if (nextStatus === "SUCCESS") {
    update.processed_at = new Date().toISOString();
  }

  await supabase.from("refunds").update(update).eq("id", refund.id);

  if (nextStatus === "SUCCESS" && payment) {
    await markPaymentRefunded(supabase, payment.id);
    await invalidateCashfreeOrderCache(payment.provider_order_id);

    const { data: booking, error } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("id", payment.booking_id)
      .maybeSingle();

    if (error) throw error;
    if (booking) {
      const shouldUpdate = await shouldUpdateBookingToRefunded(
        supabase,
        booking,
        payment.id,
        details.refundReason || refund.refund_reason,
      );

      if (shouldUpdate) {
        await updateBookingRefunded(supabase, booking.id, payment.payment_type);
      }
    }
  }

  return { handled: true as const };
};

const handlePaymentEvent = async (
  supabase: any,
  payload: any,
  meta: ReturnType<typeof buildEventMeta>,
) => {
  if (!meta.orderId && !meta.paymentId) return { handled: false as const };

  const payment = await fetchPaymentByGatewayMeta(supabase, {
    orderId: meta.orderId,
    paymentId: meta.paymentId,
  });

  if (!payment) return { handled: false as const };
  if (isProcessedStatus(payment.status)) {
    return { handled: true as const, duplicate: true as const };
  }

  const webhookAmount = extractWebhookAmount(payload);
  const storedAmount = Number(payment.amount || 0);
  if (
    webhookAmount !== null &&
    Number.isFinite(storedAmount) &&
    storedAmount > 0 &&
    Math.abs(webhookAmount - storedAmount) > 0.01
  ) {
    throw new Error("Webhook amount mismatch");
  }

  if (isSuccessEvent(meta.eventType)) {
    const update = {
      status: "completed",
      provider_payment_id: meta.paymentId || payment.provider_payment_id,
      verified_at: new Date().toISOString(),
      webhook_received: true,
      failure_reason: null,
    };

    await updatePaymentWithCompatibility(supabase, payment.id, update);
    await markBookingPaid(supabase, payment.booking_id, { ...payment, ...update });
    await markPaymentAttemptStatus(supabase, payment.id, "success");
    return { handled: true as const };
  }

  if (isFailureEvent(meta.eventType)) {
    const update = {
      status: "failed",
      provider_payment_id: meta.paymentId || payment.provider_payment_id,
      failure_reason: payload?.data?.payment?.payment_message || "Payment failed",
      webhook_received: true,
    };

    await updatePaymentWithCompatibility(supabase, payment.id, update);
    await markBookingFailed(supabase, payment.booking_id, { ...payment, ...update });
    await markPaymentAttemptStatus(supabase, payment.id, "failed");
    return { handled: true as const };
  }

  return { handled: false as const };
};

export const handleCashfreeWebhookRequest = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "Method not allowed" }, 405);
  }

  const { rawBody, payload } = await parseWebhookPayload(req);

  try {
    const supabase = createServiceClient();
    const verified = await verifyWebhookSignature(req, rawBody);
    if (!verified.ok) {
      return jsonResponse(req, { success: false, error: verified.error }, 401);
    }

    const meta = buildEventMeta(payload, verified.timestamp);

    if (isRefundEvent(meta.eventType)) {
      const result = await handleRefundWebhook(supabase, payload);
      return jsonResponse(req, { success: true, handled: result.handled });
    }

    if (!isAllowedPaymentEvent(meta.eventType)) {
      return jsonResponse(req, { success: true, ignored: true });
    }

    const existingPayment = await fetchPaymentByGatewayMeta(supabase, {
      orderId: meta.orderId,
      paymentId: meta.paymentId,
    });
    if (existingPayment && isProcessedStatus(existingPayment.status)) {
      return jsonResponse(req, { success: true, duplicate: true });
    }

    const idempotency = await ensureIdempotency(supabase, meta, payload);
    if (!idempotency.ok && idempotency.duplicate) {
      return jsonResponse(req, { success: true, duplicate: true });
    }

    const result = await handlePaymentEvent(supabase, payload, meta);
    if (result.handled) {
      return jsonResponse(req, { success: true });
    }

    return jsonResponse(req, { success: true, ignored: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failure";
    return jsonResponse(req, { success: false, error: message });
  }
};
