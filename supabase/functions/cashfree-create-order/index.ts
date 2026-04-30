// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { assertAllowedOrigin, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { buildRateLimitKey, enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";
import { signPaymentStatusToken } from "../_shared/security.ts";
import {
  isHttpUrl,
  sanitizeReturnBaseUrl,
} from "../_shared/return-url.ts";
import {
  deactivateBookingPaymentsForRetry,
  executePaymentSelectWithCompatibility,
  insertPaymentWithCompatibility,
  markBookingFailed,
  markBookingPaid,
  updatePaymentWithCompatibility,
} from "../_shared/cashfree-payments.ts";

const getEnv = (key: string) => Deno.env.get(key) ?? '';
const cleanEnv = (value: string) => value.replaceAll(/["']/g, '').trim();

const json = (req: Request, body: unknown, status = 200) => jsonResponse(req, body, status);

const normalizePhone = (value: string) => value.replaceAll(/\D/g, '');

const normalizePhoneForCashfree = (value: string) => {
  const digits = normalizePhone(value || '');
  if (digits.length < 10) {
    throw new Error('Invalid customer phone');
  }
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const normalizePhoneForCashfreeOrEmpty = (value: unknown) => {
  try {
    return normalizePhoneForCashfree(String(value || ''));
  } catch {
    return '';
  }
};

const pickFirstText = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const parsePayload = async (req: Request) => {
  const payload = await req.json().catch(() => ({}));
  return {
    payload,
    bookingId: payload?.bookingId || payload?.booking_id,
    amount: Number(payload?.amount || 0),
    customerId: String(payload?.customerId || payload?.customer_id || '').trim(),
    customerName: String(payload?.customerName || payload?.customer_name || '').trim(),
    customerEmail: String(payload?.customerEmail || payload?.customer_email || '').trim(),
    customerPhone: String(payload?.customerPhone || payload?.customer_phone || '').trim(),
    upiMethod: payload?.upiMethod || payload?.upi_method,
    card: payload?.card || null,
    idempotencyKey: payload?.idempotencyKey,
    paymentType: payload?.paymentType,
    description: payload?.description,
    metadata: payload?.metadata ?? null,
    returnBaseUrl: String(payload?.returnBaseUrl || payload?.return_base_url || '').trim(),
    appType: String(payload?.app || payload?.appType || payload?.app_type || 'customer').trim().toLowerCase(),
    nativeApp: Boolean(payload?.nativeApp || payload?.native_app),
  };
};

const assertValidPayload = (input: {
  bookingId: string | undefined;
  amount: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  appType: string;
}) => {
  if (!input.bookingId) throw new Error('bookingId is required');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Invalid amount');
  if (!input.customerEmail || !input.customerPhone) {
    throw new Error('Customer email and phone are required');
  }
  if (!isValidEmail(input.customerEmail)) throw new Error('Invalid customer email');
  normalizePhoneForCashfree(input.customerPhone);
  if (!['customer', 'owner', 'admin'].includes(input.appType)) {
    throw new Error('Invalid app type');
  }
  if (!input.customerName) {
    throw new Error('Customer name is required');
  }
};

const getSupabaseClient = () => {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
};

const parseBearerToken = (value: string) => {
  const header = String(value || '').trim();
  if (!header) return '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && token) {
    return token.trim();
  }
  return header;
};

const getRequestAuthToken = (req: Request) =>
  parseBearerToken(req.headers.get('x-supabase-auth') || '') ||
  parseBearerToken(req.headers.get('Authorization') || req.headers.get('authorization') || '');

const getSupabaseAuthClient = (token: string) => {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = cleanEnv(getEnv('SUPABASE_ANON_KEY'));
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
};

const getAuthenticatedUser = async (req: Request) => {
  const authToken = getRequestAuthToken(req);
  if (!authToken) throw new Error('Unauthorized');
  const authClient = getSupabaseAuthClient(authToken);
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user) throw new Error('Unauthorized');
  return userData.user;
};

const getCashfreeConfig = () => {
  const env = (getEnv('CASHFREE_ENV') || 'test').toLowerCase();
  const isProd = env === 'production' || env === 'prod';
  const clientId = cleanEnv(getEnv('CASHFREE_CLIENT_ID'));
  const clientSecret = cleanEnv(getEnv('CASHFREE_CLIENT_SECRET'));
  const apiVersion = cleanEnv(getEnv('CASHFREE_API_VERSION') || '2025-01-01');
  if (!clientId || !clientSecret) {
    throw new Error('Cashfree credentials missing');
  }
  return {
    baseUrl: isProd ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
    clientId,
    clientSecret,
    apiVersion,
    isProd,
  };
};

const mapUpiProvider = (method?: string) => {
  const val = (method || '').toLowerCase();
  if (val.includes('phonepe')) return 'phonepe';
  if (val.includes('paytm')) return 'paytm';
  if (val.includes('gpay') || val.includes('google')) return 'gpay';
  return 'phonepe';
};

const lower = (val: unknown) => String(val || '').toLowerCase();
const upper = (val: unknown) => String(val || '').toUpperCase();

const isFinalPaymentStatus = (status: string) =>
  ['completed', 'failed', 'cancelled', 'refunded'].includes(lower(status));

const isPaymentSuccessStatus = (status: string) =>
  ['completed', 'paid', 'success'].includes(lower(status));

const isRetryableFailureStatus = (status: string) =>
  ['failed', 'cancelled'].includes(lower(status));

const isOrderPaidStatus = (status: string) =>
  ['PAID', 'SUCCESS', 'COMPLETED'].includes(upper(status));

const isOrderFailedStatus = (status: string) =>
  ['FAILED', 'CANCELLED', 'EXPIRED', 'TERMINATED'].includes(upper(status));

const isOrderClosingStatus = (status: string) =>
  ['TERMINATION_REQUESTED'].includes(upper(status));

const normalizeMetadata = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
);

