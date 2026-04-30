import { authService } from "./auth.service";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

type EdgeErrorPayload = {
  error?: {
    message?: string;
    code?: string;
  } | string;
  message?: string;
};

const decodeJwtPayload = (token: string): { exp?: number } | null => {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const json = globalThis.atob(normalized);
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
};

const ensureFunctionConfig = () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase configuration.");
  }
};

const readStoredAccessToken = (): string => {
  if (typeof window === "undefined") return "";

  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.includes("auth-token")) continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw) as {
        access_token?: string;
        currentSession?: { access_token?: string };
      };

      const token =
        String(parsed?.access_token || "").trim() ||
        String(parsed?.currentSession?.access_token || "").trim();

      if (token) {
        return token;
      }
    }
  } catch {
    // Ignore malformed storage and fall through to the normal auth client path.
  }

  return "";
};

const buildProtectedHeaders = (accessToken: string) => {
  ensureFunctionConfig();
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("apikey", supabaseAnonKey || "");
  headers.set("Authorization", `Bearer ${supabaseAnonKey || ""}`);
  headers.set("x-supabase-auth", `Bearer ${accessToken}`);
  headers.set("Cache-Control", "no-cache");
  headers.set("Pragma", "no-cache");
  return headers;
};

export const extractEdgeErrorMessage = (
  payload: unknown,
  fallback: string,
): string => {
  const body = (payload || {}) as EdgeErrorPayload;
  const errorObject =
    typeof body.error === "object" && body.error !== null ? body.error : null;

  if (typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }
  if (
    typeof errorObject?.message === "string" &&
    errorObject.message.trim()
  ) {
    return errorObject.message;
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  return fallback;
};

const getFreshAccessToken = async (minValidityMs = 60_000): Promise<string> => {
  ensureFunctionConfig();

  let accessToken = "";

  try {
    const session = await authService.getCurrentSession();
    accessToken = session?.access_token || readStoredAccessToken();

    const payload = accessToken ? decodeJwtPayload(accessToken) : null;
    const expiresAt = payload?.exp ? payload.exp * 1000 : 0;
    const expiresSoon = !expiresAt || expiresAt - Date.now() < minValidityMs;

    if (!accessToken || expiresSoon) {
      const refreshed = await authService.refreshCurrentSession();
      accessToken =
        refreshed?.access_token ||
        accessToken ||
        readStoredAccessToken();
    }
  } catch (error) {
    if (await authService.recoverInvalidStoredSession(error)) {
      throw new Error("Please sign in again to continue.");
    }
    throw error;
  }

  if (!accessToken) {
    accessToken = readStoredAccessToken();
  }

  if (!accessToken) {
    throw new Error("Please sign in again to continue.");
  }

  return accessToken;
};

export const invokeProtectedEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<T> => {
  ensureFunctionConfig();
  let accessToken = await getFreshAccessToken();

  const doRequest = async (token: string) => {
    const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: buildProtectedHeaders(token),
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as T;
    return { response, payload };
  };

  let result = await doRequest(accessToken);
  if (result.response.status === 401) {
    const refreshedToken = await getFreshAccessToken(0);
    if (refreshedToken && refreshedToken !== accessToken) {
      accessToken = refreshedToken;
      result = await doRequest(accessToken);
    }
  }

  if (!result.response.ok) {
    throw new Error(extractEdgeErrorMessage(result.payload, fallbackMessage));
  }

  return result.payload;
};
