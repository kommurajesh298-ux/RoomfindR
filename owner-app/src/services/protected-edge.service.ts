import { supabase } from "./supabase-config";
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

type ProtectedEdgeResult<T> = {
  response: Response;
  payload: T;
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

export const getFreshAccessToken = async (
  minValidityMs = 60_000,
): Promise<string> => {
  ensureFunctionConfig();

  let accessToken = "";
  let expiresAt = 0;

  try {
    const session = await supabase.auth.getSession();
    accessToken = session.data.session?.access_token || readStoredAccessToken();

    const payload = accessToken ? decodeJwtPayload(accessToken) : null;
    expiresAt = payload?.exp ? payload.exp * 1000 : 0;
    const expiresSoon = !expiresAt || expiresAt - Date.now() < minValidityMs;

    if (!accessToken || expiresSoon) {
      const refreshed = await supabase.auth.refreshSession();
      accessToken =
        refreshed.data.session?.access_token ||
        accessToken ||
        readStoredAccessToken();
    }
  } catch (error) {
    if (await authService.recoverInvalidStoredSession(error)) {
      if (accessToken && expiresAt > Date.now() + 5_000) {
        return accessToken;
      }
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

export const postProtectedEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown>,
  options?: {
    accessToken?: string;
    minValidityMs?: number;
  },
): Promise<ProtectedEdgeResult<T>> => {
  ensureFunctionConfig();

  let accessToken =
    options?.accessToken || (await getFreshAccessToken(options?.minValidityMs));

  const doRequest = async (token: string) => {
    let response: Response;

    try {
      response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: "POST",
        headers: buildProtectedHeaders(token),
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (/failed to fetch/i.test(message)) {
        throw new Error("Unable to reach the secure refund service. Please try again in a moment.");
      }
      throw error;
    }

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

  return result;
};

export const invokeProtectedEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
  options?: {
    accessToken?: string;
    minValidityMs?: number;
  },
): Promise<T> => {
  const { response, payload } = await postProtectedEdgeFunction<T>(
    name,
    body,
    options,
  );

  if (!response.ok) {
    throw new Error(extractEdgeErrorMessage(payload, fallbackMessage));
  }

  return payload;
};
