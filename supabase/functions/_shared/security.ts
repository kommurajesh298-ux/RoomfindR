const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_REGEX = /^\d{6}$/;
const MONTH_TOKEN_REGEX = /^\d{4}-\d{2}$/;

export const normalizeEmail = (value: string): string =>
  value.trim().toLowerCase();

export const normalizePhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  const tenDigits = digits.length > 10 ? digits.slice(-10) : digits;
  return tenDigits.length === 10 ? `+91${tenDigits}` : "";
};

export const validateEmail = (value: string): boolean =>
  EMAIL_REGEX.test(value);

export const validateOtp = (value: string): boolean => OTP_REGEX.test(value);

export const validatePassword = (value: string): boolean => {
  if (value.length < 8) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/\d/.test(value)) return false;
  return true;
};

export const generateSixDigitOtp = (): string => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String(buffer[0] % 1_000_000).padStart(6, "0");
};

export const sha256Hex = async (value: string): Promise<string> => {
  const payload = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const normalizePaymentStatusApp = (value: string): "customer" | "owner" | "admin" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "owner" || normalized === "admin") return normalized;
  return "customer";
};

const normalizePaymentStatusType = (value: string): "booking" | "monthly" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "monthly" || normalized === "rent") return "monthly";
  return "booking";
};

const normalizePaymentStatusMonth = (value: string | null | undefined): string | undefined => {
  const normalized = String(value || "").trim();
  return MONTH_TOKEN_REGEX.test(normalized) ? normalized : undefined;
};

const getPaymentStatusTokenSecret = (): string => {
  const secret = String(
    Deno.env.get("PAYMENT_STATUS_TOKEN_SECRET") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      "",
  ).trim();

  if (!secret) {
    throw new Error("Missing PAYMENT_STATUS_TOKEN_SECRET");
  }

  return secret;
};

const toBase64Url = (value: string | Uint8Array): string => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll(/=+$/g, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = String(value || "")
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= (left.codePointAt(index) ?? 0) ^ (right.codePointAt(index) ?? 0);
  }

  return mismatch === 0;
};

const hmacSha256Base64Url = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toBase64Url(new Uint8Array(signature));
};

type PaymentStatusTokenPayload = {
  bookingId?: string;
  orderId?: string;
  app: "customer" | "owner" | "admin";
  paymentType: "booking" | "monthly";
  month?: string;
  exp: number;
};

type PaymentStatusTokenWirePayload = {
  b?: string;
  o?: string;
  a?: string;
  t?: string;
  m?: string;
  e?: number;
  bookingId?: string;
  orderId?: string;
  app?: string;
  paymentType?: string;
  month?: string;
  exp?: number;
};

const encodePaymentStatusApp = (value: PaymentStatusTokenPayload["app"]): string => {
  if (value === "owner") return "o";
  if (value === "admin") return "a";
  return "c";
};

const decodePaymentStatusApp = (value: string): PaymentStatusTokenPayload["app"] => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "o" || normalized === "owner") return "owner";
  if (normalized === "a" || normalized === "admin") return "admin";
  return "customer";
};

const encodePaymentStatusType = (value: PaymentStatusTokenPayload["paymentType"]): string =>
  value === "monthly" ? "m" : "b";

const decodePaymentStatusType = (value: string): PaymentStatusTokenPayload["paymentType"] => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "m" || normalized === "monthly" || normalized === "rent") return "monthly";
  return "booking";
};

