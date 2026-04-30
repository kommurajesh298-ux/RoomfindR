import {
  requireAuthenticatedUser,
  requireAdminUser,
  requireOwnerOrAdminUser,
} from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { fetchCashfreeRefund } from "../_shared/cashfree.ts";
import {
  assertAllowedOrigin,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import { buildRefundCustomerCopy } from "../_shared/notification-copy.ts";

const getEnv = (key: string) => Deno.env.get(key) ?? "";
const cleanEnv = (value: string) => value.replaceAll(/["']/g, "").trim();
const normalizeHeaderToken = (value: string | null) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  const [scheme, token] = normalized.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) {
    return token.trim();
  }

  return normalized;
};

const json = (req: Request, body: unknown, status = 200) =>
  jsonResponse(req, body, status);

const lower = (val: unknown) => String(val || "").trim().toLowerCase();
const upper = (val: unknown) => String(val || "").trim().toUpperCase();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isMissingGatewayRefundError = (error: unknown) =>
  String((error as { message?: string } | null)?.message || error || "")
    .trim()
    .toLowerCase()
    .includes("refund does not exist");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asUuidOrNull = (value: unknown) => {
  const normalized = String(value || "").trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
};

const ensureUuid = (value: unknown) => asUuidOrNull(value) || crypto.randomUUID();
const hasOwn = (value: unknown, key: string) =>
  Boolean(value) && Object.prototype.hasOwnProperty.call(value as Record<string, unknown>, key);

type RefundAction = "prepare" | "process" | "reject" | "sync";

type RefundPayload = {
  payload: Record<string, unknown>;
  action: RefundAction;
  bookingId: string | null;
  paymentId: string | null;
  refundRowId: string | null;
  reason: string;
  refundReason: string | null;
  initiatedBy: string;
  requestedByUserId: string | null;
  refundAmount: number | null;
  commissionAmount: number | null;
};

const getCashfreeConfig = () => {
  const env = (getEnv("CASHFREE_ENV") || "test").toLowerCase();
  const isProd = env === "production" || env === "prod";
  const clientId = cleanEnv(getEnv("CASHFREE_CLIENT_ID"));
  const clientSecret = cleanEnv(getEnv("CASHFREE_CLIENT_SECRET"));
  const apiVersion = cleanEnv(getEnv("CASHFREE_API_VERSION") || "2025-01-01");
  if (!clientId || !clientSecret) throw new Error("Cashfree credentials missing");
  return {
    baseUrl: isProd
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg",
    clientId,
    clientSecret,
    apiVersion,
  };
};

const parseRefundPayload = async (req: Request): Promise<RefundPayload> => {
  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const requestedAction = lower(
    payload.action || payload.refundAction || "",
  );

  if (!requestedAction || !["prepare", "process", "reject", "sync"].includes(requestedAction)) {
    throw new Error("Explicit refund action is required");
  }

  const action = requestedAction as RefundAction;

  const rawRefundAmount = Number(
    payload.refundAmount || payload.refund_amount || 0,
  );
  const rawCommissionAmount = Number(
    payload.commissionAmount || payload.commission_amount || 0,
  );
  const refundRef =
    payload.refundRowId ||
    payload.refund_row_id ||
    payload.refundId ||
    payload.refund_id ||
    null;

  return {
    payload,
    action,
    bookingId: String(payload.bookingId || payload.booking_id || "").trim() || null,
    paymentId: String(payload.paymentId || payload.payment_id || "").trim() || null,
    refundRowId: String(refundRef || "").trim() || null,
    reason:
      String(
        payload.reason || payload.refund_note || payload.refund_reason || "",
      ).trim() || "Refund initiated",
    refundReason:
      String(payload.refundReason || payload.refund_reason || "").trim() || null,
    initiatedBy:
      String(payload.initiatedBy || payload.initiated_by || "").trim() || "system",
    requestedByUserId:
      String(payload.requestedByUserId || payload.requested_by_user_id || payload.requestedBy || "").trim() || null,
    refundAmount:
      Number.isFinite(rawRefundAmount) && rawRefundAmount > 0
        ? rawRefundAmount
        : null,
    commissionAmount:
      Number.isFinite(rawCommissionAmount) && rawCommissionAmount >= 0
        ? rawCommissionAmount
        : null,
  };
};

const isInternalServiceRequest = async (req: Request): Promise<boolean> => {
  const validKeys = new Set<string>();
  const envKey = cleanEnv(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SERVICE_ROLE_KEY") ||
      "",
  );
  if (envKey) {
    validKeys.add(envKey);
  }

  const requestToken =
    normalizeHeaderToken(req.headers.get("x-supabase-auth")) ||
    normalizeHeaderToken(req.headers.get("authorization")) ||
    normalizeHeaderToken(req.headers.get("apikey"));

  if (!requestToken) return false;
  if (validKeys.has(requestToken)) return true;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("config")
      .select("value")
      .eq("key", "supabase_service_role_key")
      .maybeSingle();

    if (error) {
      return false;
    }

    const configKey = cleanEnv(String(data?.value || ""));
    if (configKey) {
      validKeys.add(configKey);
    }
  } catch (error) {
    return false;
  }

  return validKeys.has(requestToken);
};

const fetchBooking = async (supabase: any, bookingId: string) => {
  const selectCandidates = [
    "id, status, customer_id, owner_id, customer_name, room_number, payment_status, admin_approved, amount_due, amount_paid, advance_paid, monthly_rent, currency",
    "id, status, customer_id, owner_id, customer_name, room_number, payment_status, amount_due, amount_paid, advance_paid, monthly_rent, currency",
  ];

  let booking = null;
  let error = null;

  for (const selectClause of selectCandidates) {
    const result = await supabase
      .from("bookings")
      .select(selectClause)
      .eq("id", bookingId)
      .maybeSingle();

    booking = result.data;
    error = result.error;

    if (!error || !isMissingColumnError(error, "bookings.admin_approved")) {
      break;
    }
  }

  if (error) throw error;
  if (!booking) throw new Error("Booking not found");
  return {
    admin_approved: null,
    ...booking,
  };
};

const isCompletedPayment = (payment: any) => {
  const candidates = [
    lower(payment?.status),
    lower(payment?.payment_status),
  ];
  return candidates.some((status) =>
    ["completed", "success", "authorized", "paid"].includes(status)
  );
};

const fetchPaymentById = async (supabase: any, paymentId: string) => {
  const { data: payment, error } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (error) throw error;
  if (!payment) throw new Error("Payment not found");
  return payment;
};

