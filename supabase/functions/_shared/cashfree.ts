const getRequiredEnv = (key: string): string => {
  const value = (Deno.env.get(key) || "").trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const getFirstAvailableEnv = (...keys: string[]): string => {
  for (const key of keys) {
    const value = (Deno.env.get(key) || "").trim();
    if (value) return value;
  }

  throw new Error(`Missing one of: ${keys.join(", ")}`);
};

const pemToArrayBuffer = (pemValue: string): ArrayBuffer => {
  const normalized = pemValue
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const buildPayoutSignature = async (
  clientId: string,
  publicKeyPem: string,
): Promise<string> => {
  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(publicKeyPem),
    {
      name: "RSA-OAEP",
      hash: "SHA-1",
    },
    false,
    ["encrypt"],
  );

  const timestamp = Math.floor(Date.now() / 1000);
  const encoded = new TextEncoder().encode(`${clientId}.${timestamp}`);
  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    cryptoKey,
    encoded,
  );

  return toBase64(encrypted);
};

const getPgConfig = () => {
  const env = (Deno.env.get("CASHFREE_ENV") || "TEST").toUpperCase();
  const isProd = env === "PROD" || env === "PRODUCTION";

  return {
    baseUrl: isProd
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg",
    clientId: getRequiredEnv("CASHFREE_CLIENT_ID"),
    clientSecret: getRequiredEnv("CASHFREE_CLIENT_SECRET"),
    apiVersion: (Deno.env.get("CASHFREE_API_VERSION") || "2025-01-01").trim(),
  };
};

const getPayoutConfig = () => {
  const rawEnv = (
    Deno.env.get("CASHFREE_PAYOUT_ENV") ||
    Deno.env.get("CASHFREE_ENV") ||
    "TEST"
  ).trim().toUpperCase();
  const env = rawEnv || "TEST";
  if (!["TEST", "SANDBOX", "PROD", "PRODUCTION"].includes(env)) {
    throw new Error(
      "Invalid payout environment. Use CASHFREE_PAYOUT_ENV or CASHFREE_ENV with TEST or PROD.",
    );
  }
  const isProd = env === "PROD" || env === "PRODUCTION";

  return {
    baseUrl: isProd
      ? "https://api.cashfree.com/payout"
      : "https://sandbox.cashfree.com/payout",
    clientId: getFirstAvailableEnv(
      "CASHFREE_PAYOUT_CLIENT_ID",
      "CASHFREE_CLIENT_ID",
    ),
    clientSecret: getFirstAvailableEnv(
      "CASHFREE_PAYOUT_CLIENT_SECRET",
      "CASHFREE_PAYOUT_SECRET",
      "CASHFREE_CLIENT_SECRET",
    ),
    apiVersion: (
      Deno.env.get("CASHFREE_PAYOUT_API_VERSION") ||
      Deno.env.get("CASHFREE_API_VERSION") ||
      "2025-01-01"
    ).trim(),
    publicKeyPem: (
      Deno.env.get("CASHFREE_PAYOUT_PUBLIC_KEY_PEM") ||
      Deno.env.get("CASHFREE_PAYOUT_PUBLIC_KEY") ||
      ""
    ).trim(),
  };
};