const CASHFREE_GATEWAY_ORDER_EXPIRY_MS = 16 * 60 * 1000;
const CLIENT_QR_PAYMENT_WINDOW_MS = 5 * 60 * 1000;

const buildGatewayOrderExpiryTime = (baseTimeMs = Date.now()) =>
  new Date(baseTimeMs + CASHFREE_GATEWAY_ORDER_EXPIRY_MS).toISOString();

const resolveReturnedOrderExpiryTime = (rawValue: unknown) => {
  const parsed = Date.parse(String(rawValue || '').trim());
  const clientVisibleExpiry = Date.now() + CLIENT_QR_PAYMENT_WINDOW_MS;
  if (!Number.isFinite(parsed)) {
    return new Date(clientVisibleExpiry).toISOString();
  }

  return new Date(Math.min(parsed, clientVisibleExpiry)).toISOString();
};

const assertValidPaymentShell = (input: {
  bookingId: string | undefined;
  amount: number;
  appType: string;
}) => {
  if (!input.bookingId) throw new Error('bookingId is required');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Invalid amount');
  if (!['customer', 'owner', 'admin'].includes(input.appType)) {
    throw new Error('Invalid app type');
  }
};

const normalizeMonthToken = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (!raw) return '';

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
};

const parsePositiveAmount = (value: unknown): number | null => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount;
};

const pickPositiveAmount = (...values: unknown[]): number | null => {
  for (const value of values) {
    const amount = parsePositiveAmount(value);
    if (amount !== null) {
      return amount;
    }
  }
  return null;
};

const isMissingColumnError = (error: unknown, columnName: string) => {
  const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
  return (
    String((error as { code?: string } | null)?.code || '') === '42703' &&
    message.includes(`column bookings.${columnName.toLowerCase()} does not exist`)
  );
};

const isMissingBookingsSelectColumnError = (error: unknown) => {
  const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
  return (
    String((error as { code?: string } | null)?.code || '') === '42703' &&
    message.includes('column bookings.')
  );
};

const fetchBooking = async (supabase: any, bookingId: string) => {
  const selectCandidates = [
    'id, status, payment_status, rent_payment_status, admin_approved, advance_amount, amount_due, advance_paid, monthly_rent, currency, customer_id, owner_id, customer_name, customer_phone, customer_email, current_cycle_start_date, next_due_date, cycle_duration_days, check_in_date, start_date',
    'id, status, payment_status, admin_approved, advance_amount, amount_due, advance_paid, monthly_rent, currency, customer_id, owner_id, customer_name, customer_phone, customer_email, current_cycle_start_date, next_due_date, cycle_duration_days, start_date',
    'id, status, payment_status, advance_amount, amount_due, advance_paid, monthly_rent, currency, customer_id, owner_id, customer_name, customer_phone, customer_email, start_date',
    'id, status, payment_status, advance_amount, amount_due, advance_paid, monthly_rent, currency, customer_id, owner_id, start_date',
    'id, status, payment_status, amount_due, advance_paid, monthly_rent, currency, customer_id, owner_id, start_date',
  ];

  let booking = null;
  let bookingError = null;

  for (const selectClause of selectCandidates) {
    const result = await supabase
      .from('bookings')
      .select(selectClause)
      .eq('id', bookingId)
      .maybeSingle();

    booking = result.data;
    bookingError = result.error;

    if (!bookingError || !isMissingBookingsSelectColumnError(bookingError)) {
      break;
    }
  }

  if (bookingError) throw bookingError;
  if (!booking) throw new Error('Booking not found');
  return {
    rent_payment_status: null,
    admin_approved: null,
    advance_amount: null,
    amount_due: null,
    current_cycle_start_date: null,
    next_due_date: null,
    cycle_duration_days: null,
    check_in_date: null,
    ...booking,
  };
};

