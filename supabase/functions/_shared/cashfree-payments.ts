import {
  fetchCashfreePgOrder,
  fetchCashfreePgOrderPayments,
  terminateCashfreePgOrder,
} from "./cashfree.ts";
import { deleteCachedJson, getCachedData, setCachedJson } from "./cache.ts";

export const lower = (value: unknown): string => String(value || "").toLowerCase();
export const upper = (value: unknown): string => String(value || "").toUpperCase();

const isMissingBookingColumnError = (error: unknown, columnName: string): boolean => {
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

const isMissingPaymentColumnError = (error: unknown, columnName: string): boolean => {
  const code = String((error as { code?: string } | null)?.code || "").trim();
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return (
    (code === "42703" && message.includes(`column payments.${columnName.toLowerCase()} does not exist`)) ||
    (code === "PGRST204" && message.includes(`could not find the '${columnName.toLowerCase()}' column of 'payments'`))
  );
};

const getMissingPaymentColumnFromError = (error: unknown): string => {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  const match =
    message.match(/column payments\.([a-z0-9_]+) does not exist/) ||
    message.match(/could not find the '([a-z0-9_]+)' column of 'payments'/);
  return match?.[1] || "";
};

const isMissingRentLedgerTableError = (error: unknown): boolean => {
  const code = String((error as { code?: string } | null)?.code || "").trim();
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return (
    (code === "42P01" && message.includes("relation \"public.rent\" does not exist")) ||
    (code === "PGRST205" && message.includes("could not find the table 'public.rent'")) ||
    message.includes("relation \"rent\" does not exist")
  );
};

export const isFinalPaymentStatus = (status: string): boolean =>
  ["completed", "failed", "cancelled", "refunded"].includes(lower(status));

export const isProcessedStatus = (status: string): boolean =>
  ["completed", "failed", "cancelled", "refunded"].includes(lower(status));

export const isOrderPaidStatus = (status: string): boolean =>
  ["paid", "success", "completed"].includes(lower(status));

export const isOrderFailedStatus = (status: string): boolean =>
  ["failed", "cancelled", "expired", "terminated"].includes(lower(status));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PAYMENT_SELECT_COLUMN_LIST = [
  "id",
  "booking_id",
  "customer_id",
  "amount",
  "payment_type",
  "payment_method",
  "status",
  "verified_at",
  "webhook_received",
  "failure_reason",
  "provider_order_id",
  "provider_payment_id",
  "metadata",
  "payment_date",
  "created_at",
  "updated_at",
];

const PAYMENT_SELECT_COLUMNS = PAYMENT_SELECT_COLUMN_LIST.join(", ");
const PAYMENT_SELECT_COLUMNS_LEGACY = PAYMENT_SELECT_COLUMNS;

const normalizePaymentRecord = <T>(value: T): T => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    payment_status: record.payment_status ?? record.status ?? null,
    ...record,
  } as T;
};

const normalizePaymentResult = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePaymentRecord(entry)) as T;
  }

  return normalizePaymentRecord(value);
};

export const executePaymentSelectWithCompatibility = async <T>(
  run: (selectClause: string) => Promise<{ data: T; error: unknown }>,
): Promise<{ data: T; error: unknown }> => {
  let result = await run(PAYMENT_SELECT_COLUMNS);

  if (result.error && isMissingPaymentColumnError(result.error, "payment_status")) {
    result = await run(PAYMENT_SELECT_COLUMNS_LEGACY);
  }

  return {
    data: normalizePaymentResult(result.data),
    error: result.error,
  };
};

