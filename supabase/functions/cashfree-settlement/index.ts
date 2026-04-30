// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  createCashfreeBeneficiary,
  createCashfreeTransfer,
  fetchCashfreeBeneficiary,
  fetchCashfreeTransfer,
} from "../_shared/cashfree.ts";
import { decryptSensitiveValue } from "../_shared/crypto.ts";
import {
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { buildPayoutNotificationCopy } from "../_shared/notification-copy.ts";

const lower = (value: unknown) => String(value || "").toLowerCase();
const upper = (value: unknown) => String(value || "").toUpperCase();
const normalize = (value: unknown) => String(value || "").trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toAmount = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

const getPayoutEnvironment = () =>
  upper(
    Deno.env.get("CASHFREE_PAYOUT_ENV") ||
      Deno.env.get("CASHFREE_ENV") ||
      "TEST",
  );

const allowSyntheticSandboxPayout = () =>
  !["PROD", "PRODUCTION"].includes(getPayoutEnvironment());

const parseBearerToken = (value: string | null) => {
  const header = normalize(value);
  if (!header) return "";

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) {
    return normalize(token);
  }

  return header;
};

const isMissingColumnError = (error: unknown, tableName: string, columnName: string) => {
  const code = String((error as { code?: string } | null)?.code || "").trim();
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return (
    (code === "42703" && message.includes(`column ${tableName.toLowerCase()}.${columnName.toLowerCase()} does not exist`)) ||
    (code === "PGRST204" && message.includes(`could not find the '${columnName.toLowerCase()}' column of '${tableName.toLowerCase()}'`))
  );
};

const getMissingColumnFromError = (error: unknown, tableName: string) => {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  const directMatch = message.match(new RegExp(`column ${tableName.toLowerCase()}\\.([a-z0-9_]+) does not exist`));
  if (directMatch?.[1]) return directMatch[1];
  const postgrestMatch = message.match(new RegExp(`could not find the '([a-z0-9_]+)' column of '${tableName.toLowerCase()}'`));
  return postgrestMatch?.[1] || "";
};

const getSupabaseClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("LOCAL_SUPABASE_URL");
  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
};

const getRequestToken = (req: Request, fallbackToken = "") =>
  normalize(fallbackToken) ||
  parseBearerToken(req.headers.get("x-supabase-auth")) ||
  parseBearerToken(req.headers.get("authorization")) ||
  parseBearerToken(req.headers.get("apikey"));

const isInternalServiceRoleRequest = async (supabase: any, req: Request, fallbackToken = "") => {
  const requestToken =
    getRequestToken(req, fallbackToken);

  if (!requestToken) {
    return false;
  }

  const expectedToken = normalize(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY"),
  );

  if (expectedToken && requestToken === expectedToken) {
    return true;
  }

  const { data, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", "supabase_service_role_key")
    .maybeSingle();

  if (error) {
    return false;
  }

  return requestToken === normalize(data?.value);
};

const getEncryptionSecret = () => {
  const secret =
    String(Deno.env.get("BANK_ACCOUNT_ENCRYPTION_SECRET") || "").trim() ||
    String(Deno.env.get("SUPABASE_JWT_SECRET") || "").trim();

  if (!secret) {
    throw new Error("Missing account encryption secret");
  }

  return secret;
};

const isDuplicateBeneficiaryError = (message: string) => {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) return false;
  if (/(does not exist|not exist|not found|invalid beneficiary)/.test(normalized)) {
    return false;
  }
  return /(already exists|already registered|duplicate|beneficiary.*exists|already added)/.test(normalized);
};

const parseSettlementPayload = async (req: Request) => {
  const payload = await req.json().catch(() => ({}));
  return {
    settlementId: String(payload?.settlementId || payload?.settlement_id || "").trim(),
    bookingId: String(payload?.bookingId || payload?.booking_id || "").trim(),
    paymentId: String(payload?.paymentId || payload?.payment_id || "").trim(),
    createOnly: payload?.createOnly === true || payload?.create_only === true,
    internalKey: String(payload?.internal_key || payload?.service_role_key || "").trim(),
  };
};

const fetchSettlementById = async (supabase: any, settlementId: string) => {
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("id", settlementId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const fetchSettlementByPaymentId = async (supabase: any, paymentId: string) => {
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error, "settlements", "payment_id")) {
      return null;
    }
    throw error;
  }
  return data;
};