const fetchCustomerProfile = async (supabase: any, customerId: string | null) => {
  if (!customerId) return null;

  const customerResult = await supabase
    .from('customers')
    .select('id, name, email, phone')
    .eq('id', customerId)
    .maybeSingle();

  if (customerResult.data) return customerResult.data;

  const accountResult = await supabase
    .from('accounts')
    .select('id, email, phone')
    .eq('id', customerId)
    .maybeSingle();

  return accountResult.data || null;
};

const resolveCashfreeCustomerDetails = (input: {
  booking: any;
  profile: any | null;
  authenticatedUser: any;
  payloadName: string;
  payloadEmail: string;
  payloadPhone: string;
}) => {
  const userMetadata = input.authenticatedUser?.user_metadata || {};
  const customerName = pickFirstText(
    input.profile?.name,
    userMetadata.name,
    input.booking?.customer_name,
    input.payloadName,
    input.authenticatedUser?.email,
    'RoomFindR Customer',
  );
  const customerEmail = pickFirstText(
    input.profile?.email,
    input.authenticatedUser?.email,
    input.booking?.customer_email,
    input.payloadEmail,
  );
  const customerPhone = pickFirstText(
    normalizePhoneForCashfreeOrEmpty(input.profile?.phone),
    normalizePhoneForCashfreeOrEmpty(userMetadata.phone),
    normalizePhoneForCashfreeOrEmpty(input.booking?.customer_phone),
    normalizePhoneForCashfreeOrEmpty(input.payloadPhone),
  );

  if (!isValidEmail(customerEmail)) {
    throw new Error('Customer email is missing or invalid');
  }
  if (!customerPhone) {
    throw new Error('Customer phone is missing or invalid');
  }

  return {
    customerName,
    customerEmail,
    customerPhone,
  };
};

const updateBookingWithCompatibility = async (
  supabase: any,
  bookingId: string,
  bookingUpdate: Record<string, unknown>,
) => {
  let { error } = await supabase.from('bookings').update(bookingUpdate).eq('id', bookingId);

  if (error && 'rent_payment_status' in bookingUpdate && isMissingColumnError(error, 'rent_payment_status')) {
    const { rent_payment_status: _ignored, ...legacyUpdate } = bookingUpdate;
    ({ error } = await supabase.from('bookings').update(legacyUpdate).eq('id', bookingId));
  }

  if (error) throw error;
};

const resolveAdvanceAmount = (booking: any) =>
  pickPositiveAmount(
    booking.amount_due,
    booking.advance_amount,
    booking.advance_paid,
    booking.monthly_rent,
  );

const resolveMonthlyAmount = (booking: any) =>
  pickPositiveAmount(
    booking.monthly_rent,
    booking.amount_due,
  );

const buildDefaultIdempotencyKey = (
  bookingId: string,
  paymentType: string | undefined,
  amount: number,
  metadata: Record<string, unknown> | null,
) => {
  const normalizedPaymentType = lower(paymentType || 'booking') || 'booking';

  if (normalizedPaymentType === 'monthly' || normalizedPaymentType === 'rent') {
    const monthToken = String((metadata as { month?: unknown } | null)?.month || '').trim();
    const monthlyScope = /^\d{4}-\d{2}$/.test(monthToken)
      ? monthToken
      : new Date().toISOString().slice(0, 7);
    return `idem_${bookingId}_${normalizedPaymentType}_${monthlyScope}_${amount}`;
  }

  return `idem_${bookingId}_${normalizedPaymentType}_${amount}`;
};

const assertAmountMatches = (expectedAmount: number, amount: number) => {
  if (Math.abs(expectedAmount - amount) > 0.01) {
    throw new Error('Amount mismatch for booking');
  }
};

const assertBookingUnpaid = (booking: any) => {
  if (String(booking.payment_status || '').toLowerCase() === 'paid' ||
      String(booking.status || '').toLowerCase() === 'confirmed') {
    throw new Error('Booking already paid');
  }
};