export const updatePaymentWithCompatibility = async (
  supabase: any,
  paymentId: string,
  paymentUpdate: Record<string, unknown>,
) => {
  let nextUpdate = { ...paymentUpdate };
  if ("status" in nextUpdate && !("payment_status" in nextUpdate)) {
    nextUpdate = {
      ...nextUpdate,
      payment_status: nextUpdate.status,
    };
  }

  while (Object.keys(nextUpdate).length > 0) {
    const { error } = await supabase
      .from("payments")
      .update(nextUpdate)
      .eq("id", paymentId);

    if (!error) return;

    const missingColumn = getMissingPaymentColumnFromError(error);
    if (!missingColumn || !(missingColumn in nextUpdate)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextUpdate;
    nextUpdate = rest;
  }
};

export const insertPaymentWithCompatibility = async (
  supabase: any,
  paymentInsert: Record<string, unknown>,
  selectClause = "*",
) => {
  let nextInsert = { ...paymentInsert };
  if ("status" in nextInsert && !("payment_status" in nextInsert)) {
    nextInsert = {
      ...nextInsert,
      payment_status: nextInsert.status,
    };
  }

  while (Object.keys(nextInsert).length > 0) {
    const { data, error } = await supabase
      .from("payments")
      .insert(nextInsert)
      .select(selectClause)
      .single();

    if (!error) {
      return normalizePaymentRecord(data);
    }

    const missingColumn = getMissingPaymentColumnFromError(error);
    if (!missingColumn || !(missingColumn in nextInsert)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextInsert;
    nextInsert = rest;
  }

  throw new Error("Payment insert failed.");
};

const CASHFREE_PENDING_CACHE_TTL_SECONDS = 10;
const CASHFREE_FINAL_CACHE_TTL_SECONDS = 300;
const CASHFREE_TERMINATION_STALE_GRACE_MS = 60_000;

const buildCashfreeOrderCacheKeys = (orderId: string) => ({
  order: `cashfree:order:${orderId}`,
  payments: `cashfree:order-payments:${orderId}`,
});

export const invalidateCashfreeOrderCache = async (orderId: string | null | undefined) => {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) return;

  const keys = buildCashfreeOrderCacheKeys(normalizedOrderId);
  await Promise.all([
    deleteCachedJson(keys.order),
    deleteCachedJson(keys.payments),
  ]);
};

const pickGatewayPaymentId = (payload: unknown): string | null => {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { payments?: unknown[] })?.payments)
        ? (payload as { payments: unknown[] }).payments
        : [];

  const firstSuccessful = list.find((entry: any) =>
    ["success", "completed", "paid"].includes(
      lower(entry?.payment_status || entry?.status),
    ),
  ) as any;

  const record = firstSuccessful || (list[0] as any);
  return record?.cf_payment_id || record?.payment_id || null;
};

const hasSuccessfulGatewayPayment = (payload: unknown): boolean => {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { payments?: unknown[] })?.payments)
        ? (payload as { payments: unknown[] }).payments
        : [];

  return list.some((entry: any) =>
    ["success", "completed", "paid"].includes(
      lower(entry?.payment_status || entry?.status),
    ),
  );
};

const isCashfreeTerminationRequested = (status: string): boolean =>
  upper(status) === "TERMINATION_REQUESTED";

const isPaymentOlderThanTerminationGrace = (payment: any): boolean => {
  const createdAt = String(payment?.created_at || "").trim();
  if (!createdAt) return false;

  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;

  return (Date.now() - createdAtMs) >= CASHFREE_TERMINATION_STALE_GRACE_MS;
};

const hasSuccessfulCashfreeOrderPayment = async (orderId: string): Promise<boolean> => {
  try {
    const orderPayments = await fetchCashfreePgOrderPayments(orderId);
    return hasSuccessfulGatewayPayment(orderPayments);
  } catch {
    return false;
  }
};

export const normalizePublicPaymentStatus = (status: string): string => {
  const normalized = lower(status);
  if (["completed", "paid", "success", "authorized"].includes(normalized)) {
    return "paid";
  }
  if (["failed", "cancelled", "refunded"].includes(normalized)) {
    return "failed";
  }
  return "pending";
};

const isProviderOrderMissingError = (error: unknown): boolean => {
  const message = String(error instanceof Error ? error.message : error || "").trim().toLowerCase();
  return /not found|does not exist|invalid order|order reference id does not exist/.test(message);
};

