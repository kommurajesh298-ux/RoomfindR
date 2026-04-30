import { requireOwnerOrAdminUser } from "../_shared/auth.ts";
import {
  assertAllowedOrigin,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import { buildBookingStatusCopy, getBookingNotificationType } from "../_shared/notification-copy.ts";

const normalize = (value: unknown) => String(value || "").trim();
const lower = (value: unknown) => normalize(value).toLowerCase();

const getMissingBookingColumnFromError = (error: unknown): string => {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  const match =
    message.match(/column bookings\.([a-z0-9_]+) does not exist/) ||
    message.match(/could not find the '([a-z0-9_]+)' column of 'bookings'/);
  return match?.[1] || "";
};

const isMissingBookingColumnError = (error: unknown) => {
  const code = String((error as { code?: string } | null)?.code || "").trim();
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return (
    code === "42703" ||
    (code === "PGRST204" && message.includes("bookings"))
  );
};

const fetchBookingForRejection = async (supabase: any, bookingId: string) => {
  const selectCandidates = [
    "id, owner_id, customer_id, room_number, status, booking_status, payment_status, rejection_reason",
    "id, owner_id, customer_id, room_number, status, payment_status, rejection_reason",
    "id, owner_id, customer_id, room_number, status, payment_status",
  ];

  let data = null;
  let error = null;

  for (const selectClause of selectCandidates) {
    const result = await supabase
      .from("bookings")
      .select(selectClause)
      .eq("id", bookingId)
      .maybeSingle();

    data = result.data;
    error = result.error;

    if (!error || !isMissingBookingColumnError(error)) {
      break;
    }
  }

  if (error) throw error;
  if (!data) throw new Error("BOOKING_NOT_FOUND");
  return data;
};

const updateBookingWithCompatibility = async (
  supabase: any,
  bookingId: string,
  bookingUpdate: Record<string, unknown>,
) => {
  let nextUpdate = { ...bookingUpdate };

  while (Object.keys(nextUpdate).length > 0) {
    const { data, error } = await supabase
      .from("bookings")
      .update(nextUpdate)
      .eq("id", bookingId)
      .select("id, status, payment_status, rejection_reason")
      .maybeSingle();

    if (!error) return data;

    const missingColumn = getMissingBookingColumnFromError(error);
    if (!missingColumn || !(missingColumn in nextUpdate)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextUpdate;
    nextUpdate = rest;
  }

  throw new Error("BOOKING_UPDATE_FAILED");
};

const insertNotificationSafe = async (
  supabase: any,
  payload: Record<string, unknown>,
) => {
  let nextPayload = { ...payload };

  while (true) {
    const { error } = await supabase.from("notifications").insert(nextPayload);
    if (!error) return;

    const message = String(error.message || "").toLowerCase();
    if (!message.includes("column") && !message.includes("schema cache")) {
      throw error;
    }

    const missingColumn =
      message.match(/column notifications\.([a-z0-9_]+) does not exist/)?.[1] ||
      message.match(/could not find the '([a-z0-9_]+)' column of 'notifications'/)?.[1];

    if (!missingColumn || !(missingColumn in nextPayload)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextPayload;
    nextPayload = rest;
  }
};

const isCompletedPayment = (payment: Record<string, unknown> | null | undefined) => {
  const candidates = [
    lower(payment?.status),
    lower(payment?.payment_status),
  ];
  return candidates.some((status) =>
    ["completed", "success", "authorized", "paid"].includes(status)
  );
};

const fetchLatestCompletedPaymentForRefund = async (supabase: any, bookingId: string) => {
  const { data, error } = await supabase
    .from("payments")
    .select("id, booking_id, customer_id, amount, status, payment_status")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data || []).find((payment: Record<string, unknown>) => isCompletedPayment(payment)) || null;
};

const fetchExistingRefundRequest = async (supabase: any, paymentId: string) => {
  const selectCandidates = [
    "id, payment_id, booking_id, refund_amount, reason, status, created_at",
    "id, payment_id, booking_id, reason, status, created_at",
  ];

  for (const selectClause of selectCandidates) {
    const result = await supabase
      .from("refunds")
      .select(selectClause)
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!result.error) {
      return result.data || null;
    }

    const message = String(result.error.message || "").toLowerCase();
    if (!message.includes("column") && !message.includes("schema cache")) {
      throw result.error;
    }
  }

  return null;
};

const insertRefundRequestSafe = async (
  supabase: any,
  payload: Record<string, unknown>,
) => {
  let nextPayload = { ...payload };

  while (Object.keys(nextPayload).length > 0) {
    const { data, error } = await supabase
      .from("refunds")
      .insert(nextPayload)
      .select("id, payment_id, booking_id, reason, status, created_at")
      .single();

    if (!error) return data;

    const message = String(error.message || "").toLowerCase();
    const missingColumn =
      message.match(/column refunds\.([a-z0-9_]+) does not exist/)?.[1] ||
      message.match(/could not find the '([a-z0-9_]+)' column of 'refunds'/)?.[1];

    if (!missingColumn || !(missingColumn in nextPayload)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextPayload;
    nextPayload = rest;
  }

  throw new Error("Refund request preparation failed");
};

const prepareRefundRequestForRejectedBooking = async (
  supabase: any,
  booking: Record<string, unknown>,
  bookingId: string,
  reason: string,
) => {
  const payment = await fetchLatestCompletedPaymentForRefund(supabase, bookingId);
  if (!payment) {
    return { success: true, skipped: true, refund: null };
  }

  const existingRefund = await fetchExistingRefundRequest(supabase, String(payment.id || ""));
  if (existingRefund) {
    return { success: true, refund: existingRefund };
  }

  const refundAmount = Math.max(0, Number(payment.amount || 0));
  if (!refundAmount) {
    return { success: true, skipped: true, refund: null };
  }

  const refund = await insertRefundRequestSafe(supabase, {
    payment_id: payment.id,
    booking_id: bookingId,
    customer_id: booking.customer_id || payment.customer_id || null,
    refund_amount: refundAmount,
    reason,
    status: "PENDING",
    provider: "cashfree",
    provider_refund_id: null,
    processed_at: null,
  });

  return { success: true, refund };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);

  if (!assertAllowedOrigin(req)) {
    return errorResponse(req, 403, "Origin is not allowed", "origin_not_allowed");
  }

  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed", "method_not_allowed");
  }

  try {
    const { supabase, user, role } = await requireOwnerOrAdminUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const bookingId = normalize(body.bookingId || body.booking_id || body.p_booking_id);
    const reason = normalize(body.reason || body.p_reason || "Booking rejected by owner");

    if (!bookingId) {
      return errorResponse(req, 400, "Missing booking id", "invalid_booking_id");
    }

    const booking = await fetchBookingForRejection(supabase, bookingId);

    if (role !== "admin" && normalize(booking.owner_id) !== user.id) {
      return errorResponse(req, 403, "You are not allowed to update this booking.", "forbidden");
    }

    const currentStatus = lower(booking.status || booking.booking_status);
    if (["rejected", "cancelled", "refunded", "checked-out", "checked_out"].includes(currentStatus)) {
      return errorResponse(req, 409, "This booking cannot be rejected anymore.", "invalid_status");
    }

    const rejectedBooking = await updateBookingWithCompatibility(supabase, bookingId, {
      status: "rejected",
      booking_status: "rejected",
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    });

    if (normalize(booking.customer_id)) {
      const notificationCopy = buildBookingStatusCopy({
        kind: "rejected",
        roomNumber: booking.room_number,
        reason,
      });
      const notificationType = getBookingNotificationType("rejected");
      await insertNotificationSafe(supabase, {
        user_id: booking.customer_id,
        title: notificationCopy.title,
        message: notificationCopy.message,
        type: "booking",
        notification_type: notificationType,
        status: "queued",
        data: { booking_id: bookingId, status: "rejected" },
        is_read: false,
      });
    }

    const refundResponse = await prepareRefundRequestForRejectedBooking(
      supabase,
      booking,
      bookingId,
      reason,
    );

    return jsonResponse(req, {
      success: true,
      booking: rejectedBooking,
      refundPrepared: Boolean(refundResponse?.refund || refundResponse?.success),
      refund: refundResponse?.refund || null,
      compatibility_mode: true,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Booking rejection failed");
    if (message === "Missing bearer token" || message === "Invalid or expired auth token") {
      return errorResponse(req, 401, "Please sign in again", "auth_required");
    }
    if (message === "BOOKING_NOT_FOUND") {
      return errorResponse(req, 404, "Booking not found.", "booking_not_found");
    }
    return errorResponse(req, 400, message, "owner_reject_booking_compat_failed");
  }
});
const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  const message = String((error as { message?: string } | null)?.message || "").trim();
  if (message) {
    return message;
  }

  return fallback;
};