const fetchBookingRentCycle = async (supabase: any, bookingId: string) => {
  const { data, error } = await supabase.rpc('get_booking_rent_cycle', {
    p_booking_id: bookingId,
  });

  if (error) {
    throw new Error(error.message || 'Unable to resolve the current rent cycle');
  }

  return data;
};

const assertMonthlyRentAllowed = (cycle: any, metadata: Record<string, unknown>) => {
  const cycleMonth = normalizeMonthToken(cycle?.current_cycle_start_date);
  const requestedMonth = normalizeMonthToken(metadata.month);

  if (!cycle?.can_pay_rent) {
    const nextDueDate = String(cycle?.next_due_date || cycle?.cycle_end_date || '').trim();
    throw new Error(
      nextDueDate
        ? `Rent payment is not due yet. It will open automatically on ${nextDueDate}.`
        : 'Rent payment is not due yet. It opens automatically when the current cycle reaches its due date.'
    );
  }

  if (requestedMonth && cycleMonth && requestedMonth !== cycleMonth) {
    throw new Error(`Rent payment is only available for the active cycle ${cycleMonth}.`);
  }

  return cycleMonth || requestedMonth;
};

const getConfiguredReturnBaseUrl = (appType: string): string => {
  const normalizedApp = String(appType || 'customer').trim().toLowerCase();
  const appSpecificKeys = normalizedApp === 'owner'
    ? ['OWNER_PAYMENT_RETURN_BASE_URL', 'OWNER_APP_URL', 'OWNER_MOBILE_APP_URL']
    : normalizedApp === 'admin'
      ? ['ADMIN_PAYMENT_RETURN_BASE_URL', 'ADMIN_APP_URL', 'ADMIN_MOBILE_APP_URL']
      : ['CUSTOMER_PAYMENT_RETURN_BASE_URL', 'CUSTOMER_APP_URL', 'CUSTOMER_MOBILE_APP_URL'];

  const sharedKeys = ['PAYMENT_RETURN_BASE_URL', 'APP_URL', 'SITE_URL', 'MOBILE_APP_URL'];

  for (const key of [...appSpecificKeys, ...sharedKeys]) {
    const value = cleanEnv(getEnv(key));
    const normalized = sanitizeReturnBaseUrl(value);
    if (normalized) return normalized;
  }

  return '';
};

const getRequestReturnBaseUrl = (req: Request): string => {
  const origin = cleanEnv(req.headers.get('origin') || '');
  if (origin && isHttpUrl(origin)) {
    return sanitizeReturnBaseUrl(origin);
  }

  const referer = cleanEnv(req.headers.get('referer') || '');
  if (referer && isHttpUrl(referer)) {
    try {
      return sanitizeReturnBaseUrl(new URL(referer).origin);
    } catch {
      return '';
    }
  }

  return '';
};

const getExplicitReturnBaseUrl = (value: string): string => {
  return sanitizeReturnBaseUrl(value);
};

const buildFunctionUrl = (functionName: string) => {
  const supabaseUrl = cleanEnv(getEnv('SUPABASE_URL'));
  if (!supabaseUrl || !isHttpUrl(supabaseUrl)) {
    throw new Error('Missing or invalid SUPABASE_URL');
  }

  return new URL(`/functions/v1/${functionName}`, supabaseUrl).toString();
};

const buildReturnUrl = async (
  req: Request,
  appType: string,
  bookingId: string,
  orderId: string,
  explicitReturnBaseUrl?: string,
  paymentType?: string,
  metadata?: Record<string, unknown> | null,
  nativeApp?: boolean,
) => {
  const payloadBaseUrl = getExplicitReturnBaseUrl(explicitReturnBaseUrl || '');
  const requestBaseUrl = getRequestReturnBaseUrl(req);
  const configuredBaseUrl = getConfiguredReturnBaseUrl(appType);
  const resolvedFrontendBaseUrl = payloadBaseUrl
    || configuredBaseUrl
    || requestBaseUrl;
  const url = new URL(buildFunctionUrl('payment-status'));
  url.searchParams.set('b', bookingId);
  url.searchParams.set('o', orderId);
  url.searchParams.set('a', appType);
  const normalizedPaymentType = String(paymentType || '').trim().toLowerCase();
  url.searchParams.set(
    'st',
    await signPaymentStatusToken({
      bookingId,
      orderId,
      app: appType,
      paymentType: normalizedPaymentType === 'monthly' || normalizedPaymentType === 'rent' ? 'monthly' : 'booking',
      month: String((metadata as { month?: unknown } | null)?.month || '').trim() || undefined,
      expiresInSeconds: 20 * 60,
    }),
  );
  if (resolvedFrontendBaseUrl) {
    url.searchParams.set('f', resolvedFrontendBaseUrl);
  }
  if (nativeApp) {
    url.searchParams.set('n', '1');
  }
  return url.toString();
};