const reconcileStoredFinalPaymentState = async (supabase: any, payment: any) => {
  const storedStatus = lower(payment?.status || payment?.payment_status);
  if (!payment?.booking_id || !storedStatus) return;

  const normalizedFinalStatus =
    ["completed", "paid", "success", "authorized"].includes(storedStatus)
      ? "completed"
      : ["failed", "cancelled", "expired", "terminated"].includes(storedStatus)
        ? "failed"
        : ["refunded"].includes(storedStatus)
          ? "refunded"
          : storedStatus;

  try {
    await updatePaymentWithCompatibility(supabase, payment.id, {
      status: normalizedFinalStatus,
      verified_at: payment?.verified_at || new Date().toISOString(),
    });
  } catch {
    // Best-effort normalization only; continue with booking reconciliation.
  }

  const reconciledPayment = {
    ...payment,
    status: normalizedFinalStatus,
    payment_status: normalizedFinalStatus,
  };

  if (["completed", "paid", "success", "authorized"].includes(storedStatus)) {
    await markBookingPaid(supabase, payment.booking_id, reconciledPayment);
    return;
  }

  if (["failed", "cancelled"].includes(storedStatus)) {
    await markBookingFailed(supabase, payment.booking_id, reconciledPayment);
  }
};

export const fetchPaymentByInput = async (
  supabase: any,
  input: {
    orderId?: string;
    bookingId?: string;
    paymentType?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) => {
  const runQuery = async (mode: "order" | "booking") => {
    const { data, error } = await executePaymentSelectWithCompatibility<any[]>(
      async (selectClause) => {
        let query = supabase.from("payments").select(selectClause);

        if (mode === "order" && input.orderId) {
          query = query.eq("provider_order_id", input.orderId);
        } else if (mode === "booking" && input.bookingId) {
          query = query.eq("booking_id", input.bookingId);
        }

        return await query
          .order("created_at", { ascending: false })
          .limit(mode === "order" ? 1 : 25);
      },
    );

    if (error) throw error;
    return Array.isArray(data) ? data : data ? [data] : [];
  };

  let rows = input.orderId ? await runQuery("order") : [];
  if (!rows.length && input.bookingId) {
    rows = await runQuery("booking");
  }
  if (!rows.length) return null;

  if (input.orderId && rows.length === 1 && rows[0]?.provider_order_id === input.orderId) {
    return rows[0];
  }

  const matched = rows.find((payment: any) => matchesRetryScope(payment, input));
  if (matched) return matched;

  return input.paymentType ? null : rows[0];
};

export const fetchPaymentByGatewayMeta = async (
  supabase: any,
  input: { orderId?: string | null; paymentId?: string | null },
) => {
  const { data, error } = await executePaymentSelectWithCompatibility<any>(
    async (selectClause) => {
      let query = supabase.from("payments").select(selectClause);

      if (input.orderId && input.paymentId) {
        query = query.or(
          `provider_order_id.eq.${input.orderId},provider_payment_id.eq.${input.paymentId}`,
        );
      } else if (input.orderId) {
        query = query.eq("provider_order_id", input.orderId);
      } else if (input.paymentId) {
        query = query.eq("provider_payment_id", input.paymentId);
      }

      return await query
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    },
  );

  if (error) throw error;
  return data;
};

export const fetchPaymentById = async (supabase: any, paymentId: string) => {
  const { data, error } = await executePaymentSelectWithCompatibility<any>(
    (selectClause) =>
      supabase
        .from("payments")
        .select(selectClause)
        .eq("id", paymentId)
        .maybeSingle(),
  );

  if (error) throw error;
  return data;
};

export const fetchBookingForAccess = async (supabase: any, bookingId: string) => {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, status, customer_id, owner_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Booking not found");
  return data;
};

const updateBookingWithCompatibility = async (
  supabase: any,
  bookingId: string,
  bookingUpdate: Record<string, unknown>,
) => {
  let nextUpdate = { ...bookingUpdate };

  while (Object.keys(nextUpdate).length > 0) {
    const { error } = await supabase
      .from("bookings")
      .update(nextUpdate)
      .eq("id", bookingId);

    if (!error) return;

    const missingColumn = getMissingBookingColumnFromError(error);
    if (!missingColumn || !(missingColumn in nextUpdate)) {
      throw error;
    }

    const { [missingColumn]: _ignored, ...rest } = nextUpdate;
    nextUpdate = rest;
  }
};

const buildFunctionUrl = (functionName: string): string => {
  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
  if (!supabaseUrl) return "";

  try {
    return new URL(`/functions/v1/${functionName}`, supabaseUrl).toString();
  } catch {
    return "";
  }
};

const getInternalFunctionHeaders = (): Record<string, string> | null => {
  const serviceRoleKey = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SERVICE_ROLE_KEY") ||
      "",
  ).trim();

  if (!serviceRoleKey) {
    return null;
  }

  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceRoleKey}`,
    "x-supabase-auth": `Bearer ${serviceRoleKey}`,
    "apikey": serviceRoleKey,
  };
};

const isMonthlyRentPayment = (payment: any): boolean => {
  const paymentType = lower(payment?.payment_type || payment?.charge_type);
  return paymentType === "monthly" || paymentType === "rent";
};

const getPaymentMetadata = (payment: any): Record<string, unknown> => {
  const metadata = payment?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
};

const getClientContext = (payment: any): Record<string, unknown> => {
  const metadata = getPaymentMetadata(payment);
  const clientContext = metadata.client_context;
  if (!clientContext || typeof clientContext !== "object" || Array.isArray(clientContext)) {
    return {};
  }
  return clientContext as Record<string, unknown>;
};

const extractScopedMonth = (metadata?: Record<string, unknown> | null): string => {
  const month = String(
    metadata?.month ||
    ((metadata?.client_context as Record<string, unknown> | undefined)?.month) ||
    "",
  ).trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : "";
};

const normalizeRetryPaymentType = (value: unknown): "booking" | "monthly" => {
  const normalized = lower(value);
  if (normalized === "monthly" || normalized === "rent") {
    return "monthly";
  }
  return "booking";
};

const matchesRetryScope = (
  payment: any,
  input: { paymentType?: string | null; metadata?: Record<string, unknown> | null },
): boolean => {
  const targetType = normalizeRetryPaymentType(input.paymentType);
  const paymentType = normalizeRetryPaymentType(payment?.payment_type || payment?.charge_type);
  if (paymentType !== targetType) return false;

  if (targetType !== "monthly") return true;

  const targetMonth = extractScopedMonth(input.metadata);
  if (!targetMonth) return true;

  const paymentMonth = extractScopedMonth({
    ...getPaymentMetadata(payment),
    client_context: getClientContext(payment),
  });

  return paymentMonth === targetMonth;
};

const isUnsupportedPaymentFailedStatusError = (error: unknown): boolean => {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return message.includes("payment_failed") &&
    (
      message.includes("enum") ||
      message.includes("check constraint") ||
      message.includes("invalid input value")
    );
};

const isIgnorableRentCycleAdvanceError = (error: unknown): boolean => {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return message.includes("already_advanced") ||
    message.includes("rent_cycle_not_due") ||
    message.includes("payment_type_not_rent");
};

const advanceMonthlyRentCycle = async (supabase: any, payment: any) => {
  if (!payment?.id || !isMonthlyRentPayment(payment)) return null;

  try {
    // The database owns the next-cycle transition so it happens exactly once.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("advance_rent_cycle_on_payment", {
      p_payment_id: payment.id,
    });

    if (error) throw error;
    return data || null;
  } catch (error) {
    if (isIgnorableRentCycleAdvanceError(error)) {
      return null;
    }
    throw error;
  }
};

const syncMonthlyRentLedger = async (
  supabase: any,
  bookingId: string,
  payment: any,
  cycleAdvance?: Record<string, unknown> | null,
) => {
  if (!bookingId || !payment?.id || !isMonthlyRentPayment(payment)) return;

  const now = new Date().toISOString();
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, owner_id, customer_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) throw bookingError;
  if (!booking) return;

  const nextMetadata = {
    ...getPaymentMetadata(payment),
    payment_id: payment.id,
    payment_type: payment.payment_type || "monthly",
    month: extractScopedMonth(getPaymentMetadata(payment)) || null,
    source: "cashfree_payment_confirmation",
    cycle_advanced: !!cycleAdvance?.advanced,
    cycle_start_date: cycleAdvance?.previous_cycle_start_date ||
      cycleAdvance?.covered_from ||
      getPaymentMetadata(payment)?.cycle_start_date ||
      null,
    cycle_end_date: cycleAdvance?.covered_to ||
      cycleAdvance?.new_cycle_start_date ||
      getPaymentMetadata(payment)?.cycle_end_date ||
      null,
    next_due_date: cycleAdvance?.new_next_due_date ||
      getPaymentMetadata(payment)?.cycle_next_due_date ||
      getPaymentMetadata(payment)?.next_due_date ||
      null,
  };

  const record = {
    transaction_id: payment.id,
    booking_id: bookingId,
    owner_id: booking.owner_id,
    customer_id: payment.customer_id || booking.customer_id,
    amount: Number(payment.amount || 0),
    payment_status: "success",
    cashfree_order_id: String(payment.provider_order_id || payment.cashfree_order_id || "").trim() || null,
    cf_payment_id: String(payment.provider_payment_id || payment.cf_payment_id || "").trim() || null,
    metadata: nextMetadata,
    updated_at: now,
  };

  const { data: existing, error: existingError } = await supabase
    .from("rent")
    .select("id, metadata")
    .eq("transaction_id", payment.id)
    .maybeSingle();

  if (existingError && isMissingRentLedgerTableError(existingError)) {
    return;
  }
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("rent")
      .update({
        ...record,
        metadata: {
          ...((existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata))
            ? existing.metadata
            : {}),
          ...nextMetadata,
        },
      })
      .eq("id", existing.id);
    if (updateError && isMissingRentLedgerTableError(updateError)) {
      return;
    }
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await supabase
    .from("rent")
    .insert({
      ...record,
      created_at: payment.payment_date || payment.verified_at || payment.created_at || now,
    });

  if (insertError && isMissingRentLedgerTableError(insertError)) {
    return;
  }
  if (insertError) throw insertError;
};

const terminateCashfreeOrderForRetry = async (payment: any) => {
  const orderId = String(payment?.provider_order_id || "").trim();
  if (!orderId) {
    return { status: "", terminated: false };
  }

  let currentStatus = "";
  try {
    const currentOrder = await fetchCashfreePgOrder(orderId);
    currentStatus = upper(currentOrder?.order_status || currentOrder?.status);
  } catch (error) {
    const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
    if (
      message.includes("order reference id does not exist") ||
      message.includes("does not exist")
    ) {
      return { status: "MISSING", terminated: true as const, missing: true as const };
    }
    throw error;
  }
  if (isOrderPaidStatus(currentStatus)) {
    return { status: currentStatus, terminated: false, alreadyPaid: true as const };
  }
  if (isCashfreeTerminationRequested(currentStatus)) {
    const hasSuccess = await hasSuccessfulCashfreeOrderPayment(orderId);
    if (hasSuccess) {
      return { status: currentStatus, terminated: false, alreadyPaid: true as const };
    }
    if (isPaymentOlderThanTerminationGrace(payment)) {
      return { status: currentStatus, terminated: true as const, staleTermination: true as const };
    }
  }
  if (isOrderFailedStatus(currentStatus)) {
    return { status: currentStatus, terminated: true as const };
  }

  let nextStatus = currentStatus;

  try {
    const termination = await terminateCashfreePgOrder(orderId, {
      idempotencyKey: `terminate_${orderId}`,
    });
    nextStatus = upper(termination?.order_status || termination?.status || currentStatus);
  } catch (error) {
    const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
    if (!message.includes("already") && !message.includes("terminated") && !message.includes("cancelled")) {
      throw error;
    }
  }

  if (isOrderPaidStatus(nextStatus)) {
    return { status: nextStatus, terminated: false, alreadyPaid: true as const };
  }
  if (isOrderFailedStatus(nextStatus)) {
    return { status: nextStatus, terminated: true as const };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await wait(1000);
    try {
      const order = await fetchCashfreePgOrder(orderId);
      nextStatus = upper(order?.order_status || order?.status);
    } catch (error) {
      const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
      if (
        message.includes("order reference id does not exist") ||
        message.includes("does not exist")
      ) {
        return { status: "MISSING", terminated: true as const, missing: true as const };
      }
      throw error;
    }

    if (isOrderPaidStatus(nextStatus)) {
      return { status: nextStatus, terminated: false, alreadyPaid: true as const };
    }
    if (isOrderFailedStatus(nextStatus)) {
      return { status: nextStatus, terminated: true as const };
    }
  }

  if (isCashfreeTerminationRequested(nextStatus)) {
    const hasSuccess = await hasSuccessfulCashfreeOrderPayment(orderId);
    if (hasSuccess) {
      return { status: nextStatus, terminated: false, alreadyPaid: true as const };
    }
    if (isPaymentOlderThanTerminationGrace(payment)) {
      return { status: nextStatus, terminated: true as const, staleTermination: true as const };
    }
  }

  return { status: nextStatus || currentStatus, terminated: false, pendingTermination: true as const };
};

export const triggerMonthlyRentAutoSettlement = async (input: {
  bookingId: string;
  payment: any;
}) => {
  if (!input.bookingId || !input.payment?.id || !isMonthlyRentPayment(input.payment)) {
    return;
  }

  const functionUrl = buildFunctionUrl("cashfree-settlement");
  const headers = getInternalFunctionHeaders();
  const serviceRoleKey = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SERVICE_ROLE_KEY") ||
      "",
  ).trim();
  if (!functionUrl || !headers) {
    return;
  }

  const triggerPromise = fetch(functionUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      bookingId: input.bookingId,
      paymentId: input.payment.id,
      trigger: "monthly_rent_autopayout",
      internal_key: serviceRoleKey || undefined,
    }),
  }).then(async (response) => {
    if (!response.ok) {
      await response.text().catch(() => "");
      return;
    }
  }).catch((error) => {
    void error;
  });

  const edgeRuntime = (globalThis as any)?.EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(triggerPromise);
    return;
  }

  await triggerPromise;
};

export const markBookingPaid = async (
  supabase: any,
  bookingId: string,
  payment: any,
) => {
  await invalidateCashfreeOrderCache(payment?.provider_order_id);

  const paymentType = lower(payment?.payment_type || payment?.charge_type);
  if (paymentType === "monthly" || paymentType === "rent") {
    const cycleAdvance = await advanceMonthlyRentCycle(supabase, payment);
    const bookingUpdate: Record<string, unknown> = {
      rent_payment_status: cycleAdvance?.advanced ? "not_due" : "paid",
    };

    if (cycleAdvance?.new_cycle_start_date) {
      bookingUpdate.current_cycle_start_date = cycleAdvance.new_cycle_start_date;
    }
    if (cycleAdvance?.new_next_due_date) {
      bookingUpdate.next_due_date = cycleAdvance.new_next_due_date;
    }

    await updateBookingWithCompatibility(supabase, bookingId, bookingUpdate);

    await syncMonthlyRentLedger(supabase, bookingId, payment, cycleAdvance);
    await triggerMonthlyRentAutoSettlement({ bookingId, payment });
    return;
  }

  const bookingUpdate: Record<string, unknown> = {
    payment_status: "paid",
    payment_id: payment.id,
    amount_paid: Number(payment.amount || 0),
    advance_payment_status: "paid",
  };

  await updateBookingWithCompatibility(supabase, bookingId, bookingUpdate);

  const { error: bookingStatusError } = await supabase.from("bookings")
    .update({ status: "requested" })
    .eq("id", bookingId)
    .in("status", ["payment_pending", "pending", "PAID"]);
  if (bookingStatusError) throw bookingStatusError;
};

export const markBookingFailed = async (
  supabase: any,
  bookingId: string,
  payment?: any,
) => {
  await invalidateCashfreeOrderCache(payment?.provider_order_id);

  const paymentType = lower(payment?.payment_type || payment?.charge_type);
  if (paymentType === "monthly" || paymentType === "rent") {
    await updateBookingWithCompatibility(supabase, bookingId, { rent_payment_status: "failed" });
    return;
  }

  const bookingUpdate: Record<string, unknown> = {
    payment_status: "failed",
    advance_payment_status: paymentType ? "failed" : undefined,
  };

  await updateBookingWithCompatibility(supabase, bookingId, bookingUpdate);

  const { error: bookingStatusError } = await supabase
    .from("bookings")
    .update({ status: "payment_failed" })
    .eq("id", bookingId)
    .in("status", ["requested", "payment_pending", "pending", "PAID", "payment_failed"]);
  if (bookingStatusError && !isUnsupportedPaymentFailedStatusError(bookingStatusError)) {
    throw bookingStatusError;
  }
};

export const deactivateBookingPaymentsForRetry = async (
  supabase: any,
  input: {
    bookingId: string;
    paymentType?: string | null;
    metadata?: Record<string, unknown> | null;
    excludePaymentId?: string | null;
    reason?: string;
    replacementOrderId?: string | null;
  },
) => {
  const { data: payments, error } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT_COLUMNS)
    .eq("booking_id", input.bookingId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const reason = String(input.reason || "Superseded by fresh payment retry").trim();
  const now = new Date().toISOString();
  const activePayments = (payments || []).filter((payment: any) =>
    payment?.id &&
    payment.id !== input.excludePaymentId &&
    !isFinalPaymentStatus(String(payment.status || "")) &&
    matchesRetryScope(payment, input)
  );

  for (const payment of activePayments) {
    const termination = await terminateCashfreeOrderForRetry(payment);
    if (termination.alreadyPaid) {
      const update = {
        status: "completed",
        verified_at: now,
        webhook_received: true,
        failure_reason: null,
      };

      let paymentUpdateError: unknown = null;
      try {
        await updatePaymentWithCompatibility(supabase, payment.id, update);
      } catch (error) {
        paymentUpdateError = error;
      }
      if (paymentUpdateError) throw paymentUpdateError;

      await markBookingPaid(supabase, input.bookingId, { ...payment, ...update });

      return {
        paymentIds: [],
        count: 0,
        alreadyPaid: true,
        bookingId: input.bookingId,
      };
    }

    if (termination.pendingTermination) {
      throw new Error("Previous payment is still closing. Please wait a few seconds and retry.");
    }

    const nextMetadata = {
      ...getPaymentMetadata(payment),
      retry_cleanup: {
        reason,
        failed_at: now,
        replacement_order_id: input.replacementOrderId || null,
        terminated_order_status: termination.status || null,
      },
    };

    let paymentError: unknown = null;
    try {
      await updatePaymentWithCompatibility(supabase, payment.id, {
        status: "failed",
        failure_reason: reason,
        verified_at: now,
        metadata: nextMetadata,
      });
    } catch (error) {
      paymentError = error;
    }
    if (paymentError) throw paymentError;

    await invalidateCashfreeOrderCache(payment?.provider_order_id);

    const { error: attemptError } = await supabase
      .from("payment_attempts")
      .update({
        status: "failed",
        failure_reason: reason,
        updated_at: now,
      })
      .eq("payment_id", payment.id)
      // Older hosted schemas still use the enum
      // ('initiated','pending','success','failed','expired') for
      // payment_attempts.status, so filtering on newer values like
      // cancelled/refunded makes the filter itself fail before the update runs.
      .not("status", "in", "(success,failed)");
    if (attemptError) throw attemptError;
  }

  const retryPaymentType = normalizeRetryPaymentType(input.paymentType);
  if (activePayments.length > 0 || retryPaymentType === "booking") {
    await markBookingFailed(supabase, input.bookingId, {
      payment_type: retryPaymentType,
    });
  }

  return {
    paymentIds: activePayments.map((payment: any) => String(payment.id)),
    count: activePayments.length,
    alreadyPaid: false,
    bookingId: input.bookingId,
  };
};

export const verifyCashfreePaymentStatus = async (
  supabase: any,
  input: {
    orderId?: string;
    bookingId?: string;
    paymentType?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) => {
  const payment = await fetchPaymentByInput(supabase, input);
  if (!payment) {
    throw new Error("Payment not found");
  }

  if (input.bookingId && payment.booking_id !== input.bookingId) {
    throw new Error("Payment reference mismatch");
  }

  const storedStatus = String(payment.status || payment.payment_status || "");
  if (isFinalPaymentStatus(storedStatus)) {
    await reconcileStoredFinalPaymentState(supabase, payment);
    return {
      success: true,
      status: normalizePublicPaymentStatus(storedStatus),
      bookingId: payment.booking_id,
      payment,
    };
  }

  const orderIdToCheck = payment.provider_order_id || input.orderId;
  if (!orderIdToCheck) {
    throw new Error("Missing provider order id");
  }

  const orderCacheKey = `cashfree:order:${orderIdToCheck}`;
  let orderStatusPayload: { orderStatus: string; orderData: any };
  try {
    orderStatusPayload = await getCachedData<{ orderStatus: string; orderData: any }>(
      orderCacheKey,
      CASHFREE_PENDING_CACHE_TTL_SECONDS,
      async () => {
        const orderData = await fetchCashfreePgOrder(orderIdToCheck);
        const payload = {
          orderStatus: upper(orderData?.order_status || orderData?.status),
          orderData,
        };
        return payload;
      },
    );
  } catch (error) {
    if (!isProviderOrderMissingError(error)) {
      throw error;
    }

    const update = {
      status: "failed",
      failure_reason: "Provider order not found",
      verified_at: new Date().toISOString(),
      webhook_received: true,
    };

    let paymentUpdateError: unknown = null;
    try {
      await updatePaymentWithCompatibility(supabase, payment.id, update);
    } catch (error) {
      paymentUpdateError = error;
    }
    if (paymentUpdateError) throw paymentUpdateError;
    const nextPayment = { ...payment, ...update };
    await markBookingFailed(supabase, payment.booking_id, nextPayment);

    return {
      success: true,
      status: "failed",
      bookingId: payment.booking_id,
      payment: nextPayment,
      orderStatus: "NOT_FOUND",
    };
  }
  const orderData = orderStatusPayload.orderData;
  const orderStatus = orderStatusPayload.orderStatus;

  if (isOrderPaidStatus(orderStatus) || isOrderFailedStatus(orderStatus)) {
    await setCachedJson(orderCacheKey, orderStatusPayload, CASHFREE_FINAL_CACHE_TTL_SECONDS);
  }

  if (isOrderPaidStatus(orderStatus)) {
    let providerPaymentId = payment.provider_payment_id;

    try {
      const orderPaymentsCacheKey = `cashfree:order-payments:${orderIdToCheck}`;
      const paymentSnapshot = await getCachedData<{ providerPaymentId: string | null }>(
        orderPaymentsCacheKey,
        CASHFREE_FINAL_CACHE_TTL_SECONDS,
        async () => {
        const orderPayments = await fetchCashfreePgOrderPayments(orderIdToCheck);
        return {
          providerPaymentId: pickGatewayPaymentId(orderPayments),
        };
      });
      providerPaymentId = paymentSnapshot.providerPaymentId || providerPaymentId;
    } catch {
      // Do not fail verification when the order is already marked paid.
    }

    const update = {
      status: "completed",
      provider_payment_id: providerPaymentId,
      verified_at: new Date().toISOString(),
      webhook_received: true,
      failure_reason: null,
    };

    let paymentUpdateError: unknown = null;
    try {
      await updatePaymentWithCompatibility(supabase, payment.id, update);
    } catch (error) {
      paymentUpdateError = error;
    }
    if (paymentUpdateError) throw paymentUpdateError;
    const nextPayment = { ...payment, ...update };
    await markBookingPaid(supabase, payment.booking_id, nextPayment);

    return {
      success: true,
      status: "paid",
      bookingId: payment.booking_id,
      payment: nextPayment,
      orderStatus,
    };
  }

  if (isOrderFailedStatus(orderStatus)) {
    const update = {
      status: "failed",
      failure_reason: `Order ${orderStatus}`,
      verified_at: new Date().toISOString(),
      webhook_received: true,
    };

    let paymentUpdateError: unknown = null;
    try {
      await updatePaymentWithCompatibility(supabase, payment.id, update);
    } catch (error) {
      paymentUpdateError = error;
    }
    if (paymentUpdateError) throw paymentUpdateError;
    const nextPayment = { ...payment, ...update };
    await markBookingFailed(supabase, payment.booking_id, nextPayment);

    return {
      success: true,
      status: "failed",
      bookingId: payment.booking_id,
      payment: nextPayment,
      orderStatus,
    };
  }

  return {
    success: true,
    status: "pending",
    bookingId: payment.booking_id,
    payment,
    orderStatus,
  };
};
