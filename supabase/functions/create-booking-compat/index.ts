import { requireAuthenticatedUser } from "../_shared/auth.ts";
import {
  assertAllowedOrigin,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";

const normalize = (value: unknown): string => String(value || "").trim();
const lower = (value: unknown): string => normalize(value).toLowerCase();
const toNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const ACTIVE_STAY_STATUSES = new Set(["checked-in", "checked_in", "active", "ongoing", "booked", "vacate_requested", "vacate-requested"]);
const PRE_CHECKIN_BOOKING_STATUSES = new Set([
  "requested",
  "pending",
  "approved",
  "accepted",
  "confirmed",
  "paid",
  "payment_pending",
  "payment-pending",
  "payment_failed",
  "payment-failed",
  "rejected",
  "cancelled",
  "refunded",
]);
const OWNER_PROGRESS_STATUSES = new Set(["approved", "accepted", "confirmed", "requested", "pending"]);
const PAID_PAYMENT_STATUSES = new Set(["paid", "completed", "success", "authorized"]);
const FINAL_ROOM_RELEASE_STATUSES = new Set([
  "cancelled",
  "cancelled_by_customer",
  "cancelled-by-customer",
  "rejected",
  "refunded",
  "checked-out",
  "checked_out",
  "vacated",
  "completed",
  "payment_failed",
]);

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

    const propertyId = normalize(body.propertyId || body.property_id);
    const roomIdRaw = normalize(body.roomId || body.room_id);
    const roomId = roomIdRaw && roomIdRaw !== "generic" && roomIdRaw !== "Assigned" ? roomIdRaw : null;
    const ownerId = normalize(body.ownerId || body.owner_id);
    const customerId = normalize(body.customerId || body.customer_id);
    const customerName = normalize(body.customerName || body.customer_name);
    const customerPhone = normalize(body.customerPhone || body.customer_phone);
    const customerEmail = normalize(body.customerEmail || body.customer_email);
    const roomNumber = normalize(body.roomNumber || body.room_number);
    const startDate = normalize(body.startDate || body.start_date);
    const endDate = normalize(body.endDate || body.end_date);
    const paymentType = normalize(body.paymentType || body.payment_type || "advance");
    const transactionId = normalize(body.transactionId || body.transaction_id);
    const status = normalize(body.status || body.booking_status || "payment_pending");
    const amountPaid = toNumber(body.amountPaid || body.amount_paid);
    const advancePaid = toNumber(body.advancePaid || body.advance_paid);
    const amountDue = toNumber(body.amountDue || body.amount_due || body.finalAmount || body.final_amount);
    const monthlyRent = toNumber(body.monthlyRent || body.monthly_rent);

    if (!propertyId || !ownerId || !customerId || !customerName || !customerPhone || !customerEmail || !startDate || !monthlyRent) {
      return errorResponse(req, 400, "Missing required booking fields", "invalid_booking_payload");
    }

    if (customerId !== user.id) {
      return errorResponse(req, 403, "Customer mismatch", "forbidden");
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("bookings")
      .select("id, property_id, status, stay_status, payment_status, amount_paid, vacate_date, properties(title)")
      .eq("customer_id", customerId)
      .is("vacate_date", null)
      .limit(25);

    if (existingError) throw existingError;

    const existingBookings = Array.isArray(existingRows) ? existingRows : [];

    const activeStay = existingBookings.find((booking) => {
      const normalizedStatus = lower(booking.status);
      const normalizedStayStatus = lower(booking.stay_status);
      const hasActiveResidentStatus = ACTIVE_STAY_STATUSES.has(normalizedStatus);
      const hasActiveResidentStayStatus = ACTIVE_STAY_STATUSES.has(normalizedStayStatus)
        && !PRE_CHECKIN_BOOKING_STATUSES.has(normalizedStatus);

      return hasActiveResidentStatus || hasActiveResidentStayStatus;
    });
    if (activeStay) {
      const propertyTitle = String((activeStay.properties as { title?: string } | null)?.title || "this PG").trim();
      const isVacateApprovalPending = lower(activeStay.stay_status) === "vacate_requested"
        || lower(activeStay.status) === "vacate_requested";
      if (isVacateApprovalPending) {
        return errorResponse(
          req,
          409,
          `VACATE_APPROVAL_PENDING: Your vacate request for ${propertyTitle} is still waiting for owner approval. Please wait for the owner to approve vacate before booking another PG.`,
          "vacate_approval_pending",
        );
      }
      return errorResponse(
        req,
        409,
        `ACTIVE_PG_BOOKING_EXISTS: You are already staying in ${propertyTitle}. Please vacate your current PG before booking another one.`,
        "active_pg_booking_exists",
      );
    }

    const protectedSamePropertyBooking = existingBookings.find((booking) => {
      if (normalize(booking.property_id) !== propertyId) return false;
      const normalizedStatus = lower(booking.status);
      const normalizedPaymentStatus = lower(booking.payment_status);
      const paidAmount = toNumber(booking.amount_paid);
      return OWNER_PROGRESS_STATUSES.has(normalizedStatus) && (
        normalizedStatus === "approved" ||
        normalizedStatus === "accepted" ||
        PAID_PAYMENT_STATUSES.has(normalizedPaymentStatus) ||
        paidAmount > 0
      );
    });

    if (protectedSamePropertyBooking) {
      return errorResponse(
        req,
        409,
        "ACTIVE_PG_BOOKING_EXISTS: You already have a pending request for this PG. Please wait for the owner to respond.",
        "active_pg_booking_exists",
      );
    }

    if (roomId) {
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("id, capacity")
        .eq("id", roomId)
        .maybeSingle();

      if (roomError) throw roomError;
      if (!room) {
        return errorResponse(req, 404, "Room not found", "room_not_found");
      }

      const { data: roomBookings, error: roomBookingsError } = await supabase
        .from("bookings")
        .select("id, status, payment_status, amount_paid, vacate_date")
        .eq("room_id", roomId)
        .is("vacate_date", null)
        .limit(100);

      if (roomBookingsError) throw roomBookingsError;

      const occupiedCount = (roomBookings || []).filter((booking) => {
        const normalizedStatus = lower(booking.status);
        const normalizedPaymentStatus = lower(booking.payment_status);
        const paidAmount = toNumber(booking.amount_paid);

        if (FINAL_ROOM_RELEASE_STATUSES.has(normalizedStatus)) return false;
        if (ACTIVE_STAY_STATUSES.has(normalizedStatus)) return true;
        if (normalizedStatus === "approved" || normalizedStatus === "accepted" || normalizedStatus === "confirmed") return true;
        return PAID_PAYMENT_STATUSES.has(normalizedPaymentStatus) || paidAmount > 0;
      }).length;

      if (occupiedCount >= Math.max(1, Number(room.capacity || 1))) {
        return errorResponse(req, 409, "ROOM_FULL", "room_full");
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from("bookings")
      .insert({
        property_id: propertyId,
        room_id: roomId,
        customer_id: customerId,
        owner_id: ownerId,
        status,
        start_date: startDate,
        end_date: endDate || null,
        monthly_rent: monthlyRent,
        advance_paid: advancePaid,
        amount_paid: amountPaid,
        payment_status: lower(status) === "paid" ? "paid" : "pending",
        amount_due: amountDue || null,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        room_number: roomNumber || null,
        transaction_id: transactionId || null,
        payment_type: paymentType || null,
        payment_provider: "cashfree",
        stay_status: null,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return jsonResponse(req, {
      success: true,
      booking_id: inserted.id,
      compatibility_mode: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create booking";
    if (message === "Missing bearer token" || message === "Invalid or expired auth token") {
      return errorResponse(req, 401, "Please sign in again", "auth_required");
    }
    return errorResponse(req, 400, message, "create_booking_compat_failed");
  }
});
