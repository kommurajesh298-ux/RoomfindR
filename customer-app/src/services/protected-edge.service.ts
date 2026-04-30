import { supabaseAnonKey, supabaseUrl } from "./supabase-config";
import { authService } from "./auth.service";

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

  try {
    const session = await authService.getCurrentSession();
    accessToken = session?.access_token || "";

    const payload = accessToken ? decodeJwtPayload(accessToken) : null;
    const expiresAt = payload?.exp ? payload.exp * 1000 : 0;
    const expiresSoon = !expiresAt || expiresAt - Date.now() < minValidityMs;

    if (!accessToken || expiresSoon) {
      const refreshedSession = await authService.refreshCurrentSession();
      accessToken = refreshedSession?.access_token || "";
    }
  } catch (error) {
    if (await authService.recoverInvalidStoredSession(error)) {
      throw new Error("Please sign in again to continue.");
    }
    throw error;
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
    keepalive?: boolean;
  },
): Promise<ProtectedEdgeResult<T>> => {
  ensureFunctionConfig();

  let accessToken =
    options?.accessToken || (await getFreshAccessToken(options?.minValidityMs));

  const doRequest = async (token: string) => {
    const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: buildProtectedHeaders(token),
      body: JSON.stringify(body),
      ...(options?.keepalive ? { keepalive: true } : {}),
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

  return result;
};

export const invokeProtectedEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
  options?: {
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
