import { requireOwnerOrAdminUser } from "../_shared/auth.ts";
import {
  assertAllowedOrigin,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import { buildBookingStatusCopy, getBookingNotificationType } from "../_shared/notification-copy.ts";

const lower = (value: unknown) => String(value || "").trim().toLowerCase();
const normalize = (value: unknown) => String(value || "").trim();
const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const PAID_SIGNAL_STATUSES = new Set([
  "paid",
  "completed",
  "success",
  "authorized",
  "verified",
  "held",
  "eligible",
  "payout_pending",
  "paid_pending_owner_acceptance",
]);

const ACTIVE_OTHER_STAY_STATUSES = new Set([
  "checked-in",
  "checked_in",
  "active",
  "ongoing",
  "vacate_requested",
]);

const SUCCESS_PAYMENT_STATUSES = new Set([
  "paid",
  "completed",
  "success",
  "authorized",
  "verified",
  "held",
  "eligible",
  "payout_pending",
  "paid_pending_owner_acceptance",
]);

const isMissingBookingColumnError = (error: unknown, columnName: string) => {
  const code = String((error as { code?: string } | null)?.code || "").trim();
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return (
    (code === "42703" && message.includes(`column bookings.${columnName.toLowerCase()} does not exist`)) ||
    (code === "PGRST204" && message.includes(`could not find the '${columnName.toLowerCase()}' column of 'bookings'`))
  );
};

const getMissingBookingColumnFromError = (error: unknown): string => {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  const match =
    message.match(/column bookings\.([a-z0-9_]+) does not exist/) ||
    message.match(/could not find the '([a-z0-9_]+)' column of 'bookings'/);
  return match?.[1] || "";
};

const fetchBookingForApproval = async (supabase: any, bookingId: string) => {
  const richSelect =
    "id, owner_id, customer_id, property_id, room_id, room_number, currency, status, booking_status, payment_status, advance_paid, amount_paid, owner_accept_status";
  const legacySelect =
    "id, owner_id, customer_id, property_id, room_id, room_number, currency, status, payment_status, advance_paid, amount_paid";

  let { data, error } = await supabase
    .from("bookings")
    .select(richSelect)
    .eq("id", bookingId)
    .maybeSingle();

  if (error && (isMissingBookingColumnError(error, "booking_status") || isMissingBookingColumnError(error, "owner_accept_status"))) {
    ({ data, error } = await supabase
      .from("bookings")
      .select(legacySelect)
      .eq("id", bookingId)
      .maybeSingle());
  }

  if (error) throw error;
  if (!data) throw new Error("BOOKING_NOT_FOUND");
  return data;
};

const resolveNotificationPaymentAmount = async (supabase: any, booking: Record<string, unknown>) => {
  const bookingId = normalize(booking.id);
  if (!bookingId) {
    return toNumber(booking.amount_paid) || toNumber(booking.advance_paid);
  }

  const { data, error } = await supabase
    .from("payments")
    .select("amount, status, payment_status, payment_type, created_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw error;
  }

  const paidRow = (Array.isArray(data) ? data : []).find((payment: Record<string, unknown>) => {
    const status = lower(payment.payment_status || payment.status);
    return SUCCESS_PAYMENT_STATUSES.has(status) && toNumber(payment.amount) > 0;
  });

  if (paidRow) {
    return toNumber(paidRow.amount);
  }

  return toNumber(booking.amount_paid) || toNumber(booking.advance_paid);
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
      .select("id, status, payment_status")
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

    if (!bookingId) {
      return errorResponse(req, 400, "Missing booking id", "invalid_booking_id");
    }

    const booking = await fetchBookingForApproval(supabase, bookingId);

    if (role !== "admin" && normalize(booking.owner_id) !== user.id) {
      return errorResponse(req, 403, "You are not allowed to update this booking.", "forbidden");
    }

    const status = lower(booking.status);
    const bookingStatus = lower(booking.booking_status);
    if (
      ["rejected", "cancelled", "refunded", "checked-out", "checked_out", "completed"].includes(status) ||
      ["rejected", "cancelled", "refunded", "checked-out", "checked_out", "completed"].includes(bookingStatus)
    ) {
      return errorResponse(req, 409, "This booking is no longer in a state that allows approval.", "invalid_status");
    }

    const hasPaidSignal =
      PAID_SIGNAL_STATUSES.has(lower(booking.payment_status)) ||
      toNumber(booking.advance_paid) > 0 ||
      toNumber(booking.amount_paid) > 0;

    if (!hasPaidSignal) {
      return errorResponse(
        req,
        409,
        "Advance payment is not verified yet. Wait for payment confirmation before approving this booking.",
        "charge_not_confirmed",
      );
    }

    const { data: activeStayRows, error: activeStayError } = await supabase
      .from("bookings")
      .select("id, property_id, status, vacate_date")
      .eq("customer_id", booking.customer_id)
      .neq("id", booking.id)
      .neq("property_id", booking.property_id)
      .is("vacate_date", null)
      .limit(25);

    if (activeStayError) throw activeStayError;

    const hasOtherActiveStay = (activeStayRows || []).some((row: Record<string, unknown>) => {
      const candidateStatus = lower(row.status);
      return ACTIVE_OTHER_STAY_STATUSES.has(candidateStatus);
    });

    if (hasOtherActiveStay) {
      return errorResponse(
        req,
        409,
        "Customer is already checked into another property. They must vacate before this action can continue.",
        "stay_conflict",
      );
    }

    const approvedBooking = await updateBookingWithCompatibility(supabase, bookingId, {
      status: ["approved", "accepted", "confirmed", "checked-in", "checked_in", "active", "ongoing", "vacate_requested"].includes(status)
        ? booking.status
        : "approved",
      booking_status: ["approved", "accepted", "confirmed", "checked-in", "checked_in", "active", "ongoing", "vacate_requested"].includes(bookingStatus)
        ? booking.booking_status
        : "approved",
      owner_accept_status: true,
      updated_at: new Date().toISOString(),
    });

    const notificationAmount = await resolveNotificationPaymentAmount(supabase, booking);

    const notificationCopy = buildBookingStatusCopy({
      kind: "approved",
      roomNumber: booking.room_number,
      amount: notificationAmount,
      currency: booking.currency,
    });

    if (normalize(booking.customer_id)) {
      const notificationType = getBookingNotificationType("approved");
      await insertNotificationSafe(supabase, {
        user_id: booking.customer_id,
        title: notificationCopy.title,
        message: notificationCopy.message,
        type: "booking",
        notification_type: notificationType,
        status: "queued",
        data: { booking_id: bookingId, status: "approved" },
        is_read: false,
      });
    }

    return jsonResponse(req, {
      success: true,
      booking: approvedBooking,
      compatibility_mode: true,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Booking approval failed");
    if (message === "Missing bearer token" || message === "Invalid or expired auth token") {
      return errorResponse(req, 401, "Please sign in again", "auth_required");
    }
    if (message === "BOOKING_NOT_FOUND") {
      return errorResponse(req, 404, "Booking not found.", "booking_not_found");
    }
    return errorResponse(req, 400, message, "owner_accept_booking_compat_failed");
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