const parseJson = async (res: Response) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const sanitizeCashfreeBeneficiaryName = (value: string): string => {
  const sanitized = String(value || "")
    .replace(/[^a-zA-Z0-9\s.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  if (!sanitized) {
    return "RoomFindR Owner";
  }

  return sanitized;
};

const requestCashfree = async (
  url: string,
  headers: Record<string, string>,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
) => {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await parseJson(res);
  if (!res.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      payload?.error_description ||
      `Cashfree request failed (${res.status})`;
    throw new Error(String(message));
  }

  return payload;
};

const buildCashfreeSignedHeaders = async (input: {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  publicKeyPem?: string;
}) => {
  const headers: Record<string, string> = {
    "x-client-id": input.clientId,
    "x-client-secret": input.clientSecret,
    "x-api-version": input.apiVersion,
  };

  if (input.publicKeyPem) {
    headers["x-cf-signature"] = await buildPayoutSignature(
      input.clientId,
      input.publicKeyPem,
    );
  }

  return headers;
};

export const createCashfreePgOrder = async (input: {
  orderId: string;
  orderAmount: number;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
  notifyUrl?: string;
  orderNote?: string;
  orderTags?: Record<string, unknown>;
}) => {
  const config = getPgConfig();

  const payload = {
    order_id: input.orderId,
    order_amount: Number(input.orderAmount.toFixed(2)),
    order_currency: "INR",
    customer_details: {
      customer_id: input.customerId,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
    },
    order_meta: {
      return_url: input.returnUrl,
      notify_url: input.notifyUrl,
    },
    order_note: input.orderNote || "RoomFindR payment",
    order_tags: input.orderTags || {},
  };

  return requestCashfree(
    `${config.baseUrl}/orders`,
    {
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": config.apiVersion,
    },
    "POST",
    payload,
  );
};

export const fetchCashfreePgOrder = async (orderId: string) => {
  const config = getPgConfig();
  return requestCashfree(
    `${config.baseUrl}/orders/${orderId}`,
    {
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": config.apiVersion,
    },
    "GET",
  );
};

export const terminateCashfreePgOrder = async (
  orderId: string,
  options?: { idempotencyKey?: string },
) => {
  const config = getPgConfig();
  const headers: Record<string, string> = {
    "x-client-id": config.clientId,
    "x-client-secret": config.clientSecret,
    "x-api-version": config.apiVersion,
  };

  if (options?.idempotencyKey) {
    headers["x-idempotency-key"] = options.idempotencyKey;
  }

  return requestCashfree(
    `${config.baseUrl}/orders/${orderId}`,
    headers,
    "PATCH",
    {
      order_status: "TERMINATED",
    },
  );
};

export const fetchCashfreePgOrderPayments = async (orderId: string) => {
  const config = getPgConfig();
  return requestCashfree(
    `${config.baseUrl}/orders/${orderId}/payments`,
    {
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": config.apiVersion,
    },
    "GET",
  );
};

export const fetchCashfreeRefund = async (orderId: string, refundId: string) => {
  const config = getPgConfig();
  return requestCashfree(
    `${config.baseUrl}/orders/${orderId}/refunds/${refundId}`,
    {
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": config.apiVersion,
    },
    "GET",
  );
};

export const createCashfreeBeneficiary = async (input: {
  beneId: string;
  name: string;
  email: string;
  phone: string;
  bankAccount: string;
  ifsc: string;
}) => {
  const config = getPayoutConfig();
  const payoutHeaders = await buildCashfreeSignedHeaders(config);

  return requestCashfree(
    `${config.baseUrl}/beneficiary`,
    payoutHeaders,
    "POST",
    {
      beneficiary_id: input.beneId,
      beneficiary_name: sanitizeCashfreeBeneficiaryName(input.name),
      beneficiary_instrument_details: {
        bank_account_number: input.bankAccount,
        bank_ifsc: input.ifsc,
      },
      beneficiary_contact_details: {
        beneficiary_email: input.email,
        beneficiary_phone: input.phone,
        beneficiary_country_code: "+91",
      },
    },
  );
};

export const fetchCashfreeBeneficiary = async (input: {
  beneficiaryId?: string;
  bankAccount?: string;
  ifsc?: string;
}) => {
  const config = getPayoutConfig();
  const payoutHeaders = await buildCashfreeSignedHeaders(config);

  const query = new URLSearchParams();
  if (input.beneficiaryId) {
    query.set("beneficiary_id", input.beneficiaryId);
  }
  if (input.bankAccount && input.ifsc) {
    query.set("bank_account_number", input.bankAccount);
    query.set("bank_ifsc", input.ifsc);
  }

  return requestCashfree(
    `${config.baseUrl}/beneficiary?${query.toString()}`,
    payoutHeaders,
    "GET",
  );
};

export const createCashfreeTransfer = async (input: {
  transferId: string;
  beneId: string;
  amount: number;
  remarks?: string;
  transferMode?: "banktransfer" | "upi";
}) => {
  const config = getPayoutConfig();
  const payoutHeaders = await buildCashfreeSignedHeaders(config);

  return requestCashfree(
    `${config.baseUrl}/transfers`,
    payoutHeaders,
    "POST",
    {
      transfer_id: input.transferId,
      transfer_amount: Number(input.amount.toFixed(2)),
      beneficiary_details: {
        beneficiary_id: input.beneId,
      },
      transfer_mode: input.transferMode || "banktransfer",
      transfer_remarks: input.remarks || undefined,
    },
  );
};

export const fetchCashfreeTransfer = async (transferId: string) => {
  const config = getPayoutConfig();
  const payoutHeaders = await buildCashfreeSignedHeaders(config);

  return requestCashfree(
    `${config.baseUrl}/transfers?transfer_id=${encodeURIComponent(transferId)}`,
    payoutHeaders,
    "GET",
  );
};