const buildWebhookUrl = () => {
  const explicitUrl = cleanEnv(getEnv('CASHFREE_WEBHOOK_URL'));
  if (explicitUrl) {
    if (!isHttpUrl(explicitUrl)) {
      throw new Error('Invalid CASHFREE_WEBHOOK_URL');
    }
    return explicitUrl;
  }

  return buildFunctionUrl('verifyCashfreeWebhook');
};

const findExistingPayment = async (supabase: any, idempotencyKey: string) => {
  const { data, error } = await executePaymentSelectWithCompatibility<any>(
    (selectClause) =>
      supabase
        .from('payments')
        .select(selectClause)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
  );
  if (error) throw error;
  return data;
};

const fetchCashfreeOrderStatus = async (cashfree: any, orderId: string) => {
  const res = await fetch(`${cashfree.baseUrl}/orders/${orderId}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': cashfree.clientId,
      'x-client-secret': cashfree.clientSecret,
      'x-api-version': cashfree.apiVersion,
    },
  });
  const data = await res.json().catch(() => ({}));
  const status = upper(data?.order_status || data?.status);
  return { ok: res.ok, status, data };
};

const fetchCashfreeOrderPaymentId = async (cashfree: any, orderId: string) => {
  const res = await fetch(`${cashfree.baseUrl}/orders/${orderId}/payments`, {
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': cashfree.clientId,
      'x-client-secret': cashfree.clientSecret,
      'x-api-version': cashfree.apiVersion,
    },
  });
  const data = await res.json().catch(() => ([]));
  if (!res.ok) return null;
  const list = Array.isArray(data) ? data : (data?.data || data?.payments || []);
  const success = list.find((p: any) => upper(p?.payment_status || p?.status) === 'SUCCESS');
  const item = success || list[0];
  return item?.cf_payment_id || item?.payment_id || null;
};

const insertPayment = async (supabase: any, input: {
  bookingId: string;
  booking: any;
  amount: number;
  card: any;
  upiMethod: string | undefined;
  idempotencyKey: string;
  orderId: string;
  paymentType: string | undefined;
  metadata: Record<string, unknown>;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}) => {
  const payment = await insertPaymentWithCompatibility(supabase, {
    booking_id: input.bookingId,
    customer_id: input.booking.customer_id,
    amount: input.amount,
    status: 'pending',
    payment_method: input.card ? 'card' : 'upi',
    payment_type: input.paymentType || 'booking',
    currency: input.booking.currency || 'INR',
    provider: 'cashfree',
    provider_order_id: input.orderId,
    idempotency_key: input.idempotencyKey,
    metadata: {
      upi_method: input.upiMethod || null,
      client_context: input.metadata ?? null,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
    },
  }, '*');
  return payment;
};

const buildOrderBody = (input: {
  orderId: string;
  amount: number;
  currency: string;
  bookingId: string;
  ownerId: string | null;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  description?: string;
  returnUrl?: string;
  notifyUrl?: string;
}) => {
  const body: Record<string, unknown> = {
    order_id: input.orderId,
    order_amount: input.amount,
    order_currency: input.currency,
    customer_details: {
      customer_id: input.customerId || input.bookingId,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
    },
    order_note: input.description || 'Room booking payment',
    order_tags: {
      booking_id: input.bookingId,
      owner_id: input.ownerId || null,
      customer_id: input.customerId || null,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
    },
  };
  const orderMeta: Record<string, string> = {};
  if (input.returnUrl) orderMeta.return_url = input.returnUrl;
  if (input.notifyUrl) orderMeta.notify_url = input.notifyUrl;
  if (Object.keys(orderMeta).length > 0) {
    body.order_meta = orderMeta;
  }
  body.order_expiry_time = buildGatewayOrderExpiryTime();
  return body;
};

const createOrder = async (supabase: any, cashfree: any, orderBody: Record<string, unknown>, input: {
  paymentId: string;
  bookingId: string;
  orderId: string;
  idempotencyKey: string;
}) => {
  const orderRes = await fetch(`${cashfree.baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': cashfree.clientId,
      'x-client-secret': cashfree.clientSecret,
      'x-api-version': cashfree.apiVersion,
      'x-idempotency-key': input.idempotencyKey,
    },
    body: JSON.stringify(orderBody),
  });

  const orderData = await orderRes.json().catch(() => ({}));
  if (!orderRes.ok) {
    await supabase.from('payment_attempts').insert({
      payment_id: input.paymentId,
      booking_id: input.bookingId,
      status: 'failed',
      provider: 'cashfree',
      provider_order_id: input.orderId,
      idempotency_key: input.idempotencyKey,
      failure_reason: orderData?.message || orderData?.error || 'Order creation failed',
      raw_payload: orderData,
    });
    throw new Error(orderData?.message || orderData?.error || 'Cashfree order creation failed');
  }

  const paymentSessionId = orderData?.payment_session_id;
  if (!paymentSessionId) throw new Error('Missing payment_session_id from Cashfree');
  return { orderData, paymentSessionId };
};

