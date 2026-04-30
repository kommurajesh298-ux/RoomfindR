const DEFAULT_ALLOWED_ORIGINS = [
  "https://rkabjhgdmluacqjdtjwi.supabase.co",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
];

const normalizeOrigin = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
};

const getConfiguredOrigins = (): string[] => {
  const keys = [
    "PAYMENT_RETURN_BASE_URL",
    "CUSTOMER_PAYMENT_RETURN_BASE_URL",
    "OWNER_PAYMENT_RETURN_BASE_URL",
    "ADMIN_PAYMENT_RETURN_BASE_URL",
    "APP_URL",
    "SITE_URL",
    "CUSTOMER_APP_URL",
    "OWNER_APP_URL",
    "ADMIN_APP_URL",
  ];

  return keys
    .map((key) => normalizeOrigin(Deno.env.get(key) ?? ""))
    .filter((value) => value.length > 0);
};

const parseAllowedOrigins = (): Set<string> => {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  if (!raw.trim()) {
    return new Set([
      ...DEFAULT_ALLOWED_ORIGINS,
      ...getConfiguredOrigins(),
    ]);
  }

  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...getConfiguredOrigins(),
    ...raw
      .split(",")
      .map((value) => normalizeOrigin(value))
      .filter((value) => value.length > 0),
  ]);
};

const allowedOrigins = parseAllowedOrigins();

export type CorsResolution = {
  allowed: boolean;
  headers: Record<string, string>;
};

export const resolveCors = (origin: string | null): CorsResolution => {
  const allowed = !origin || allowedOrigins.has(origin);

  const allowOrigin = !origin ? "*" : allowed ? origin : "null";

  return {
    allowed,
    headers: {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Headers":
        "authorization, x-supabase-auth, x-client-info, apikey, content-type, cache-control, pragma",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
};
