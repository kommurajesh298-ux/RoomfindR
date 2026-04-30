const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type InvoiceTokenPayload = {
  bookingId: string;
  invoiceNumber: string;
  iat: number;
  exp: number;
  nonce: string;
};

const toBase64Url = (input: Uint8Array | string): string => {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded =
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const decodeJson = <T>(value: string): T =>
  JSON.parse(decoder.decode(fromBase64Url(value))) as T;

const buildSigningSecret = (): string => {
  const secret =
    Deno.env.get("INVOICE_QR_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";

  if (!secret) {
    throw new Error("Missing invoice signing secret");
  }

  return secret;
};

let signingKeyPromise: Promise<CryptoKey> | null = null;

const getSigningKey = async (): Promise<CryptoKey> => {
  if (!signingKeyPromise) {
    signingKeyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(buildSigningSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  return signingKeyPromise;
};

export const buildInvoiceNumber = (bookingId: string): string =>
  `INV-${String(bookingId || "").slice(0, 8).toUpperCase()}`;

export const createInvoiceToken = async (
  payload: InvoiceTokenPayload,
): Promise<string> => {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "RFMINV" }));
  const body = toBase64Url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const key = await getSigningKey();
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)),
  );

  return `${signingInput}.${toBase64Url(signature)}`;
};

export const verifyInvoiceToken = async (
  token: string,
): Promise<InvoiceTokenPayload> => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid invoice token");
  }

  const [header, body, signature] = parts;
  const key = await getSigningKey();
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signature),
    encoder.encode(`${header}.${body}`),
  );

  if (!verified) {
    throw new Error("Invoice token verification failed");
  }

  const headerPayload = decodeJson<{ alg?: string; typ?: string }>(header);
  if (headerPayload.alg !== "HS256" || headerPayload.typ !== "RFMINV") {
    throw new Error("Invalid invoice token header");
  }

  const payload = decodeJson<InvoiceTokenPayload>(body);
  const now = Math.floor(Date.now() / 1000);

  if (!payload.bookingId || !payload.nonce) {
    throw new Error("Invalid invoice token payload");
  }

  if (payload.invoiceNumber !== buildInvoiceNumber(payload.bookingId)) {
    throw new Error("Invoice number mismatch");
  }

  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new Error("Invoice token expired");
  }

  return payload;
};
