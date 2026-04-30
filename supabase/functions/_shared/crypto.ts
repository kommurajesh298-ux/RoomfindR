const encoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const bytesToBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
};

export const hmacSha256Hex = async (
  secret: string,
  value: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
};

export const hmacSha256Base64 = async (
  secret: string,
  value: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64(new Uint8Array(signature));
};

export const constantTimeEqual = (a: string, b: string): boolean => {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left.length !== right.length) return false;

  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
};

export const verifyCashfreeSignature = async (input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  maxAgeSeconds?: number;
}) => {
  if (!input.signature || !input.timestamp || !input.secret) return false;

  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;

  const maxAgeMs = (input.maxAgeSeconds || 600) * 1000;
  const isStale = Math.abs(Date.now() - ts * 1000) > maxAgeMs;
  if (isStale) return false;

  const signedPayload = `${input.timestamp}${input.rawBody}`;
  const expectedHex = await hmacSha256Hex(input.secret, signedPayload);
  const expectedBase64 = await hmacSha256Base64(input.secret, signedPayload);
  return (
    constantTimeEqual(expectedHex, input.signature) ||
    constantTimeEqual(expectedBase64, input.signature)
  );
};

const deriveEncryptionKey = async (secret: string): Promise<CryptoKey> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
};

export const encryptSensitiveValue = async (
  value: string,
  secret: string,
): Promise<string> => {
  const key = await deriveEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );

  const ivPart = bytesToBase64(iv);
  const cipherPart = bytesToBase64(new Uint8Array(encrypted));
  return `${ivPart}.${cipherPart}`;
};

export const decryptSensitiveValue = async (
  value: string,
  secret: string,
): Promise<string> => {
  const [ivPart, cipherPart] = String(value || "").split(".");
  if (!ivPart || !cipherPart) {
    throw new Error("Invalid encrypted value");
  }

  const key = await deriveEncryptionKey(secret);
  const iv = Uint8Array.from(atob(ivPart), (char) => char.charCodeAt(0));
  const cipherBytes = Uint8Array.from(atob(cipherPart), (char) => char.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipherBytes,
  );

  return new TextDecoder().decode(decrypted);
};

export const maskAccountNumber = (accountNumber: string): string => {
  const digits = accountNumber.replace(/\D/g, "");
  if (!digits) return "XXXX";
  const last4 = digits.slice(-4).padStart(4, "X");
  return `XXXX${last4}`;
};