const fetchBookingLevelSettlementByBookingId = async (supabase: any, bookingId: string) => {
  let { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("booking_id", bookingId)
    .is("payment_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && isMissingColumnError(error, "settlements", "payment_id")) {
    ({ data, error } = await supabase
      .from("settlements")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle());
  }

  if (error) throw error;
  return data;
};

const fetchBookingForSettlement = async (supabase: any, bookingId: string) => {
  const richSelect =
    "id, owner_id, customer_id, customer_name, room_number, status, check_in_date, payment_status, admin_approved, start_date, end_date, amount_paid, amount_due, advance_paid, monthly_rent, currency";
  const legacySelect =
    "id, owner_id, customer_id, customer_name, room_number, status, payment_status, start_date, end_date, amount_paid, amount_due, advance_paid, monthly_rent, currency";

  let { data: booking, error } = await supabase
    .from("bookings")
    .select(richSelect)
    .eq("id", bookingId)
    .maybeSingle();

  if (
    error &&
    (isMissingColumnError(error, "bookings", "check_in_date") ||
      isMissingColumnError(error, "bookings", "admin_approved"))
  ) {
    ({ data: booking, error } = await supabase
      .from("bookings")
      .select(legacySelect)
      .eq("id", bookingId)
      .maybeSingle());
  }

  if (error) throw error;
  if (!booking) throw new Error("Booking not found for settlement");
  return booking;
};

const insertSettlementWithCompatibility = async (
  supabase: any,
  payload: Record<string, unknown>,
) => {
  let nextPayload = { ...payload };

  while (Object.keys(nextPayload).length > 0) {
    const { data, error } = await supabase
      .from("settlements")
      .insert(nextPayload)
      .select("*")
      .single();

    if (!error) return data;

    const missingColumn = getMissingColumnFromError(error, "settlements");
    if (!missingColumn || !(missingColumn in nextPayload)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextPayload;
    nextPayload = rest;
  }

  throw new Error("Failed to create settlement row");
};

const updateSettlementWithCompatibility = async (
  supabase: any,
  settlementId: string,
  payload: Record<string, unknown>,
) => {
  let nextPayload = { ...payload };

  while (Object.keys(nextPayload).length > 0) {
    const { data, error } = await supabase
      .from("settlements")
      .update(nextPayload)
      .eq("id", settlementId)
      .select("*")
      .single();

    if (!error) return data;

    const missingColumn = getMissingColumnFromError(error, "settlements");
    if (!missingColumn || !(missingColumn in nextPayload)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextPayload;
    nextPayload = rest;
  }

  throw new Error("Failed to update settlement row");
};

const updateBookingSettlementStatusWithCompatibility = async (
  supabase: any,
  bookingId: string,
  payload: Record<string, unknown>,
) => {
  let nextPayload = { ...payload };

  while (Object.keys(nextPayload).length > 0) {
    const { error } = await supabase.from("bookings").update(nextPayload).eq("id", bookingId);

    if (!error) return;

    const missingColumn = getMissingColumnFromError(error, "bookings");
    if (!missingColumn || !(missingColumn in nextPayload)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextPayload;
    nextPayload = rest;
  }
};

const assertSettlementAllowed = (booking: any, payment: any) => {
  const paymentType = lower(payment?.payment_type || payment?.charge_type);
  const isMonthlyRent = paymentType === "monthly" || paymentType === "rent";

  const bookingStatus = lower(booking?.status);
  const allowedStatuses = isMonthlyRent
    ? ["approved", "confirmed", "checked-in", "checked_in", "active", "ongoing"]
    : ["approved", "confirmed", "checked-in", "checked_in", "active", "ongoing"];

  if (!allowedStatuses.includes(bookingStatus)) {
    throw new Error(
      isMonthlyRent
        ? "Rent payout is allowed only for active stays"
        : "Settlement allowed only for approved paid bookings",
    );
  }
};

const fetchCompletedPayment = async (
  supabase: any,
  bookingId: string,
  paymentId?: string,
) => {
  if (paymentId) {
    const { data: payment, error } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .eq("booking_id", bookingId)
      .in("status", ["completed", "success", "authorized"])
      .maybeSingle();

    if (error) throw error;
    if (!payment) throw new Error("Completed payment not found for settlement");
    return payment;
  }

  const { data: payments, error } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .in("status", ["completed", "success", "authorized"])
    .order("payment_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  if (!payments?.length) {
    throw new Error("Completed payment not found for settlement");
  }

  for (const payment of payments) {
    if (!payment?.id) return payment;
    const existing = await fetchSettlementByPaymentId(supabase, payment.id);
    if (!existing) {
      return payment;
    }
  }

  return payments[0];
};

const fetchPaymentById = async (supabase: any, paymentId: string) => {
  const normalizedPaymentId = normalize(paymentId);
  if (!normalizedPaymentId) return null;

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("id", normalizedPaymentId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const isBookingSettlementPayment = (paymentType: string) =>
  ["advance", "booking", "full", "deposit"].includes(lower(paymentType || "booking"));

const isMonthlySettlementPayment = (paymentType: string) =>
  paymentType === "monthly" || paymentType === "rent";

const settlementPaymentTypeMatches = (settlementPaymentType: unknown, paymentPaymentType: unknown) => {
  const normalizedSettlementType = lower(settlementPaymentType || "");
  const normalizedPaymentType = lower(paymentPaymentType || "");

  if (!normalizedSettlementType) return true;
  if (isMonthlySettlementPayment(normalizedSettlementType)) {
    return isMonthlySettlementPayment(normalizedPaymentType);
  }
  if (isBookingSettlementPayment(normalizedSettlementType)) {
    return isBookingSettlementPayment(normalizedPaymentType || "booking");
  }
  return normalizedSettlementType === normalizedPaymentType;
};

const scoreSettlementPaymentCandidate = (settlement: any, payment: any) => {
  const settlementCreatedAt = new Date(
    String(settlement?.created_at || settlement?.processed_at || new Date().toISOString()),
  ).getTime();
  const paymentCreatedAt = new Date(
    String(payment?.verified_at || payment?.payment_date || payment?.created_at || new Date().toISOString()),
  ).getTime();
  const timePenalty = Number.isFinite(settlementCreatedAt) && Number.isFinite(paymentCreatedAt)
    ? Math.abs(settlementCreatedAt - paymentCreatedAt) / 1000
    : 0;
  const settlementAmount = toAmount(settlement?.total_amount || settlement?.net_payable || 0);
  const paymentAmount = toAmount(payment?.amount || 0);
  const amountPenalty = settlementAmount > 0 && Math.abs(settlementAmount - paymentAmount) > 0.01
    ? 100_000 + Math.abs(settlementAmount - paymentAmount) * 100
    : Math.abs(settlementAmount - paymentAmount) * 100;
  const typePenalty = settlementPaymentTypeMatches(settlement?.payment_type, payment?.payment_type)
    ? 0
    : 1_000_000;

  return typePenalty + amountPenalty + timePenalty;
};

const findBestPaymentForSettlement = async (supabase: any, settlement: any) => {
  let query = supabase
    .from("payments")
    .select(
      "id, booking_id, amount, payment_type, status, payment_status, payment_date, verified_at, created_at, bookings!payments_booking_id_fkey(owner_id)",
    )
    .in("status", ["completed", "success", "authorized"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (normalize(settlement?.booking_id)) {
    query = query.eq("booking_id", normalize(settlement.booking_id));
  } else if (normalize(settlement?.owner_id)) {
    query = query.eq("bookings.owner_id", normalize(settlement.owner_id));
  } else {
    return null;
  }

  const { data, error } = await query;
  if (error) throw error;

  const candidates = [...(data || [])].sort(
    (left, right) => scoreSettlementPaymentCandidate(settlement, left) - scoreSettlementPaymentCandidate(settlement, right),
  );

  for (const candidate of candidates) {
    const existingSettlement = await fetchSettlementByPaymentId(supabase, normalize(candidate.id));
    if (!existingSettlement || normalize(existingSettlement.id) === normalize(settlement?.id)) {
      return candidate;
    }
  }

  return null;
};

const syncWalletTransactionPaymentLink = async (
  supabase: any,
  settlementId: string,
  paymentId: string,
) => {
  const normalizedSettlementId = normalize(settlementId);
  const normalizedPaymentId = normalize(paymentId);
  if (!normalizedSettlementId || !normalizedPaymentId) return;

  const { error } = await supabase
    .from("wallet_transactions")
    .update({ payment_id: normalizedPaymentId })
    .eq("settlement_id", normalizedSettlementId)
    .is("payment_id", null);

  if (error && !isMissingColumnError(error, "wallet_transactions", "payment_id")) {
    throw error;
  }
};

const healSettlementLinks = async (
  supabase: any,
  settlement: any,
  overrides: { bookingId?: string; paymentId?: string } = {},
) => {
  if (!settlement) return settlement;

  const currentBookingId = normalize(settlement.booking_id);
  const currentPaymentId = normalize(settlement.payment_id);
  let nextBookingId = currentBookingId || normalize(overrides.bookingId);
  let nextPaymentId = currentPaymentId || normalize(overrides.paymentId);
  let matchedPayment = null as any;

  try {
    if (nextPaymentId) {
      matchedPayment = await fetchPaymentById(supabase, nextPaymentId);
      if (!nextBookingId && normalize(matchedPayment?.booking_id)) {
        nextBookingId = normalize(matchedPayment.booking_id);
      }
    }
  } catch {
    matchedPayment = null;
  }

  try {
    if (!nextPaymentId && nextBookingId) {
      matchedPayment = await fetchCompletedPayment(supabase, nextBookingId);
      if (normalize(matchedPayment?.id)) {
        nextPaymentId = normalize(matchedPayment.id);
      }
      if (!nextBookingId && normalize(matchedPayment?.booking_id)) {
        nextBookingId = normalize(matchedPayment.booking_id);
      }
    }
  } catch {
    // Best effort healing only.
  }

  try {
    if ((!nextPaymentId || !nextBookingId) && normalize(settlement.owner_id)) {
      const inferredPayment = await findBestPaymentForSettlement(supabase, {
        ...settlement,
        booking_id: nextBookingId || settlement.booking_id,
      });
      if (inferredPayment) {
        matchedPayment = matchedPayment || inferredPayment;
        if (!nextPaymentId && normalize(inferredPayment.id)) {
          nextPaymentId = normalize(inferredPayment.id);
        }
        if (!nextBookingId && normalize(inferredPayment.booking_id)) {
          nextBookingId = normalize(inferredPayment.booking_id);
        }
      }
    }
  } catch {
    // Best effort healing only.
  }

  if (nextPaymentId) {
    try {
      const existingSettlement = await fetchSettlementByPaymentId(supabase, nextPaymentId);
      if (existingSettlement && normalize(existingSettlement.id) !== normalize(settlement.id)) {
        nextPaymentId = currentPaymentId;
      }
    } catch {
      nextPaymentId = currentPaymentId;
    }
  }

  const updatePayload = {} as Record<string, unknown>;
  if (!currentBookingId && nextBookingId) {
    updatePayload.booking_id = nextBookingId;
  }
  if (!currentPaymentId && nextPaymentId) {
    updatePayload.payment_id = nextPaymentId;
  }
  if (!normalize(settlement.payment_type) && normalize(matchedPayment?.payment_type)) {
    updatePayload.payment_type = matchedPayment.payment_type;
  }

  if (Object.keys(updatePayload).length === 0) {
    return settlement;
  }

  const updatedSettlement = await updateSettlementWithCompatibility(
    supabase,
    settlement.id,
    updatePayload,
  );

  if (normalize(updatedSettlement?.payment_id || updatePayload.payment_id)) {
    await syncWalletTransactionPaymentLink(
      supabase,
      normalize(updatedSettlement.id),
      normalize(updatedSettlement.payment_id || updatePayload.payment_id),
    );
  }

  return updatedSettlement;
};

const getPlatformFee = async (
  supabase: any,
  grossAmount: number,
  paymentType: string,
) => {
  if (isMonthlySettlementPayment(paymentType)) {
    return 0;
  }

  const { data: config, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", "platform_fee_percentage")
    .maybeSingle();

  if (error) throw error;

  const pct = Number(config?.value || 0);
  const fee = Number.isFinite(pct) ? (grossAmount * pct) / 100 : 0;
  return Math.round(fee * 100) / 100;
};

const computeGrossAmount = (booking: any, payment: any) =>
  toAmount(
    payment?.amount ||
      booking?.amount_paid ||
      booking?.amount_due ||
      booking?.advance_paid ||
      booking?.monthly_rent,
  );

const getSettlementWindow = (booking: any, payment: any) => {
  const baseDate = new Date(
    String(
      payment?.payment_date ||
        payment?.verified_at ||
        payment?.created_at ||
        booking?.start_date ||
        new Date().toISOString(),
    ),
  );

  if (!Number.isFinite(baseDate.getTime())) {
    const fallback = String(booking?.start_date || new Date().toISOString()).slice(0, 10);
    return {
      weekStartDate: fallback,
      weekEndDate: String(booking?.end_date || fallback).slice(0, 10),
    };
  }

  const start = new Date(baseDate);
  start.setUTCHours(0, 0, 0, 0);
  const day = start.getUTCDay();
  const diff = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - diff);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    weekStartDate: start.toISOString().slice(0, 10),
    weekEndDate: end.toISOString().slice(0, 10),
  };
};

const ensureSettlementForPayment = async (
  supabase: any,
  booking: any,
  payment: any,
) => {
  const totalAmount = computeGrossAmount(booking, payment);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("Settlement amount is zero");
  }

  const paymentType = lower(payment?.payment_type || payment?.charge_type || "booking");
  const isMonthlyPayment = isMonthlySettlementPayment(paymentType);
  const platformFee = await getPlatformFee(supabase, totalAmount, paymentType);
  const netPayable = Math.max(0, Math.round((totalAmount - platformFee) * 100) / 100);
  const { weekStartDate, weekEndDate } = getSettlementWindow(booking, payment);

  if (payment?.id) {
    const existing = await fetchSettlementByPaymentId(supabase, payment.id);
    if (existing) {
      if (
        isMonthlyPayment &&
        (
          Number(existing.platform_fee || 0) !== 0 ||
          Number(existing.net_payable || 0) !== totalAmount
        )
      ) {
        const { data: normalizedExisting, error: normalizedExistingError } = await supabase
          .from("settlements")
          .update({
            payment_type: paymentType,
            total_amount: totalAmount,
            platform_fee: 0,
            net_payable: totalAmount,
          })
          .eq("id", existing.id)
          .select("*")
          .single();

        if (normalizedExistingError) throw normalizedExistingError;
        return normalizedExisting;
      }

      return existing;
    }
  }

  if (!isMonthlyPayment && payment?.id) {
    let { data: legacySettlement, error: legacyError } = await supabase
      .from("settlements")
      .select("*")
      .eq("booking_id", booking.id)
      .is("payment_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (legacyError && isMissingColumnError(legacyError, "settlements", "payment_id")) {
      ({ data: legacySettlement, error: legacyError } = await supabase
        .from("settlements")
        .select("*")
        .eq("booking_id", booking.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (legacyError) throw legacyError;
    if (legacySettlement) {
      return await updateSettlementWithCompatibility(supabase, legacySettlement.id, {
        payment_id: payment.id,
        payment_type: paymentType,
        week_start_date: weekStartDate,
        week_end_date: weekEndDate,
        total_amount: totalAmount,
        platform_fee: platformFee,
        net_payable: netPayable,
        owner_id: booking.owner_id,
        provider: legacySettlement.provider || "cashfree",
      });
    }
  }

  return await insertSettlementWithCompatibility(supabase, {
    booking_id: booking.id,
    payment_id: payment?.id || null,
    payment_type: paymentType,
    owner_id: booking.owner_id,
    week_start_date: weekStartDate,
    week_end_date: weekEndDate,
    total_amount: totalAmount,
    platform_fee: platformFee,
    net_payable: netPayable,
    status: "PENDING",
    provider: "cashfree",
  });
};

const resolveSettlement = async (
  supabase: any,
  settlementId: string,
  bookingId: string,
  paymentId: string,
) => {
  if (settlementId) {
    const settlement = await fetchSettlementById(supabase, settlementId);
    if (!settlement) throw new Error("Settlement not found");
    return healSettlementLinks(supabase, settlement, { bookingId, paymentId });
  }

  if (paymentId) {
    const paymentSettlement = await fetchSettlementByPaymentId(supabase, paymentId);
    if (paymentSettlement) {
      return healSettlementLinks(supabase, paymentSettlement, { bookingId, paymentId });
    }
  }

  if (bookingId && !paymentId) {
    const existingSettlement = await fetchBookingLevelSettlementByBookingId(supabase, bookingId);
    if (existingSettlement) {
      return healSettlementLinks(supabase, existingSettlement, { bookingId });
    }
  }

  if (!bookingId) {
    throw new Error("settlementId or bookingId is required");
  }

  const booking = await fetchBookingForSettlement(supabase, bookingId);
  const payment = await fetchCompletedPayment(supabase, bookingId, paymentId || undefined);
  assertSettlementAllowed(booking, payment);
  return ensureSettlementForPayment(supabase, booking, payment);
};

const getRequesterRole = async (supabase: any, userId: string) => {
  const { data, error } = await supabase
    .from("accounts")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data?.role) {
    throw new Error("Forbidden settlement access");
  }

  return String(data.role).toLowerCase();
};

const assertSettlementAccess = async (supabase: any, userId: string, settlement: any) => {
  const role = await getRequesterRole(supabase, userId);
  if (role === "admin") {
    return;
  }

  if (role === "owner" && String(settlement?.owner_id || "") === userId) {
    return;
  }

  throw new Error("Forbidden settlement access");
};

const fetchOwnerProfile = async (supabase: any, ownerId: string) => {
  const { data: owner, error } = await supabase
    .from("owners")
    .select("id, name, email, phone, cashfree_beneficiary_id, bank_verification_status")
    .eq("id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!owner) throw new Error("Owner not found");
  return owner;
};

const fetchOwnerBankAccount = async (supabase: any, ownerId: string) => {
  const { data: bankAccount, error } = await supabase
    .from("owner_bank_accounts")
    .select(
      "owner_id, account_holder_name, account_number, ifsc, bank_name, branch_name, cashfree_beneficiary_id, verified, bank_verification_status",
    )
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!bankAccount) throw new Error("Owner bank account not found");
  return bankAccount;
};

const fetchCurrentOwnerBankVerification = async (supabase: any, ownerId: string) => {
  const { data, error } = await supabase
    .from("owner_bank_verification")
    .select("owner_id, transfer_status, verified_at, transfer_reference_id, provider_reference_id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const buildBeneficiaryId = (ownerId: string) =>
  `OWNER_${String(ownerId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20).toUpperCase()}`;

const normalizeBankAccountNumber = async (encryptedAccountNumber: string) => {
  const rawValue = String(encryptedAccountNumber || "").trim();
  if (!rawValue) {
    throw new Error("Owner bank account number is missing");
  }

  if (/^\d{9,18}$/.test(rawValue)) {
    return rawValue;
  }

  if (rawValue.includes(".")) {
    const decrypted = await decryptSensitiveValue(rawValue, getEncryptionSecret());
    const digits = String(decrypted || "").replace(/\D/g, "");
    if (/^\d{9,18}$/.test(digits)) {
      return digits;
    }
  }

  const digits = rawValue.replace(/\D/g, "");
  if (/^\d{9,18}$/.test(digits)) {
    return digits;
  }

  throw new Error("Stored owner bank account number is invalid");
};

const resolveBeneficiary = async (supabase: any, ownerId: string) => {
  const owner = await fetchOwnerProfile(supabase, ownerId);
  let bankAccount = await fetchOwnerBankAccount(supabase, ownerId);

  const bankStatus = lower(bankAccount.bank_verification_status || owner.bank_verification_status);
  const verification = await fetchCurrentOwnerBankVerification(supabase, ownerId).catch(
    () => null,
  );
  const verificationStatus = lower(verification?.transfer_status);
  const hasVerifiedSignal =
    bankAccount.verified ||
    bankStatus === "verified" ||
    (
      lower(owner.bank_verification_status) === "verified" &&
      verificationStatus === "success" &&
      Boolean(verification?.verified_at)
    );

  if (!hasVerifiedSignal) {
    throw new Error("Owner bank account is not verified");
  }

  if (!bankAccount.verified || bankStatus !== "verified") {
    const { data: updatedBankAccount, error: updateError } = await supabase
      .from("owner_bank_accounts")
      .update({
        verified: true,
        bank_verification_status: "verified",
      })
      .eq("owner_id", ownerId)
      .select(
        "owner_id, account_holder_name, account_number, ifsc, bank_name, branch_name, cashfree_beneficiary_id, verified, bank_verification_status",
      )
      .maybeSingle();

    if (updateError) throw updateError;
    if (updatedBankAccount) {
      bankAccount = updatedBankAccount;
    }
  }

  const beneficiaryId =
    String(
      bankAccount.cashfree_beneficiary_id ||
        owner.cashfree_beneficiary_id ||
        buildBeneficiaryId(ownerId),
    ).trim();

  if (!beneficiaryId) {
    throw new Error("Cashfree beneficiary not found for owner");
  }

  return {
    owner,
    bankAccount,
    beneficiaryId,
  };
};

const ensureRemoteBeneficiary = async (supabase: any, payoutProfile: {
  owner: any;
  bankAccount: any;
  beneficiaryId: string;
}) => {
  const bankAccountNumber = await normalizeBankAccountNumber(
    payoutProfile.bankAccount.account_number,
  );

  try {
    await createCashfreeBeneficiary({
      beneId: payoutProfile.beneficiaryId,
      name: String(
        payoutProfile.bankAccount.account_holder_name ||
          payoutProfile.owner.name ||
          "RoomFindR Owner",
      ).trim(),
      email: String(
        payoutProfile.owner.email || "owner@roomfindr.app",
      ).trim(),
      phone: String(payoutProfile.owner.phone || "").replace(/\D/g, "").slice(-10),
      bankAccount: bankAccountNumber,
      ifsc: String(payoutProfile.bankAccount.ifsc || "").trim().toUpperCase(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (!isDuplicateBeneficiaryError(message)) {
      throw error;
    }
  }

  const confirmedBeneficiary = await waitForConfirmedBeneficiary({
    beneficiaryId: payoutProfile.beneficiaryId,
    bankAccount: bankAccountNumber,
    ifsc: String(payoutProfile.bankAccount.ifsc || "").trim().toUpperCase(),
  });

  const confirmedBeneficiaryId =
    normalize(
      confirmedBeneficiary?.beneficiary_id ||
        confirmedBeneficiary?.beneficiaryId,
    ) || payoutProfile.beneficiaryId;

  await supabase.from("owners").update({
    cashfree_beneficiary_id: confirmedBeneficiaryId,
  }).eq("id", payoutProfile.owner.id);

  await supabase.from("owner_bank_accounts").update({
    cashfree_beneficiary_id: confirmedBeneficiaryId,
  }).eq("owner_id", payoutProfile.owner.id);

  return confirmedBeneficiaryId;
};

const ensureWallet = async (supabase: any, ownerId: string) => {
  const { data: existing, error: existingError } = await supabase
    .from("wallets")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("wallets")
    .insert({ owner_id: ownerId })
    .select("*")
    .single();

  if (error) throw error;
  return created;
};

const fetchWalletTransaction = async (supabase: any, settlementId: string) => {
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("*")
    .eq("settlement_id", settlementId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const fetchLatestWallet = async (supabase: any, walletId: string) => {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("id", walletId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Wallet not found");
  return data;
};

const insertNotification = async (
  supabase: any,
  input: { userId: string; title: string; message: string; type: string; data: Record<string, unknown> },
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

const bookingHasCheckedIn = (booking: any) => {
  const bookingStatus = lower(booking?.status);
  return Boolean(normalize(booking?.check_in_date)) ||
    ["checked-in", "checked_in", "active", "ongoing"].includes(bookingStatus);
};

const hasSettlementNotification = async (
  supabase: any,
  ownerId: string,
  settlementId: string,
  notificationType: string,
) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("notification_type, type, data")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  return (data || []).some((notification: any) =>
    lower(notification?.notification_type || notification?.type) === lower(notificationType) &&
    String(notification?.data?.settlement_id || "").trim() === settlementId
  );
};

const queueSettlementNotificationIfEligible = async (
  supabase: any,
  settlement: any,
  nextStatus: "COMPLETED" | "FAILED",
) => {
  if (!settlement?.owner_id || !settlement?.booking_id || !settlement?.id) {
    return;
  }

  const booking = await fetchBookingForSettlement(supabase, settlement.booking_id);
  if (!bookingHasCheckedIn(booking)) {
    return;
  }

  const notificationType = nextStatus === "COMPLETED"
    ? "settlement_completed"
    : "settlement_failed";

  if (await hasSettlementNotification(supabase, settlement.owner_id, String(settlement.id), notificationType)) {
    return;
  }

  const notificationCopy = buildPayoutNotificationCopy({
    paymentType: settlement.payment_type,
    customerName: booking.customer_name,
    roomNumber: booking.room_number,
    amount: settlement.net_payable || settlement.total_amount,
    currency: booking.currency,
    status: nextStatus,
  });

  await insertNotification(supabase, {
    userId: settlement.owner_id,
    title: notificationCopy.title,
    message: notificationCopy.message,
    type: notificationType,
    data: { settlement_id: settlement.id },
  });
};

const resolveTransferState = (payload: any): "PROCESSING" | "COMPLETED" | "FAILED" => {
  const candidates = [
    payload?.status,
    payload?.transfer_status,
    payload?.transferStatus,
    payload?.status_code,
    payload?.data?.status,
    payload?.data?.transfer_status,
    payload?.data?.status_code,
    payload?.transfer?.status,
    payload?.transfer?.transfer_status,
    payload?.transfer?.status_code,
  ]
    .map((item) => upper(item))
    .filter(Boolean);

  if (
    candidates.some((status) =>
      ["SUCCESS", "COMPLETED", "PROCESSED", "TRANSFER_SUCCESS", "TRANSFER_COMPLETED"].includes(status)
    )
  ) {
    return "COMPLETED";
  }

  if (
    candidates.some(
      (status) =>
        status.includes("FAIL") ||
        status.includes("REJECT") ||
        status.includes("REVERSE") ||
        ["FAILED", "CANCELLED", "TERMINATED"].includes(status),
    )
  ) {
    return "FAILED";
  }

  return "PROCESSING";
};

const extractProviderReference = (payload: any) =>
  String(
    payload?.cf_transfer_id ||
      payload?.reference_id ||
      payload?.transfer_reference ||
      payload?.data?.cf_transfer_id ||
      payload?.data?.reference_id ||
      payload?.transfer?.cf_transfer_id ||
      payload?.transfer?.reference_id ||
      "",
  ).trim() || null;

const buildTransferId = (settlement: any, isRetry: boolean) => {
  const normalizedSettlementId = String(settlement.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  if (isRetry) {
    const suffix = String(Date.now()).slice(-8);
    return `STL_${normalizedSettlementId.slice(0, 23)}_${suffix}`;
  }

  return `STL_${normalizedSettlementId.slice(0, 32)}`;
};

const buildTransferRemarks = (settlement: any) => {
  const normalizedSettlementId = String(settlement.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return `RFSTL${normalizedSettlementId.slice(0, 12)}`;
};

const buildSyntheticTransferResponse = (
  transferId: string,
  error: unknown,
) => ({
  transfer_id: transferId,
  status: "SUCCESS",
  transfer_status: "SUCCESS",
  reference_id: `synthetic_${transferId}`,
  error_message: error instanceof Error ? error.message : String(error || ""),
  synthetic: true,
});

const isSyntheticTransferReference = (value: unknown) =>
  lower(normalize(value)).startsWith("synthetic_");

const waitForConfirmedBeneficiary = async (input: {
  beneficiaryId: string;
  bankAccount: string;
  ifsc: string;
}) => {
  const deadline = Date.now() + 60_000;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    const lookups = [
      () => fetchCashfreeBeneficiary({ beneficiaryId: input.beneficiaryId }),
      () =>
        fetchCashfreeBeneficiary({
          bankAccount: input.bankAccount,
          ifsc: input.ifsc,
        }),
    ];

    for (const lookup of lookups) {
      try {
        const beneficiary = await lookup();
        const status = normalize(
          beneficiary?.beneficiary_status || beneficiary?.status,
        ).toUpperCase();

        if (["INVALID", "FAILED", "DELETED", "CANCELLED"].includes(status)) {
          throw new Error(`Beneficiary status is ${status}`);
        }

        return beneficiary;
      } catch (error) {
        lastError = error instanceof Error
          ? error
          : new Error("Unable to confirm beneficiary");
      }
    }

    await sleep(3_000);
  }

  throw lastError || new Error("Unable to confirm beneficiary in Cashfree");
};

const waitForTerminalTransferState = async (transferId: string) => {
  const deadline = Date.now() + 90_000;
  let lastSnapshot: any = null;
  let lastStatus: "PROCESSING" | "COMPLETED" | "FAILED" = "PROCESSING";

  while (Date.now() < deadline) {
    try {
      lastSnapshot = await fetchCashfreeTransfer(transferId);
      lastStatus = resolveTransferState(lastSnapshot);
      if (lastStatus !== "PROCESSING") {
        return { snapshot: lastSnapshot, status: lastStatus };
      }
    } catch {
      // Cashfree can acknowledge the transfer before it is immediately queryable.
    }

    await sleep(3_000);
  }

  return { snapshot: lastSnapshot, status: lastStatus };
};

const syncBookingSettlementStatus = async (
  supabase: any,
  bookingId: string,
  nextStatus: "PROCESSING" | "COMPLETED" | "FAILED",
) => {
  const bookingUpdate: Record<string, unknown> = {
    settlement_status: lower(nextStatus),
    payout_status:
      nextStatus === "COMPLETED"
        ? "success"
        : nextStatus === "FAILED"
          ? "failed"
          : "processing",
  };

  await updateBookingSettlementStatusWithCompatibility(supabase, bookingId, bookingUpdate);
};

const syncWalletState = async (
  supabase: any,
  walletId: string,
  previousStatus: string | null,
  nextStatus: "pending" | "completed" | "failed",
  amount: number,
) => {
  const wallet = await fetchLatestWallet(supabase, walletId);
  let available = toAmount(wallet.available_balance);
  let pending = toAmount(wallet.pending_balance);

  const from = lower(previousStatus);
  const to = lower(nextStatus);

  if (from === to) return wallet;

  if (from === "pending") {
    pending = Math.max(0, pending - amount);
  }

  if (from === "completed") {
    available = Math.max(0, available - amount);
  }

  if (to === "pending") {
    pending += amount;
  }

  if (to === "completed") {
    available += amount;
  }

  const { data: updated, error } = await supabase
    .from("wallets")
    .update({
      available_balance: available,
      pending_balance: pending,
    })
    .eq("id", walletId)
    .select("*")
    .single();

  if (error) throw error;
  return updated;
};

const syncWalletTransaction = async (
  supabase: any,
  wallet: any,
  settlement: any,
  transferId: string,
  nextStatus: "pending" | "completed" | "failed",
) => {
  const amount = toAmount(settlement.net_payable || settlement.total_amount);
  const linkedPaymentId = normalize(settlement.payment_id);
  let walletTxn = await fetchWalletTransaction(supabase, settlement.id);

  if (!walletTxn) {
    const { data: created, error } = await supabase
      .from("wallet_transactions")
      .insert({
        wallet_id: wallet.id,
        settlement_id: settlement.id,
        payment_id: linkedPaymentId || null,
        amount,
        currency: settlement.currency || "INR",
        type: "credit",
        status: nextStatus,
        reference: transferId,
      })
      .select("*")
      .single();

    if (error) throw error;
    walletTxn = created;
    await syncWalletState(supabase, wallet.id, null, nextStatus, amount);
    return walletTxn;
  }

  const currentStatus = lower(walletTxn.status);
  const currentReference = String(walletTxn.reference || "");
  const currentPaymentId = normalize(walletTxn.payment_id);
  const needsReferenceUpdate = currentReference !== transferId;
  const needsPaymentLink = Boolean(linkedPaymentId && currentPaymentId !== linkedPaymentId);

  if (currentStatus !== nextStatus || needsReferenceUpdate || needsPaymentLink) {
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      reference: transferId,
    };

    if (needsPaymentLink) {
      updatePayload.payment_id = linkedPaymentId;
    }

    const { data: updated, error } = await supabase
      .from("wallet_transactions")
      .update(updatePayload)
      .eq("id", walletTxn.id)
      .select("*")
      .single();

    if (error) throw error;
    walletTxn = updated;
  }

  if (currentStatus !== nextStatus) {
    await syncWalletState(supabase, wallet.id, currentStatus, nextStatus, amount);
  }

  return walletTxn;
};

const updateSettlementState = async (
  supabase: any,
  settlement: any,
  wallet: any,
  input: {
    transferId: string;
    providerReference: string | null;
    nextStatus: "PROCESSING" | "COMPLETED" | "FAILED";
  },
) => {
  const currentStatus = upper(settlement.status);
  if (currentStatus === "COMPLETED" && input.nextStatus !== "COMPLETED") {
    return settlement;
  }

  const update: Record<string, unknown> = {
    status: input.nextStatus,
    payout_status:
      input.nextStatus === "COMPLETED"
        ? "success"
        : input.nextStatus === "FAILED"
          ? "failed"
          : "processing",
    provider: "cashfree",
    provider_transfer_id: input.transferId,
    provider_reference: input.providerReference || settlement.provider_reference || null,
    processed_at: input.nextStatus === "COMPLETED" ? new Date().toISOString() : null,
  };

  const updatedSettlement = await updateSettlementWithCompatibility(
    supabase,
    settlement.id,
    update,
  );

  await syncBookingSettlementStatus(
    supabase,
    updatedSettlement.booking_id,
    input.nextStatus,
  );

  const walletStatus =
    input.nextStatus === "COMPLETED"
      ? "completed"
      : input.nextStatus === "FAILED"
        ? "failed"
        : "pending";

  await syncWalletTransaction(
    supabase,
    wallet,
    updatedSettlement,
    input.transferId,
    walletStatus,
  );

  if (updatedSettlement.owner_id && currentStatus !== input.nextStatus) {
    if (input.nextStatus === "COMPLETED" || input.nextStatus === "FAILED") {
      await queueSettlementNotificationIfEligible(
        supabase,
        updatedSettlement,
        input.nextStatus,
      );
    }
  }

  return updatedSettlement;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const supabase = getSupabaseClient();
    const { settlementId, bookingId, paymentId, createOnly, internalKey } = await parseSettlementPayload(req);
    const internalRequest = await isInternalServiceRoleRequest(supabase, req, internalKey);
    const user = internalRequest
      ? null
      : (await requireAuthenticatedUser(req)).user;
    const settlement = await resolveSettlement(supabase, settlementId, bookingId, paymentId);
    if (!internalRequest) {
      await assertSettlementAccess(supabase, String(user?.id || ""), settlement);
    }

    if (createOnly) {
      await syncBookingSettlementStatus(supabase, settlement.booking_id, upper(settlement.status));
      return jsonResponse(req, {
        success: true,
        settlement,
        message: "Settlement record synced",
      });
    }

    if (upper(settlement.status) === "COMPLETED") {
      await syncBookingSettlementStatus(supabase, settlement.booking_id, "COMPLETED");
      return jsonResponse(req, {
        success: true,
        settlement,
        message: "Settlement already completed",
      });
    }

    const wallet = await ensureWallet(supabase, settlement.owner_id);

    if (upper(settlement.status) === "PROCESSING" && settlement.provider_transfer_id) {
      if (
        allowSyntheticSandboxPayout() &&
        isSyntheticTransferReference(settlement.provider_reference)
      ) {
        const transferSnapshot = buildSyntheticTransferResponse(
          settlement.provider_transfer_id,
          new Error("Synthetic sandbox payout auto-completed"),
        );
        const updatedSettlement = await updateSettlementState(supabase, settlement, wallet, {
          transferId: settlement.provider_transfer_id,
          providerReference: extractProviderReference(transferSnapshot),
          nextStatus: "COMPLETED",
        });

        return jsonResponse(req, {
          success: true,
          settlement: updatedSettlement,
          transfer_id: settlement.provider_transfer_id,
          transfer: transferSnapshot,
          reconciled: true,
          synthetic: true,
        });
      }

      let transferSnapshot = null;
      let nextStatus: "PROCESSING" | "COMPLETED" | "FAILED" = "PROCESSING";

      try {
        transferSnapshot = await fetchCashfreeTransfer(settlement.provider_transfer_id);
        nextStatus = resolveTransferState(transferSnapshot);

        if (nextStatus === "PROCESSING") {
          const polledTransfer = await waitForTerminalTransferState(
            settlement.provider_transfer_id,
          );
          if (polledTransfer.snapshot) {
            transferSnapshot = polledTransfer.snapshot;
          }
          nextStatus = polledTransfer.status;
        }
      } catch {
        return jsonResponse(req, {
          success: true,
          settlement,
          transfer_id: settlement.provider_transfer_id,
          message: "Settlement already processing",
        });
      }

      const updatedSettlement = await updateSettlementState(supabase, settlement, wallet, {
        transferId: settlement.provider_transfer_id,
        providerReference: extractProviderReference(transferSnapshot),
        nextStatus,
      });

      return jsonResponse(req, {
        success: true,
        settlement: updatedSettlement,
        transfer_id: settlement.provider_transfer_id,
        transfer: transferSnapshot,
        reconciled: true,
      });
    }

    const payoutProfile = await resolveBeneficiary(supabase, settlement.owner_id);
    const transferAmount = toAmount(settlement.net_payable || settlement.total_amount);

    if (transferAmount <= 0) {
      throw new Error("Settlement amount is zero");
    }

    const transferId =
      upper(settlement.status) === "FAILED" && settlement.provider_transfer_id
        ? buildTransferId(settlement, true)
        : String(settlement.provider_transfer_id || buildTransferId(settlement, false));
    let beneficiaryId = payoutProfile.beneficiaryId;

    let transferResponse;
    try {
      try {
        transferResponse = await createCashfreeTransfer({
          transferId,
          beneId: beneficiaryId,
          amount: transferAmount,
          remarks: buildTransferRemarks(settlement),
          transferMode: "banktransfer",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "");
        if (!/beneficiary id does not exist|beneficiary.*not.*exist/i.test(lower(message))) {
          throw error;
        }

        beneficiaryId = await ensureRemoteBeneficiary(supabase, payoutProfile);
        transferResponse = await createCashfreeTransfer({
          transferId,
          beneId: beneficiaryId,
          amount: transferAmount,
          remarks: buildTransferRemarks(settlement),
          transferMode: "banktransfer",
        });
      }
    } catch (error) {
      if (!allowSyntheticSandboxPayout()) {
        throw error;
      }

      transferResponse = buildSyntheticTransferResponse(transferId, error);
    }

    let transferSnapshot = transferResponse;
    let nextStatus = resolveTransferState(transferResponse);
    let workingSettlement = settlement;

    if (nextStatus === "PROCESSING") {
      workingSettlement = await updateSettlementState(supabase, settlement, wallet, {
        transferId,
        providerReference: extractProviderReference(transferResponse),
        nextStatus: "PROCESSING",
      });
    }

    if (nextStatus === "PROCESSING") {
      try {
        transferSnapshot = await fetchCashfreeTransfer(transferId);
        nextStatus = resolveTransferState(transferSnapshot);
      } catch {
        // Cashfree can acknowledge the transfer before status is queryable.
      }

      if (nextStatus === "PROCESSING") {
        const polledTransfer = await waitForTerminalTransferState(transferId);
        if (polledTransfer.snapshot) {
          transferSnapshot = polledTransfer.snapshot;
        }
        nextStatus = polledTransfer.status;
      }
    }

    const updatedSettlement = await updateSettlementState(supabase, workingSettlement, wallet, {
      transferId,
      providerReference: extractProviderReference(transferSnapshot) || extractProviderReference(transferResponse),
      nextStatus,
    });

    return jsonResponse(req, {
      success: true,
      settlement: updatedSettlement,
      transfer_id: transferId,
      transfer: transferSnapshot,
    });
  } catch (error) {
    const message = (() => {
      if (error instanceof Error && error.message?.trim()) {
        return error.message;
      }

      if (error && typeof error === "object") {
        const payload = error as Record<string, unknown>;
        const parts = [
          String(payload.message || "").trim(),
          String(payload.code || "").trim(),
          String(payload.details || "").trim(),
          String(payload.hint || "").trim(),
        ].filter(Boolean);

        if (parts.length > 0) {
          return parts.join(" | ");
        }

        try {
          return JSON.stringify(payload);
        } catch {
          return "Settlement failed";
        }
      }

      return "Settlement failed";
    })();
    const status = /missing bearer token|invalid or expired auth token/i.test(message)
      ? 401
      : /forbidden settlement access|owner or admin access required|admin access required/i.test(message)
        ? 403
        : 400;
    return errorResponse(
      req,
      status,
      message,
    );
  }
});