const parsePaymentStatusToken = (token: string): {
  payloadSegment: string;
  signatureSegment: string;
  payload: PaymentStatusTokenPayload;
} | null => {
  const [payloadSegment, signatureSegment] = String(token || "").trim().split(".");
  if (!payloadSegment || !signatureSegment) return null;

  try {
    const payloadJson = new TextDecoder().decode(fromBase64Url(payloadSegment));
    const payload = JSON.parse(payloadJson) as PaymentStatusTokenWirePayload;
    if (!payload || typeof payload !== "object") return null;
    const exp = Number(payload.e ?? payload.exp);
    if (!Number.isFinite(exp)) return null;

    return {
      payloadSegment,
      signatureSegment,
      payload: {
        bookingId: String(payload.b ?? payload.bookingId ?? "").trim() || undefined,
        orderId: String(payload.o ?? payload.orderId ?? "").trim() || undefined,
        app: decodePaymentStatusApp(String(payload.a ?? payload.app ?? "customer")),
        paymentType: decodePaymentStatusType(String(payload.t ?? payload.paymentType ?? "booking")),
        month: normalizePaymentStatusMonth(String(payload.m ?? payload.month ?? "")),
        exp,
      },
    };
  } catch {
    return null;
  }
};

export const signPaymentStatusToken = async (input: {
  bookingId?: string;
  orderId?: string;
  app: string;
  paymentType?: string;
  month?: string;
  expiresInSeconds?: number;
}): Promise<string> => {
  const payload: PaymentStatusTokenPayload = {
    bookingId: String(input.bookingId || "").trim() || undefined,
    orderId: String(input.orderId || "").trim() || undefined,
    app: normalizePaymentStatusApp(input.app),
    paymentType: normalizePaymentStatusType(input.paymentType || "booking"),
    month: normalizePaymentStatusMonth(input.month),
    exp: Math.floor(Date.now() / 1000) + Math.max(Number(input.expiresInSeconds || 900), 60),
  };

  const wirePayload: PaymentStatusTokenWirePayload = {
    b: payload.bookingId,
    o: payload.orderId,
    a: encodePaymentStatusApp(payload.app),
    t: encodePaymentStatusType(payload.paymentType),
    m: payload.month,
    e: payload.exp,
  };

  const payloadSegment = toBase64Url(JSON.stringify(wirePayload));
  const signatureSegment = await hmacSha256Base64Url(
    getPaymentStatusTokenSecret(),
    payloadSegment,
  );

  return `${payloadSegment}.${signatureSegment}`;
};

export const verifyPaymentStatusToken = async (
  token: string,
  expected: {
    bookingId?: string;
    orderId?: string;
    app: string;
    paymentType?: string;
    month?: string;
  },
): Promise<boolean> => {
  const parsed = parsePaymentStatusToken(token);
  if (!parsed) return false;

  const expectedSignature = await hmacSha256Base64Url(
    getPaymentStatusTokenSecret(),
    parsed.payloadSegment,
  );
  if (!timingSafeEqual(expectedSignature, parsed.signatureSegment)) {
    return false;
  }

  if (parsed.payload.exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expectedBookingId = String(expected.bookingId || "").trim();
  const expectedOrderId = String(expected.orderId || "").trim();
  const expectedApp = normalizePaymentStatusApp(expected.app);
  const expectedPaymentType = normalizePaymentStatusType(expected.paymentType || "booking");
  const expectedMonth = normalizePaymentStatusMonth(expected.month);

  if (expectedBookingId && parsed.payload.bookingId !== expectedBookingId) {
    return false;
  }
  if (expectedOrderId && parsed.payload.orderId !== expectedOrderId) {
    return false;
  }
  if (parsed.payload.app !== expectedApp) {
    return false;
  }
  if (parsed.payload.paymentType !== expectedPaymentType) {
    return false;
  }
  if ((parsed.payload.month || "") !== (expectedMonth || "")) {
    return false;
  }

  return true;
};

export const decodePaymentStatusToken = async (
  token: string,
): Promise<PaymentStatusTokenPayload | null> => {
  const parsed = parsePaymentStatusToken(token);
  if (!parsed) return null;

  const expectedSignature = await hmacSha256Base64Url(
    getPaymentStatusTokenSecret(),
    parsed.payloadSegment,
  );
  if (!timingSafeEqual(expectedSignature, parsed.signatureSegment)) {
    return null;
  }

  if (parsed.payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return parsed.payload;
};