Deno.serve(async (req: Request) => {
  let supabaseClient: ReturnType<typeof getSupabaseClient> | null = null;
  let pendingPaymentForFailure: Record<string, unknown> | null = null;
  let failedBookingId = '';
  if (req.method === 'OPTIONS') return handleCorsPreflight(req);
  if (!assertAllowedOrigin(req)) return json(req, { success: false, error: 'Origin is not allowed' }, 403);
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const logMeta: { appType: string; bookingId?: string; txnId?: string; gateway: string } = {
    appType: 'unknown',
    bookingId: undefined,
    txnId: undefined,
    gateway: 'cashfree',
  };

  try {
    // 1) Authenticate user (or validate fallback identity) and parse payload.
    const supabase = getSupabaseClient();
    supabaseClient = supabase;
    const {
      payload,
      bookingId,
      amount,
      customerName,
      customerEmail,
      customerPhone,
      upiMethod,
      card,
      idempotencyKey: providedIdem,
      paymentType,
      description,
      metadata,
      returnBaseUrl,
      appType,
      nativeApp,
    } = await parsePayload(req);

    // 2) Validate input, booking ownership, and trusted amount.
    logMeta.appType = appType || 'unknown';
    logMeta.bookingId = bookingId;
    failedBookingId = bookingId;

    assertValidPaymentShell({ bookingId, amount, appType });

    const booking = await fetchBooking(supabase, bookingId);
    const authenticatedUser = await getAuthenticatedUser(req);
    const requesterId = authenticatedUser.id;
    const customerProfile = await fetchCustomerProfile(supabase, booking.customer_id || requesterId);
    const resolvedCustomer = resolveCashfreeCustomerDetails({
      booking,
      profile: customerProfile,
      authenticatedUser,
      payloadName: customerName,
      payloadEmail: customerEmail,
      payloadPhone: customerPhone,
    });
    assertValidPayload({
      bookingId,
      amount,
      customerName: resolvedCustomer.customerName,
      customerEmail: resolvedCustomer.customerEmail,
      customerPhone: resolvedCustomer.customerPhone,
      appType,
    });
    const clientIp = getClientIp(req);
    const createOrderIpLimit = await enforceRateLimit(
      buildRateLimitKey("cashfree-create-order-ip", clientIp, bookingId),
      10,
      10,
    );
    if (!createOrderIpLimit.allowed) {
      return json(req, {
        success: false,
        error: 'Too many payment attempts from this network. Please wait a few seconds and try again.',
      }, 429);
    }
    const createOrderLimit = await enforceRateLimit(
      buildRateLimitKey("cashfree-create-order", requesterId, clientIp),
      10,
      10,
    );
    if (!createOrderLimit.allowed) {
      return json(req, {
        success: false,
        error: 'Too many payment attempts. Please wait a few seconds and try again.',
      }, 429);
    }
    if (booking.customer_id !== requesterId && booking.owner_id !== requesterId) {
      throw new Error('Unauthorized booking access');
    }
      const normalizedPaymentType = String(paymentType || '').toLowerCase();
      const isMonthlyPayment = normalizedPaymentType === 'monthly' || normalizedPaymentType === 'rent';
      const trustedMetadata = normalizeMetadata(metadata);

      const expectedAmount = isMonthlyPayment
        ? resolveMonthlyAmount(booking)
        : resolveAdvanceAmount(booking);
      if (expectedAmount === null) {
        throw new Error(
          isMonthlyPayment
            ? 'Booking has no server-trusted monthly rent configured'
            : 'Booking has no server-trusted advance amount configured',
        );
      }

      assertAmountMatches(expectedAmount, amount);
      if (isMonthlyPayment) {
        const rentCycle = await fetchBookingRentCycle(supabase, bookingId);
        const cycleMonth = assertMonthlyRentAllowed(rentCycle, trustedMetadata);
        if (cycleMonth) {
          trustedMetadata.month = cycleMonth;
        }
      } else {
        assertBookingUnpaid(booking);
      }

      const trustedAmount = expectedAmount;

    // 3) Create Cashfree order + session using server-trusted amount.
    const cashfree = getCashfreeConfig();
    const orderId = `RFR_${String(bookingId).replaceAll('-', '').slice(0, 12)}_${Date.now()}`;
    let idempotencyKey = providedIdem || buildDefaultIdempotencyKey(
      bookingId,
      paymentType,
      trustedAmount,
      trustedMetadata,
    );

    const existingPayment = await findExistingPayment(supabase, idempotencyKey);
    if (existingPayment) {
      const existingStatus = lower(existingPayment.status || '');
      if (isRetryableFailureStatus(existingStatus)) {
        idempotencyKey = `${buildDefaultIdempotencyKey(
          bookingId,
          paymentType,
          trustedAmount,
          trustedMetadata,
        )}_${Date.now()}`;
      }
      if (isPaymentSuccessStatus(existingStatus)) {
        const paymentUpdate = {
          status: 'completed',
          verified_at: new Date().toISOString(),
        };
        await updatePaymentWithCompatibility(supabase, existingPayment.id, paymentUpdate);
        await markBookingPaid(supabase, bookingId, { ...existingPayment, ...paymentUpdate });
        return json(req, {
          success: true,
          already_paid: true,
          order_id: existingPayment.provider_order_id,
          payment_session_id: existingPayment.provider_session_id,
        });
      }

      if (existingPayment.provider_order_id) {
        const orderCheck = await fetchCashfreeOrderStatus(cashfree, existingPayment.provider_order_id);
        if (orderCheck.ok && isOrderPaidStatus(orderCheck.status)) {
          const providerPaymentId = await fetchCashfreeOrderPaymentId(cashfree, existingPayment.provider_order_id);
          const paymentUpdate = {
            status: 'completed',
            provider_payment_id: providerPaymentId || existingPayment.provider_payment_id,
            verified_at: new Date().toISOString(),
          };
          await updatePaymentWithCompatibility(supabase, existingPayment.id, paymentUpdate);
          await markBookingPaid(supabase, bookingId, { ...existingPayment, ...paymentUpdate });
          return json(req, {
            success: true,
            already_paid: true,
            order_id: existingPayment.provider_order_id,
            payment_session_id: existingPayment.provider_session_id,
          });
        }

        if (
          orderCheck.ok &&
          !isOrderClosingStatus(orderCheck.status) &&
          !isOrderFailedStatus(orderCheck.status) &&
          existingPayment.provider_session_id &&
          !isFinalPaymentStatus(existingStatus)
        ) {
          return json(req, {
            success: true,
            reused_existing: true,
            order_id: existingPayment.provider_order_id,
            payment_session_id: existingPayment.provider_session_id,
            order_expiry_time: resolveReturnedOrderExpiryTime(
              normalizeMetadata(existingPayment.metadata).order_expiry_time,
            ),
          });
        }

        if (orderCheck.ok && isOrderFailedStatus(orderCheck.status)) {
          const paymentUpdate = {
            status: 'failed',
            failure_reason: `Order ${orderCheck.status}`,
            verified_at: new Date().toISOString(),
          };
          await updatePaymentWithCompatibility(supabase, existingPayment.id, paymentUpdate);
          await markBookingFailed(supabase, bookingId, { ...existingPayment, ...paymentUpdate });
          idempotencyKey = `${buildDefaultIdempotencyKey(
            bookingId,
            paymentType,
            trustedAmount,
            trustedMetadata,
          )}_${Date.now()}`;
        }
      }
    }

    const retryCleanup = await deactivateBookingPaymentsForRetry(supabase, {
      bookingId,
      paymentType,
      metadata: trustedMetadata,
      reason: 'Superseded by fresh payment retry',
    });
    if (retryCleanup.alreadyPaid) {
      return json(req, {
        success: true,
        already_paid: true,
        booking_id: retryCleanup.bookingId,
      });
    }
    if (retryCleanup.count > 0) {
      idempotencyKey = `${buildDefaultIdempotencyKey(
        bookingId,
        paymentType,
        trustedAmount,
        trustedMetadata,
      )}_${Date.now()}`;
    }

    const payment = await insertPayment(supabase, {
      bookingId,
      booking,
      amount: trustedAmount,
      card,
      upiMethod,
      idempotencyKey,
      orderId,
      paymentType,
      metadata: trustedMetadata,
      customerName: resolvedCustomer.customerName,
      customerEmail: resolvedCustomer.customerEmail,
      customerPhone: resolvedCustomer.customerPhone,
    });
    pendingPaymentForFailure = payment;

    const returnUrl = await buildReturnUrl(
      req,
      appType,
      bookingId,
      orderId,
      returnBaseUrl,
      paymentType,
      trustedMetadata,
      nativeApp,
    );
    const notifyUrl = buildWebhookUrl();
    const normalizedPhone = resolvedCustomer.customerPhone;

    const orderBody = buildOrderBody({
      orderId,
      amount: trustedAmount,
      currency: booking.currency || 'INR',
      bookingId,
      ownerId: booking.owner_id || null,
      customerId: booking.customer_id || null,
      customerName: resolvedCustomer.customerName,
      customerEmail: resolvedCustomer.customerEmail,
      customerPhone: normalizedPhone,
      description,
      returnUrl,
      notifyUrl,
    });

    const { orderData, paymentSessionId } = await createOrder(supabase, cashfree, orderBody, {
      paymentId: payment.id,
      bookingId,
      orderId,
      idempotencyKey,
    });

    // 4) Persist hosted checkout session and return JSON. Cashfree checkout SDK
    // will handle payment method selection client-side using the session id.
    await supabase.from('payment_attempts').insert({
      payment_id: payment.id,
      booking_id: bookingId,
      status: 'initiated',
      provider: 'cashfree',
      provider_order_id: orderId,
      provider_session_id: paymentSessionId,
      idempotency_key: idempotencyKey,
      upi_app: mapUpiProvider(upiMethod),
      raw_payload: orderData,
    });

    const resolvedOrderExpiryTime = resolveReturnedOrderExpiryTime(orderData?.order_expiry_time);

    await updatePaymentWithCompatibility(supabase, payment.id, {
      provider_order_id: orderId,
      provider_session_id: paymentSessionId,
      provider_reference: orderData?.cf_order_id || orderData?.order_token || null,
      payment_method: card ? 'card' : 'upi',
      status: 'pending',
      metadata: {
        upi_method: upiMethod || null,
        client_context: Object.keys(trustedMetadata).length > 0 ? trustedMetadata : null,
        customer_name: resolvedCustomer.customerName,
        customer_email: resolvedCustomer.customerEmail,
        customer_phone: normalizedPhone,
        order_expiry_time: resolvedOrderExpiryTime,
        payment_url: null,
        action: null,
      }
    });

    const bookingUpdate: Record<string, unknown> = {
      status: isMonthlyPayment ? booking.status : 'payment_pending',
      payment_provider: 'cashfree',
      payment_method: card ? 'card' : 'upi',
      amount_due: trustedAmount,
    };

    if (isMonthlyPayment) {
      bookingUpdate.rent_payment_status = 'pending';
    } else {
      bookingUpdate.payment_id = payment.id;
      bookingUpdate.payment_status = 'pending';
    }

    await updateBookingWithCompatibility(supabase, bookingId, bookingUpdate);

    logMeta.txnId = payment.id;

    return json(req, {
      success: true,
      order_id: orderId,
      payment_session_id: paymentSessionId,
      order_expiry_time: resolvedOrderExpiryTime,
    });
  } catch (error: any) {
    if (supabaseClient && failedBookingId && pendingPaymentForFailure?.id) {
      const failureReason = String(error?.message || 'Failed to create order').trim() || 'Failed to create order';
      const paymentUpdate = {
        status: 'failed',
        failure_reason: failureReason,
        verified_at: new Date().toISOString(),
      };

      try {
        await updatePaymentWithCompatibility(
          supabaseClient,
          String(pendingPaymentForFailure.id),
          paymentUpdate,
        );
        await markBookingFailed(supabaseClient, failedBookingId, {
          ...pendingPaymentForFailure,
          ...paymentUpdate,
        });
      } catch (markFailureError) {
        console.error('[cashfree-create-order] Failed to persist order-creation failure:', markFailureError);
      }
    }

    const message = error?.message || error;
    if (String(message).toLowerCase().includes('unauthorized')) {
      return json(req, { success: false, error: 'Unauthorized' }, 401);
    }
    return json(req, { success: false, error: error?.message || 'Failed to create order' }, 400);
  }
});