const fetchLatestCompletedPaymentForBooking = async (
  supabase: any,
  bookingId: string,
) => {
  const { data: payments, error } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (payments || []).find((payment: any) => isCompletedPayment(payment)) || null;
};

const resolveRefundablePayment = async (
  supabase: any,
  input: { bookingId?: string | null; paymentId?: string | null },
) => {
  if (input.paymentId) {
    const payment = await fetchPaymentById(supabase, input.paymentId);
    if (!isCompletedPayment(payment)) {
      throw new Error("Payment not eligible for refund");
    }
    return payment;
  }

  if (!input.bookingId) return null;
  return fetchLatestCompletedPaymentForBooking(supabase, input.bookingId);
};

const findExistingRefund = async (
  supabase: any,
  input: {
    refundRowId?: string | null;
    paymentId?: string | null;
  },
) => {
  if (input.refundRowId) {
    const byIdQuery = asUuidOrNull(input.refundRowId)
      ? supabase.from("refunds").select("*").eq("id", input.refundRowId)
      : supabase.from("refunds").select("*").eq("refund_id", input.refundRowId);

    const { data, error } = await byIdQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  if (!input.paymentId) return null;

  const { data, error } = await supabase
    .from("refunds")
    .select("*")
    .eq("payment_id", input.paymentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

const findOrCreateOrder = async (supabase: any, payment: any) => {
  if (payment.booking_id) {
    const { data: bookingOrder, error: bookingOrderError } = await supabase
      .from("orders")
      .select("*")
      .eq("booking_id", payment.booking_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bookingOrderError && isMissingTableError(bookingOrderError, "orders")) {
      return null;
    }
    if (bookingOrderError) throw bookingOrderError;
    if (bookingOrder) return bookingOrder;
  }

  if (payment.provider_order_id) {
    const { data: providerOrder, error: providerOrderError } = await supabase
      .from("orders")
      .select("*")
      .eq("cashfree_order_id", payment.provider_order_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (providerOrderError && isMissingTableError(providerOrderError, "orders")) {
      return null;
    }
    if (providerOrderError) throw providerOrderError;
    if (providerOrder) return providerOrder;
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, customer_id, owner_id, commission_amount")
    .eq("id", payment.booking_id)
    .maybeSingle();

  if (bookingError) throw bookingError;

  const paymentType = lower(payment.payment_type || "");
  const orderType = paymentType === "monthly" ? "rent" : "advance";
  const amount = Number(payment.amount || 0);

  const { data: createdOrder, error: createOrderError } = await supabase
    .from("orders")
    .insert({
      customer_id: payment.customer_id || booking?.customer_id || null,
      owner_id: booking?.owner_id || null,
      amount_total: amount,
      amount_advance: orderType === "advance" ? amount : 0,
      commission_amount: Number(booking?.commission_amount || 0),
      status: "paid",
      trace_id: crypto.randomUUID().replaceAll("-", ""),
      metadata: {
        source: "cashfree-refund",
        booking_id: payment.booking_id || null,
        payment_id: payment.id,
      },
      latest_payment_attempt_id: null,
      paid_at: payment.verified_at || new Date().toISOString(),
      booking_id: payment.booking_id || null,
      order_type: orderType,
      cashfree_order_id: payment.provider_order_id || null,
      cf_payment_id: payment.provider_payment_id || null,
    })
    .select("*")
    .single();

  if (createOrderError && isMissingTableError(createOrderError, "orders")) {
    return null;
  }
  if (createOrderError) throw createOrderError;
  return createdOrder;
};

const findOrCreatePaymentAttempt = async (supabase: any, payment: any) => {
  const { data: existing, error: existingError } = await supabase
    .from("payment_attempts")
    .select("*")
    .eq("payment_id", payment.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const order = await findOrCreateOrder(supabase, payment);
  const attemptPayload: Record<string, unknown> = {
    payment_id: payment.id,
    booking_id: payment.booking_id,
    gateway_order_id: payment.provider_order_id || null,
    gateway_payment_id: payment.provider_payment_id || null,
    gateway_payment_session_id: payment.provider_session_id || null,
    amount: Number(payment.amount || 0),
    method: payment.payment_method || "card",
    status: "success",
    webhook_verified: true,
    trace_id: crypto.randomUUID().replaceAll("-", ""),
    gateway_payload: {
      source: "cashfree-refund",
      payment_id: payment.id,
      provider_order_id: payment.provider_order_id || null,
      provider_payment_id: payment.provider_payment_id || null,
    },
    provider: payment.provider || "cashfree",
    provider_order_id: payment.provider_order_id || null,
    provider_payment_id: payment.provider_payment_id || null,
    provider_session_id: payment.provider_session_id || null,
    idempotency_key: `refund_attempt_${payment.id}`,
    failure_reason: null,
    raw_payload: {
      source: "cashfree-refund",
      payment_id: payment.id,
    },
  };

  if (order?.id) {
    attemptPayload.order_id = order.id;
  }

  const created = await insertPaymentAttemptRow(supabase, attemptPayload);

  if (order?.id) {
    await supabase
      .from("orders")
      .update({ latest_payment_attempt_id: created.id })
      .eq("id", order.id);
  }

  return created;
};

const mapRefundStatus = (status: string) => {
  const normalized = upper(status);
  if (["SUCCESS", "PROCESSED"].includes(normalized)) return "SUCCESS";
  if (["FAILED", "CANCELLED", "REJECTED"].includes(normalized)) return "FAILED";
  if (normalized === "ONHOLD") return "ONHOLD";
  if (["PROCESSING", "PENDING"].includes(normalized)) return "PROCESSING";
  return "PROCESSING";
};

const mapLegacyRefundStatus = (status: string) => {
  const normalized = upper(status);
  if (normalized === "SUCCESS" || normalized === "PROCESSED") return "SUCCESS";
  if (["FAILED", "CANCELLED", "REJECTED"].includes(normalized)) return "FAILED";
  if (normalized === "ONHOLD") return "PROCESSING";
  if (normalized === "PROCESSING") return "PROCESSING";
  return "PENDING";
};

const isTerminalRefundStatus = (status: string) =>
  ["SUCCESS", "PROCESSED", "FAILED", "CANCELLED", "REJECTED"].includes(
    upper(status),
  );

const isLegacyRefundRow = (refund: any) =>
  Boolean(refund?.id) && hasOwn(refund, "status") && !hasOwn(refund, "refund_status");

const buildGatewayRefundId = (paymentId: string) =>
  `RF${String(paymentId || "").replaceAll("-", "").slice(0, 30)}`;

const normalizeGatewayRefundId = (value: unknown, paymentId: string) => {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  if (cleaned.length >= 3) return cleaned;
  return buildGatewayRefundId(paymentId);
};

const looksLikeMerchantRefundId = (value: unknown) =>
  /^RF[A-Z0-9]{3,}$/i.test(String(value || "").trim());

const resolveGatewayRefundReference = (refund: any, paymentId: string) => {
  if (refund?.refund_id) {
    return normalizeGatewayRefundId(refund.refund_id, paymentId);
  }

  if (looksLikeMerchantRefundId(refund?.provider_refund_id)) {
    return normalizeGatewayRefundId(refund.provider_refund_id, paymentId);
  }

  return buildGatewayRefundId(paymentId);
};

const isMissingColumnError = (error: unknown, column: string) => {
  const message = String((error as { message?: string } | null)?.message || "")
    .toLowerCase();
  return message.includes(column.toLowerCase()) &&
    (message.includes("column") || message.includes("schema cache"));
};

const isMissingTableError = (error: unknown, table: string) => {
  const message = String((error as { message?: string } | null)?.message || "")
    .toLowerCase();
  const normalizedTable = table.toLowerCase();
  return (
    message.includes(`table 'public.${normalizedTable}'`) ||
    message.includes(`relation "public.${normalizedTable}"`) ||
    message.includes(`relation "${normalizedTable}"`)
  ) && (message.includes("does not exist") || message.includes("schema cache"));
};

const hasExplicitMoneyValue = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  String(value).trim() !== "" &&
  Number.isFinite(Number(value));

const resolveRefundableAmount = (payment: any, booking: any) => {
  const candidates = [
    payment?.amount,
    payment?.payment_amount,
    booking?.amount_paid,
    booking?.advance_paid,
    booking?.amount_due,
  ];

  for (const candidate of candidates) {
    const amount = Math.round(Number(candidate || 0) * 100) / 100;
    if (Number.isFinite(amount) && amount > 0) {
      return amount;
    }
  }

  return 0;
};

const stripUnsupportedRefundColumns = (
  payload: Record<string, unknown>,
  error: unknown,
) => {
  const fallbackColumns = [
    "payment_attempt_id",
    "amount",
    "refund_status",
    "refund_reason",
    "commission_amount",
    "requested_by",
    "initiated_by",
    "approved_by",
    "approved_at",
    "failure_reason",
    "provider_refund_id",
    "gateway_refund_id",
    "idempotency_key",
    "metadata",
    "processed_at",
    "provider",
    "refund_id",
    "webhook_verified",
    "trace_id",
  ] as const;

  const missingColumn = fallbackColumns.find((column) =>
    isMissingColumnError(error, column)
  );

  if (!missingColumn) return null;

  const { [missingColumn]: _ignored, ...rest } = payload;
  return rest;
};

const stripUnsupportedPaymentAttemptColumns = (
  payload: Record<string, unknown>,
  error: unknown,
) => {
  const fallbackColumns = [
    "order_id",
    "gateway_order_id",
    "gateway_payment_id",
    "gateway_payment_session_id",
    "amount",
    "method",
    "webhook_verified",
    "trace_id",
    "gateway_payload",
    "provider",
    "provider_order_id",
    "provider_payment_id",
    "provider_session_id",
    "raw_payload",
    "failure_reason",
    "idempotency_key",
  ] as const;

  const missingColumn = fallbackColumns.find((column) =>
    isMissingColumnError(error, column)
  );

  if (!missingColumn) return null;

  const { [missingColumn]: _ignored, ...rest } = payload;
  return rest;
};

const insertRefundRow = async (supabase: any, payload: Record<string, unknown>) => {
  let currentPayload = { ...payload };

  while (true) {
    const { data, error } = await supabase
      .from("refunds")
      .insert(currentPayload)
      .select("*")
      .single();

    if (!error) return data;

    const fallbackPayload = stripUnsupportedRefundColumns(currentPayload, error);
    if (!fallbackPayload) throw error;
    currentPayload = fallbackPayload;
  }
};

const insertPaymentAttemptRow = async (
  supabase: any,
  payload: Record<string, unknown>,
) => {
  let currentPayload = { ...payload };

  while (Object.keys(currentPayload).length > 0) {
    const { data, error } = await supabase
      .from("payment_attempts")
      .insert(currentPayload)
      .select("*")
      .single();

    if (!error) return data;

    const fallbackPayload = stripUnsupportedPaymentAttemptColumns(currentPayload, error);
    if (!fallbackPayload) throw error;
    currentPayload = fallbackPayload;
  }

  throw new Error("Unable to create payment attempt");
};

const updateRefundRow = async (
  supabase: any,
  refundRowId: string,
  update: Record<string, unknown>,
) => {
  let currentUpdate = { ...update };

  while (true) {
    const result = await supabase
      .from("refunds")
      .update(currentUpdate)
      .eq("id", refundRowId)
      .select("*")
      .single();

    if (!result.error) return result.data;

    const fallbackUpdate = stripUnsupportedRefundColumns(currentUpdate, result.error);
    if (!fallbackUpdate) throw result.error;
    currentUpdate = fallbackUpdate;
  }
};

const computeRefundPlan = (
  paymentAmount: number,
  overrideRefundAmount?: number | null,
  overrideCommissionAmount?: number | null,
) => {
  const totalPaid = Math.round(Number(paymentAmount || 0) * 100) / 100;
  if (!Number.isFinite(totalPaid) || totalPaid <= 0) {
    throw new Error("Invalid payment amount for refund");
  }

  const hasRefundAmount = hasExplicitMoneyValue(overrideRefundAmount);
  const hasCommissionAmount = hasExplicitMoneyValue(overrideCommissionAmount);

  let commissionAmount = hasCommissionAmount
    ? Math.round(Number(overrideCommissionAmount || 0) * 100) / 100
    : 0;
  let refundAmount = hasRefundAmount
    ? Math.round(Number(overrideRefundAmount || 0) * 100) / 100
    : Math.round((totalPaid - commissionAmount) * 100) / 100;

  if (hasRefundAmount && !hasCommissionAmount) {
    commissionAmount = Math.round((totalPaid - refundAmount) * 100) / 100;
  }

  if (hasRefundAmount && hasCommissionAmount) {
    const combined = Math.round((refundAmount + commissionAmount) * 100) / 100;
    if (combined - totalPaid > 0.009) {
      throw new Error("Refund amount and commission exceed paid amount");
    }
  }

  if (!hasRefundAmount && hasCommissionAmount) {
    refundAmount = Math.round((totalPaid - commissionAmount) * 100) / 100;
  }

  if (!hasRefundAmount && !hasCommissionAmount) {
    refundAmount = totalPaid;
    commissionAmount = 0;
  }

  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    throw new Error("Refund amount is zero or negative");
  }

  if (!Number.isFinite(commissionAmount) || commissionAmount < 0) {
    throw new Error("Commission deduction must be zero or greater");
  }

  if (refundAmount - totalPaid > 0.009) {
    throw new Error("Refund amount cannot exceed paid amount");
  }

  return {
    totalPaid,
    refundAmount: Math.round(refundAmount * 100) / 100,
    commissionAmount: Math.round(commissionAmount * 100) / 100,
  };
};

const upsertRefundRecord = async (
  supabase: any,
  input: {
    existingRefund: any | null;
    paymentAttemptId: string;
    payment: any;
    booking: any;
    reason: string;
    refundReason: string | null;
    initiatedBy: string;
    requestedBy: string | null;
    refundAmount: number;
    commissionAmount: number;
    refundStatus: string;
    legacyStatus: string;
    approvedBy?: string | null;
    failureReason?: string | null;
    providerRefundId?: string | null;
    processedAt?: string | null;
    metadata?: Record<string, unknown>;
  },
) => {
  const refundReference = resolveGatewayRefundReference(
    input.existingRefund,
    String(input.payment.id),
  );
  const providerRefundId =
    input.providerRefundId || input.existingRefund?.provider_refund_id || null;

  if (isLegacyRefundRow(input.existingRefund)) {
    const legacyProviderRefundId = looksLikeMerchantRefundId(providerRefundId)
      ? providerRefundId
      : refundReference;
    const legacyPayload: Record<string, unknown> = {
      payment_id: input.payment.id,
      booking_id: input.payment.booking_id,
      customer_id: input.payment.customer_id || input.booking?.customer_id || null,
      refund_amount: input.refundAmount,
      reason: input.reason,
      status: mapLegacyRefundStatus(input.legacyStatus || input.refundStatus),
      provider: "cashfree",
      provider_refund_id: legacyProviderRefundId,
      processed_at: input.processedAt || null,
    };

    return updateRefundRow(supabase, input.existingRefund.id, legacyPayload);
  }

  const payload: Record<string, unknown> = {
    payment_attempt_id: input.paymentAttemptId,
    gateway_refund_id:
      providerRefundId || input.existingRefund?.gateway_refund_id || null,
    idempotency_key: ensureUuid(input.existingRefund?.idempotency_key),
    amount: input.refundAmount,
    payment_id: input.payment.id,
    booking_id: input.payment.booking_id,
    customer_id: input.payment.customer_id || input.booking?.customer_id || null,
    refund_amount: input.refundAmount,
    commission_amount: input.commissionAmount,
    reason: input.reason,
    refund_reason: input.refundReason,
    status: mapLegacyRefundStatus(input.legacyStatus || input.refundStatus),
    refund_status: input.refundStatus,
    refund_id: refundReference,
    initiated_by: input.initiatedBy,
    requested_by: input.requestedBy,
    approved_by: input.approvedBy || null,
    approved_at: input.approvedBy ? new Date().toISOString() : null,
    provider: "cashfree",
    webhook_verified: false,
    provider_refund_id: providerRefundId,
    trace_id: input.existingRefund?.trace_id ||
      crypto.randomUUID().replaceAll("-", ""),
    metadata: {
      ...(input.existingRefund?.metadata || {}),
      ...(input.metadata || {}),
    },
    processed_at: input.processedAt || null,
    failure_reason: input.failureReason || null,
  };

  if (input.existingRefund?.id) {
    return updateRefundRow(supabase, input.existingRefund.id, payload);
  }

  return insertRefundRow(supabase, payload);
};

const insertNotification = async (
  supabase: any,
  input: {
    userId: string;
    title: string;
    message: string;
    type: string;
    data: Record<string, unknown>;
  },
) => {
  await supabase.from("notifications").insert({
    user_id: input.userId,
    title: input.title,
    message: input.message,
    notification_type: input.type,
    status: "queued",
    data: input.data,
  });
};

const requestRefund = async (
  cashfree: ReturnType<typeof getCashfreeConfig>,
  input: {
    orderId: string;
    refundId: string;
    refundAmount: number;
    reason: string;
    idempotencyKey: string;
  },
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let res: Response;

  try {
    res = await fetch(`${cashfree.baseUrl}/orders/${input.orderId}/refunds`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-client-id": cashfree.clientId,
        "x-client-secret": cashfree.clientSecret,
        "x-api-version": cashfree.apiVersion,
        "x-idempotency-key": input.idempotencyKey,
        "x-request-id": input.idempotencyKey,
      },
      body: JSON.stringify({
        refund_id: input.refundId,
        refund_amount: input.refundAmount,
        refund_note: input.reason,
        refund_speed: "STANDARD",
      }),
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error("Cashfree refund request timed out. Please sync status before retrying.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || "Refund request failed");
  }
  return data;
};

const markPaymentAndBookingRefunded = async (
  supabase: any,
  input: { payment: any; booking: any },
) => {
  const paymentUpdate: Record<string, unknown> = {
    status: "refunded",
    payment_status: "refunded",
  };

  const bookingUpdate: Record<string, unknown> = {
    payment_status: "refunded",
  };

  const paymentType = lower(input.payment?.payment_type || "");
  if (paymentType === "monthly" || paymentType === "rent") {
    bookingUpdate.rent_payment_status = "refunded";
  } else if (paymentType) {
    bookingUpdate.advance_payment_status = "refunded";
  }

  const paymentAttempts = [
    paymentUpdate,
    { payment_status: "refunded" },
    { status: "refunded" },
  ];

  let lastPaymentError: unknown = null;
  for (const update of paymentAttempts) {
    const { error } = await supabase
      .from("payments")
      .update(update)
      .eq("id", input.payment.id);
    if (!error) {
      lastPaymentError = null;
      break;
    }
    lastPaymentError = error;
  }
  if (lastPaymentError) throw lastPaymentError;

  const bookingAttempts = [
    bookingUpdate,
    { payment_status: "refunded" },
  ];

  for (const update of bookingAttempts) {
    const { error } = await supabase
      .from("bookings")
      .update(update)
      .eq("id", input.booking.id);
    if (!error) return;
  }
};

const reconcileRefundFromGateway = async (
  supabase: any,
  input: {
    existingRefund: any;
    paymentAttemptId: string;
    payment: any;
    booking: any;
    reason: string;
    refundReason: string | null;
    initiatedBy: string;
    requestedBy: string | null;
    approvedBy: string | null;
    commissionAmount: number;
    gatewayResponse?: Record<string, unknown> | null;
  },
) => {
  if (!input.payment?.provider_order_id) {
    throw new Error("Missing provider order id for refund verification");
  }

  const refundReference = resolveGatewayRefundReference(
    input.existingRefund,
    String(input.payment.id),
  );
  if (!refundReference) {
    throw new Error("Missing refund id for refund verification");
  }

  let gatewayResponse = input.gatewayResponse || null;
  if (!gatewayResponse) {
    try {
      gatewayResponse = await fetchCashfreeRefund(
        input.payment.provider_order_id,
        refundReference,
      );
    } catch (error) {
      if (isMissingGatewayRefundError(error)) {
        return {
          gatewayResponse: null,
          updatedRefund: input.existingRefund,
          nextStatus: upper(
            input.existingRefund?.refund_status ||
              input.existingRefund?.status ||
              "PROCESSING",
          ),
        };
      }
      throw error;
    }
  }

  const rawGatewayStatus = String(
    gatewayResponse?.refund_status ||
      gatewayResponse?.status ||
      input.existingRefund?.refund_status ||
      input.existingRefund?.status ||
      "PROCESSING",
  ).trim();
  const nextStatus = mapRefundStatus(rawGatewayStatus);
  const legacyStatus = mapLegacyRefundStatus(nextStatus);
  const providerRefundId = String(
    gatewayResponse?.cf_refund_id ||
      gatewayResponse?.provider_refund_id ||
      input.existingRefund?.provider_refund_id ||
      "",
  ).trim() || null;
  const resolvedRefundReason = String(
    gatewayResponse?.refund_reason ||
      gatewayResponse?.status_description ||
      input.refundReason ||
      "",
  ).trim() || input.refundReason;
  const processedAt = nextStatus === "SUCCESS"
    ? String(gatewayResponse?.processed_at || new Date().toISOString())
    : null;
  const failureReason = nextStatus === "FAILED"
    ? String(
      gatewayResponse?.status_description ||
        gatewayResponse?.refund_reason ||
        input.reason ||
        "Refund failed",
    ).trim()
    : null;

  const updatedRefund = await upsertRefundRecord(supabase, {
    existingRefund: input.existingRefund,
    paymentAttemptId: input.paymentAttemptId,
    payment: input.payment,
    booking: input.booking,
    reason: input.reason,
    refundReason: resolvedRefundReason,
    initiatedBy: input.initiatedBy,
    requestedBy: input.requestedBy,
    refundAmount: Number(
      gatewayResponse?.refund_amount ||
        input.existingRefund?.refund_amount ||
        input.existingRefund?.amount ||
        0,
    ),
    commissionAmount: input.commissionAmount,
    refundStatus: nextStatus,
    legacyStatus,
    approvedBy: input.approvedBy,
    failureReason,
    providerRefundId,
    processedAt,
    metadata: {
      ...(input.existingRefund?.metadata || {}),
      source: "refund_gateway_verify",
      gateway_status: rawGatewayStatus,
      gateway_checked_at: new Date().toISOString(),
    },
  });

  if (nextStatus === "SUCCESS") {
    await markPaymentAndBookingRefunded(supabase, {
      payment: input.payment,
      booking: input.booking,
    });

    if (input.payment.customer_id) {
      const notificationCopy = buildRefundCustomerCopy({
        status: "completed",
        roomNumber: input.booking.room_number,
        amount: updatedRefund.refund_amount || updatedRefund.amount,
        currency: input.booking.currency,
      });
      await insertNotification(supabase, {
        userId: input.payment.customer_id,
        title: notificationCopy.title,
        message: notificationCopy.message,
        type: "refund_completed",
        data: { booking_id: input.booking.id, refund_id: updatedRefund.id },
      });
    }
  } else if (nextStatus === "FAILED" && input.payment.customer_id) {
    const notificationCopy = buildRefundCustomerCopy({
      status: "failed",
      roomNumber: input.booking.room_number,
      amount: updatedRefund.refund_amount || updatedRefund.amount,
      currency: input.booking.currency,
      failureReason,
    });
    await insertNotification(supabase, {
      userId: input.payment.customer_id,
      title: notificationCopy.title,
      message: notificationCopy.message,
      type: "refund_failed",
      data: { booking_id: input.booking.id, refund_id: updatedRefund.id },
    });
  }

  return {
    gatewayResponse,
    updatedRefund,
    nextStatus,
  };
};

const verifyRefundUntilTerminal = async (
  supabase: any,
  input: {
    refundRecord: any;
    paymentAttemptId: string;
    payment: any;
    booking: any;
    reason: string;
    refundReason: string | null;
    initiatedBy: string;
    requestedBy: string | null;
    approvedBy: string | null;
    commissionAmount: number;
    immediateGatewayResponse?: Record<string, unknown> | null;
    maxAttempts?: number;
    delayMs?: number;
  },
) => {
  let currentRefund = input.refundRecord;
  let latestGateway = input.immediateGatewayResponse || null;
  const maxAttempts = input.maxAttempts ?? 18;
  const delayMs = input.delayMs ?? 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await wait(delayMs);
      latestGateway = null;
    }

    const reconciliation = await reconcileRefundFromGateway(supabase, {
      existingRefund: currentRefund,
      paymentAttemptId: input.paymentAttemptId,
      payment: input.payment,
      booking: input.booking,
      reason: input.reason,
      refundReason: input.refundReason,
      initiatedBy: input.initiatedBy,
      requestedBy: input.requestedBy,
      approvedBy: input.approvedBy,
      commissionAmount: input.commissionAmount,
      gatewayResponse: latestGateway,
    });

    currentRefund = reconciliation.updatedRefund;
    if (isTerminalRefundStatus(reconciliation.nextStatus)) {
      return reconciliation;
    }
  }

  return {
    gatewayResponse: latestGateway,
    updatedRefund: currentRefund,
    nextStatus: upper(currentRefund?.refund_status || currentRefund?.status || "PROCESSING"),
  };
};

const ensurePrepareAccess = (role: "owner" | "admin", userId: string, booking: any) => {
  if (role === "admin") return;
  if (booking?.owner_id !== userId) {
    throw new Error("Owner access required for this booking");
  }
};

const getUserRole = async (supabase: any, userId: string): Promise<string> => {
  const { data, error } = await supabase
    .from("accounts")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return String(data?.role || "").trim().toLowerCase();
};

const ensureRefundSyncAccess = (
  role: string,
  userId: string,
  booking: { customer_id?: string | null; owner_id?: string | null } | null,
) => {
  if (role === "admin") return;
  if (!booking) throw new Error("Booking not found");

  const ownerId = String(booking.owner_id || "").trim();
  const customerId = String(booking.customer_id || "").trim();
  if (userId === ownerId || userId === customerId) return;

  throw new Error("You do not have access to this refund");
};

const prepareRefund = async (
  req: Request,
  input: RefundPayload,
) => {
  const internalServiceRequest = await isInternalServiceRequest(req);
  const { supabase, user, role } = internalServiceRequest
    ? {
      supabase: createServiceClient(),
      user: null,
      role: lower(input.initiatedBy) === "admin" ? "admin" : "owner",
    }
    : await requireOwnerOrAdminUser(req);
  const booking = input.bookingId ? await fetchBooking(supabase, input.bookingId) : null;

  if (!booking && !input.paymentId) {
    throw new Error("bookingId or paymentId is required");
  }

  if (booking && !internalServiceRequest && user) {
    ensurePrepareAccess(role, user.id, booking);
  }

  const payment = await resolveRefundablePayment(supabase, {
    bookingId: booking?.id || input.bookingId,
    paymentId: input.paymentId,
  });

  if (!payment) {
    return json(req, {
      success: true,
      skipped: true,
      message: "No completed payment is available for refund review.",
    });
  }

  const effectiveBooking = booking || await fetchBooking(supabase, payment.booking_id);
  if (!internalServiceRequest && user) {
    ensurePrepareAccess(role, user.id, effectiveBooking);
  }

  const existingRefund = await findExistingRefund(supabase, {
    refundRowId: input.refundRowId,
    paymentId: payment.id,
  });
  const existingStatus = upper(
    existingRefund?.refund_status || existingRefund?.status || "",
  );

  if (["SUCCESS", "PROCESSED"].includes(existingStatus)) {
    return json(req, {
      success: true,
      refund: existingRefund,
      message: "Refund already completed for this payment.",
    });
  }

  if (["PENDING", "PROCESSING", "ONHOLD"].includes(existingStatus)) {
    return json(req, {
      success: true,
      refund: existingRefund,
      message: "Refund request is already waiting for admin action.",
    });
  }

  const paymentAttempt = isLegacyRefundRow(existingRefund)
    ? { id: existingRefund?.payment_id || payment.id }
    : await findOrCreatePaymentAttempt(supabase, payment);
  const refundableAmount = resolveRefundableAmount(payment, effectiveBooking);
  const plan = computeRefundPlan(
    refundableAmount,
    existingRefund?.refund_amount ?? input.refundAmount,
    existingRefund?.commission_amount ?? input.commissionAmount,
  );

  const refundRecord = await upsertRefundRecord(supabase, {
    existingRefund,
    paymentAttemptId: paymentAttempt.id,
    payment,
    booking: effectiveBooking,
    reason: input.reason,
    refundReason: input.refundReason,
    initiatedBy: input.initiatedBy || role,
    requestedBy: internalServiceRequest
      ? (input.requestedByUserId || effectiveBooking?.owner_id || payment.customer_id || null)
      : user?.id || input.requestedByUserId || null,
    refundAmount: plan.refundAmount,
    commissionAmount: plan.commissionAmount,
    refundStatus: "PENDING",
    legacyStatus: "PENDING",
    approvedBy: null,
    failureReason: null,
    processedAt: null,
    metadata: {
      initiated_by_role: role,
      source: "refund_prepare",
      total_paid: plan.totalPaid,
    },
  });

  if (payment.customer_id) {
    const notificationCopy = buildRefundCustomerCopy({
      status: "review_started",
      roomNumber: effectiveBooking.room_number,
      amount: plan.refundAmount,
      currency: effectiveBooking.currency,
    });
    await insertNotification(supabase, {
      userId: payment.customer_id,
      title: notificationCopy.title,
      message: notificationCopy.message,
      type: "refund_review_started",
      data: { booking_id: payment.booking_id, refund_id: refundRecord.id },
    });
  }

  return json(req, {
    success: true,
    refund: refundRecord,
    message: "Refund request prepared for admin review.",
  });
};

const processRefund = async (
  req: Request,
  input: RefundPayload,
) => {
  const { supabase, user } = await requireAdminUser(req);
  const existingRefund = await findExistingRefund(supabase, {
    refundRowId: input.refundRowId,
    paymentId: input.paymentId,
  });

  const payment = input.paymentId
    ? await fetchPaymentById(supabase, input.paymentId)
    : existingRefund?.payment_id
    ? await fetchPaymentById(supabase, existingRefund.payment_id)
    : await resolveRefundablePayment(supabase, { bookingId: input.bookingId });

  if (!payment) {
    throw new Error("No completed payment found for refund");
  }

  if (!isCompletedPayment(payment)) {
    throw new Error("Payment not eligible for refund");
  }

  const booking = await fetchBooking(supabase, payment.booking_id);
  const currentStatus = upper(
    existingRefund?.refund_status || existingRefund?.status || "",
  );

  if (["SUCCESS", "PROCESSED"].includes(currentStatus)) {
    if (existingRefund && payment && booking) {
      await markPaymentAndBookingRefunded(supabase, { payment, booking }).catch(() => undefined);
    }
    return json(req, {
      success: true,
      refund: existingRefund,
      message: "Refund already completed.",
    });
  }

  if (["PROCESSING", "ONHOLD"].includes(currentStatus)) {
    const verification = await verifyRefundUntilTerminal(supabase, {
      refundRecord: existingRefund,
      paymentAttemptId: existingRefund.payment_attempt_id,
      payment,
      booking,
      reason: input.reason,
      refundReason: input.refundReason,
      initiatedBy: input.initiatedBy || "admin",
      requestedBy: existingRefund?.requested_by || user.id,
      approvedBy: user.id,
      commissionAmount: Number(existingRefund?.commission_amount || 0),
      maxAttempts: 1,
      delayMs: 0,
    }).catch(() => null);

    return json(req, {
      success: true,
      refund: verification?.updatedRefund || existingRefund,
      message: verification && isTerminalRefundStatus(String(verification.nextStatus || ""))
        ? "Refund status refreshed."
        : "Refund is already processing.",
    });
  }

  const paymentAttempt = isLegacyRefundRow(existingRefund)
    ? { id: existingRefund?.payment_id || payment.id }
    : await findOrCreatePaymentAttempt(supabase, payment);
  const refundableAmount = resolveRefundableAmount(payment, booking);
  const plan = computeRefundPlan(
    refundableAmount,
    input.refundAmount ?? existingRefund?.refund_amount,
    input.commissionAmount ?? existingRefund?.commission_amount,
  );
  const intendedGatewayRefundId = resolveGatewayRefundReference(
    existingRefund,
    String(payment.id),
  );

  const preparedRefund = await upsertRefundRecord(supabase, {
    existingRefund,
    paymentAttemptId: paymentAttempt.id,
    payment,
    booking,
    reason: input.reason,
    refundReason: input.refundReason,
    initiatedBy: input.initiatedBy || "admin",
    requestedBy: existingRefund?.requested_by || user.id,
    refundAmount: plan.refundAmount,
    commissionAmount: plan.commissionAmount,
    refundStatus: "PROCESSING",
    legacyStatus: "PROCESSING",
    approvedBy: user.id,
    failureReason: null,
    providerRefundId: intendedGatewayRefundId,
    processedAt: null,
    metadata: {
      ...(existingRefund?.metadata || {}),
      source: "refund_process",
      total_paid: plan.totalPaid,
    },
  });

  if (!payment.provider_order_id) {
    throw new Error("Missing provider order id for refund");
  }

  try {
    const gatewayRefundId = normalizeGatewayRefundId(
      preparedRefund.refund_id || preparedRefund.provider_refund_id || intendedGatewayRefundId,
      String(payment.id),
    );
    const gatewayResponse = await requestRefund(getCashfreeConfig(), {
      orderId: payment.provider_order_id,
      refundId: gatewayRefundId,
      refundAmount: plan.refundAmount,
      reason: input.reason,
      idempotencyKey: ensureUuid(preparedRefund.idempotency_key || preparedRefund.id),
    });

    const initialGatewayStatus = String(
      gatewayResponse?.refund_status || gatewayResponse?.status || "PROCESSING",
    ).trim();
    const mappedGatewayStatus = mapRefundStatus(initialGatewayStatus);
    const mappedLegacyStatus = mapLegacyRefundStatus(mappedGatewayStatus);
    const providerRefundId = isLegacyRefundRow(preparedRefund)
      ? gatewayRefundId
      : gatewayResponse?.cf_refund_id ||
        gatewayResponse?.provider_refund_id ||
        null;

    const updatedRefund = await upsertRefundRecord(supabase, {
      existingRefund: preparedRefund,
      paymentAttemptId: paymentAttempt.id,
      payment,
      booking,
      reason: input.reason,
      refundReason: input.refundReason,
      initiatedBy: input.initiatedBy || "admin",
      requestedBy: preparedRefund.requested_by || user.id,
      refundAmount: plan.refundAmount,
      commissionAmount: plan.commissionAmount,
      refundStatus: mappedGatewayStatus,
      legacyStatus: mappedLegacyStatus,
      approvedBy: user.id,
      failureReason: null,
      providerRefundId,
      processedAt: null,
      metadata: {
        ...(preparedRefund.metadata || {}),
        source: "refund_process",
        gateway_status: initialGatewayStatus,
      },
    });

    if (isTerminalRefundStatus(initialGatewayStatus)) {
      const reconciliation = await reconcileRefundFromGateway(supabase, {
        existingRefund: updatedRefund,
        paymentAttemptId: paymentAttempt.id,
        payment,
        booking,
        reason: input.reason,
        refundReason: input.refundReason,
        initiatedBy: input.initiatedBy || "admin",
        requestedBy: updatedRefund.requested_by || user.id,
        approvedBy: user.id,
        commissionAmount: plan.commissionAmount,
        gatewayResponse,
      });

      return json(req, {
        success: reconciliation.nextStatus !== "FAILED",
        refund: reconciliation.updatedRefund,
        gateway: reconciliation.gatewayResponse,
        message: reconciliation.nextStatus === "SUCCESS"
          ? "Refund completed."
          : "Refund failed during gateway processing.",
      }, reconciliation.nextStatus === "FAILED" ? 400 : 200);
    }

    const nonTerminalStatus = upper(
      updatedRefund.refund_status ||
      updatedRefund.status ||
      mappedGatewayStatus,
    );

    if (payment.customer_id) {
      const notificationCopy = buildRefundCustomerCopy({
        status: nonTerminalStatus === "ONHOLD" ? "on_hold" : "processing",
        roomNumber: booking.room_number,
        amount: plan.refundAmount,
        currency: booking.currency,
      });
      await insertNotification(supabase, {
        userId: payment.customer_id,
        title: notificationCopy.title,
        message: notificationCopy.message,
        type: "refund_processing",
        data: { booking_id: payment.booking_id, refund_id: updatedRefund.id },
      });
    }

    return json(req, {
      success: true,
      refund: updatedRefund,
      gateway: gatewayResponse,
      message: nonTerminalStatus === "ONHOLD"
        ? "Refund is on hold at the payment gateway. Final status will update automatically."
        : "Refund initiated. Final status will update after gateway verification.",
    });
  } catch (error: any) {
    const failedRefund = await upsertRefundRecord(supabase, {
      existingRefund: preparedRefund,
      paymentAttemptId: paymentAttempt.id,
      payment,
      booking,
      reason: input.reason,
      refundReason: input.refundReason,
      initiatedBy: input.initiatedBy || "admin",
      requestedBy: preparedRefund.requested_by || user.id,
      refundAmount: plan.refundAmount,
      commissionAmount: plan.commissionAmount,
      refundStatus: "FAILED",
      legacyStatus: "FAILED",
      approvedBy: user.id,
      failureReason: error?.message || "Refund request failed",
      processedAt: null,
      metadata: {
        ...(preparedRefund.metadata || {}),
        source: "refund_process_error",
      },
    });

    return json(req, {
      success: false,
      refund: failedRefund,
      error: error?.message || "Refund request failed",
    }, 400);
  }
};

const rejectRefund = async (
  req: Request,
  input: RefundPayload,
) => {
  const { supabase, user } = await requireAdminUser(req);
  const existingRefund = await findExistingRefund(supabase, {
    refundRowId: input.refundRowId,
    paymentId: input.paymentId,
  });

  if (!existingRefund) {
    throw new Error("Refund request not found");
  }

  const currentStatus = upper(
    existingRefund.refund_status || existingRefund.status || "",
  );
  if (["SUCCESS", "PROCESSED"].includes(currentStatus)) {
    throw new Error("Completed refunds cannot be rejected");
  }
  if (["PROCESSING", "ONHOLD"].includes(currentStatus)) {
    throw new Error("Refund is already processing and can no longer be rejected");
  }

  const payment = existingRefund.payment_id
    ? await fetchPaymentById(supabase, existingRefund.payment_id)
    : null;
  const booking = existingRefund.booking_id
    ? await fetchBooking(supabase, existingRefund.booking_id)
    : null;

  const updatedRefund = await updateRefundRow(supabase, existingRefund.id, {
    status: "FAILED",
    refund_status: "FAILED",
    failure_reason: input.reason || "Refund rejected by admin",
    approved_by: user.id,
    approved_at: new Date().toISOString(),
    processed_at: null,
    metadata: {
      ...(existingRefund.metadata || {}),
      source: "refund_reject",
    },
  });

  if (payment?.customer_id) {
    const notificationCopy = buildRefundCustomerCopy({
      status: "rejected",
      roomNumber: booking?.room_number,
      amount: existingRefund.refund_amount || existingRefund.amount,
      currency: booking?.currency,
    });
    await insertNotification(supabase, {
      userId: payment.customer_id,
      title: notificationCopy.title,
      message: notificationCopy.message,
      type: "refund_rejected",
      data: {
        booking_id: booking?.id || existingRefund.booking_id,
        refund_id: updatedRefund.id,
      },
    });
  }

  return json(req, {
    success: true,
    refund: updatedRefund,
    message: "Refund request rejected.",
  });
};

const syncRefund = async (
  req: Request,
  input: RefundPayload,
) => {
  const internalServiceRequest = await isInternalServiceRequest(req);
  const { supabase, user, role } = internalServiceRequest
    ? { supabase: createServiceClient(), user: null, role: "admin" }
    : await (async () => {
      const auth = await requireAuthenticatedUser(req);
      const resolvedRole = await getUserRole(auth.supabase, auth.user.id);
      return { supabase: auth.supabase, user: auth.user, role: resolvedRole };
    })();

  const existingRefund = await findExistingRefund(supabase, {
    refundRowId: input.refundRowId,
    paymentId: input.paymentId,
  });

  if (!existingRefund) {
    throw new Error("Refund request not found");
  }

  const payment = existingRefund.payment_id
    ? await fetchPaymentById(supabase, existingRefund.payment_id)
    : await resolveRefundablePayment(supabase, {
      bookingId: input.bookingId,
      paymentId: input.paymentId,
    });

  if (!payment) {
    throw new Error("No payment found for refund verification");
  }

  const booking = await fetchBooking(supabase, payment.booking_id);
  if (!internalServiceRequest && user) {
    ensureRefundSyncAccess(role, user.id, booking);
  }

  const currentStatus = upper(
    existingRefund.refund_status || existingRefund.status || "",
  );

  if (["SUCCESS", "PROCESSED"].includes(currentStatus)) {
    await markPaymentAndBookingRefunded(supabase, { payment, booking }).catch(() => undefined);
    return json(req, {
      success: true,
      refund: existingRefund,
      message: "Refund already completed.",
    });
  }

  if (currentStatus === "PENDING") {
    return json(req, {
      success: true,
      refund: existingRefund,
      message: "Refund is awaiting admin review.",
    });
  }

  const hasGatewayReference = Boolean(
    String(existingRefund.refund_id || existingRefund.provider_refund_id || "").trim(),
  );

  if (
    ["PROCESSING", "ONHOLD"].includes(currentStatus) &&
    !hasGatewayReference
  ) {
    return json(req, {
      success: true,
      refund: existingRefund,
      message: currentStatus === "ONHOLD"
        ? "Refund is on hold at the payment gateway."
        : "Refund is being prepared for gateway verification.",
    });
  }

  if (
    ["FAILED", "CANCELLED", "REJECTED"].includes(currentStatus) &&
    !hasGatewayReference
  ) {
    return json(req, {
      success: false,
      refund: existingRefund,
      message: "Refund already failed.",
    }, 400);
  }

  if (!payment.provider_order_id) {
    throw new Error("Missing provider order id for refund verification");
  }

  const paymentAttempt = existingRefund.payment_attempt_id
    ? { id: existingRefund.payment_attempt_id }
    : await findOrCreatePaymentAttempt(supabase, payment);

  const verification = await verifyRefundUntilTerminal(supabase, {
    refundRecord: existingRefund,
    paymentAttemptId: paymentAttempt.id,
    payment,
    booking,
    reason: String(existingRefund.reason || input.reason || "Refund initiated").trim(),
    refundReason: String(
      existingRefund.refund_reason || input.refundReason || "",
    ).trim() || null,
    initiatedBy: input.initiatedBy || role || "system",
    requestedBy: existingRefund.requested_by || null,
    approvedBy: existingRefund.approved_by || null,
    commissionAmount: Number(existingRefund.commission_amount || 0),
    maxAttempts: 1,
    delayMs: 0,
  });

  const nextStatus = upper(verification.nextStatus || currentStatus || "PROCESSING");

  return json(req, {
    success: nextStatus !== "FAILED",
    refund: verification.updatedRefund,
    gateway: verification.gatewayResponse || null,
    message: nextStatus === "SUCCESS"
      ? "Refund completed."
      : nextStatus === "FAILED"
        ? "Refund failed during gateway processing."
        : "Refund is still processing.",
  }, nextStatus === "FAILED" ? 400 : 200);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (!assertAllowedOrigin(req)) {
    return json(req, { success: false, error: "Origin is not allowed" }, 403);
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  try {
    const input = await parseRefundPayload(req);

    if (input.action === "prepare") {
      return await prepareRefund(req, input);
    }
    if (input.action === "reject") {
      return await rejectRefund(req, input);
    }
    if (input.action === "sync") {
      return await syncRefund(req, input);
    }
    return await processRefund(req, input);
  } catch (error: any) {
    return json(
      req,
      { success: false, error: error?.message || "Refund failed" },
      400,
    );
  }
});
