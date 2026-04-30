// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { resolveCors } from "../_shared/cors.ts";

const encoder = new TextEncoder();

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type?: string | null;
  notification_type?: string | null;
  status?: string | null;
  data?: Record<string, unknown> | null;
};

type DeviceTokenRow = {
  id: string;
  token: string;
  app?: string | null;
  device_type?: string | null;
  platform?: string | null;
  sourceTable: "fcm_tokens" | "user_devices" | "device_tokens";
};

type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type FirebaseRuntimeState = {
  parsed: boolean;
  serviceAccount: FirebaseServiceAccount | null;
  projectId: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

const firebaseState: FirebaseRuntimeState =
  (globalThis as { __roomfindrFirebaseState?: FirebaseRuntimeState }).__roomfindrFirebaseState ??
  ((globalThis as { __roomfindrFirebaseState?: FirebaseRuntimeState }).__roomfindrFirebaseState = {
    parsed: false,
    serviceAccount: null,
    projectId: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
  });

const getEnv = (key: string) => Deno.env.get(key) ?? "";

const json = (body: unknown, status = 200, origin: string | null = null) => {
  const { headers } = resolveCors(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
};

const getSupabaseClient = () => {
  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("LOCAL_SUPABASE_URL");
  const supabaseServiceKey =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, supabaseServiceKey);
};

const lower = (value: unknown) => String(value || "").trim().toLowerCase();

const VALID_NOTIFICATION_TYPES = new Set([
  "payment_success",
  "booking_confirmed",
  "booking_rejected",
  "refund_initiated",
  "refund_completed",
  "settlement_completed",
]);

const isMissingTableError = (error: { code?: string; message?: string } | null | undefined, table: string) => {
  const message = String(error?.message || "");
  return error?.code === "PGRST205" || message.includes(`'public.${table}'`);
};

const normalizeData = (data: Record<string, unknown> | null | undefined) => {
  const output: Record<string, string> = {};
  if (!data) return output;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    output[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return output;
};

const deriveRoute = (notification: NotificationRow) => {
  const data = (notification.data as Record<string, unknown> | null | undefined) || {};
  const explicitRoute = String(data.route || "").trim();
  if (explicitRoute) return explicitRoute;

  const type = lower(notification.notification_type || notification.type);
  if (type.includes("message") || type.includes("chat")) return "/chat";
  if (type.includes("booking") || type.includes("payment") || type.includes("refund")) return "/bookings";
  return "/";
};

const normalizeNotificationType = (
  notificationType: unknown,
  fallbackType: unknown,
  data: Record<string, unknown> | null | undefined,
) => {
  const explicit = lower(notificationType);
  if (VALID_NOTIFICATION_TYPES.has(explicit)) return explicit;

  if (explicit) {
    if (explicit.includes("refund")) {
      return explicit.includes("complete") || explicit.includes("success")
        ? "refund_completed"
        : "refund_initiated";
    }

    if (explicit.includes("settlement")) {
      return "settlement_completed";
    }

    if (explicit.includes("payment")) {
      return "payment_success";
    }

    if (
      explicit.includes("reject") ||
      explicit.includes("cancel") ||
      explicit.includes("decline")
    ) {
      return "booking_rejected";
    }

    if (
      explicit.includes("booking") ||
      explicit.includes("vacate") ||
      explicit.includes("check") ||
      explicit.includes("reservation")
    ) {
      return "booking_confirmed";
    }
  }

  const fallback = lower(fallbackType);
  const status = lower((data || {}).status);

  if (fallback.includes("refund")) {
    return status.includes("complete") ? "refund_completed" : "refund_initiated";
  }

  if (fallback.includes("settlement")) {
    return "settlement_completed";
  }

  if (fallback.includes("booking")) {
    if (status.includes("reject")) return "booking_rejected";
    return "booking_confirmed";
  }

  if (fallback.includes("payment")) {
    return "payment_success";
  }

  if (status.includes("reject")) return "booking_rejected";
  if (status.includes("refund")) {
    return status.includes("complete") ? "refund_completed" : "refund_initiated";
  }
  if (status.includes("settlement")) return "settlement_completed";

  return "booking_confirmed";
};

const base64UrlEncode = (input: Uint8Array | string) => {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const pemToArrayBuffer = (pem: string) => {
  const normalized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const validateServiceAccount = (value: unknown): FirebaseServiceAccount => {
  const candidate = (value ?? {}) as Record<string, unknown>;
  const projectId = String(candidate.project_id || "").trim();
  const clientEmail = String(candidate.client_email || "").trim();
  const privateKey = String(candidate.private_key || "").replaceAll("\\n", "\n").trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key",
    );
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: String(candidate.token_uri || "https://oauth2.googleapis.com/token"),
  };
};

const getFirebaseServiceAccount = () => {
  if (firebaseState.parsed) {
    if (!firebaseState.serviceAccount) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
    }
    return firebaseState.serviceAccount;
  }

  const raw = getEnv("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) {
    firebaseState.parsed = true;
    firebaseState.serviceAccount = null;
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  const serviceAccount = validateServiceAccount(parsed);
  firebaseState.parsed = true;
  firebaseState.serviceAccount = serviceAccount;
  firebaseState.projectId = serviceAccount.project_id;
  return serviceAccount;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sendWithRetry = async <T>(task: () => Promise<T>, attempts = 3) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await delay(250 * attempt);
    }
  }
  throw lastError;
};

const fetchFirebaseAccessToken = async (serviceAccount: FirebaseServiceAccount) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claimSet),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsignedToken)),
  );

  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;
  const response = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`Failed to fetch Firebase access token: ${payload || response.statusText}`);
  }

  const payload = await response.json();
  const accessToken = String(payload.access_token || "").trim();
  const expiresIn = Number(payload.expires_in || 3600);

  if (!accessToken) {
    throw new Error("Firebase access token response was empty");
  }

  firebaseState.accessToken = accessToken;
  firebaseState.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + Math.max(expiresIn - 60, 60);
  return accessToken;
};

const getFirebaseAccessToken = async () => {
  const now = Math.floor(Date.now() / 1000);
  if (firebaseState.accessToken && firebaseState.accessTokenExpiresAt > now) {
    return firebaseState.accessToken;
  }
  return fetchFirebaseAccessToken(getFirebaseServiceAccount());
};

const sendPush = async ({
  token,
  title,
  body,
  type,
  bookingId,
  data,
}: {
  token: string;
  title: string;
  body: string;
  type: string;
  bookingId?: string;
  data: Record<string, string>;
}) => {
  const accessToken = await getFirebaseAccessToken();
  const projectId = firebaseState.projectId || getFirebaseServiceAccount().project_id;

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: {
            ...data,
            type,
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            ...(bookingId ? { booking_id: bookingId } : {}),
          },
          android: {
            priority: "HIGH",
            notification: {
              default_sound: true,
              channel_id: "default",
            },
          },
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  const errorCode = String(payload?.error?.status || payload?.error?.code || "").trim();
  const errorMessage = String(payload?.error?.message || "").trim();

  return {
    ok: response.ok && !errorCode,
    errorCode: errorCode || null,
    errorMessage: errorMessage || null,
    payload,
  };
};

const isInvalidTokenError = (errorCode: string | null, errorMessage: string | null) => {
  const haystack = `${lower(errorCode)} ${lower(errorMessage)}`;
  return (
    haystack.includes("registration-token-not-registered") ||
    haystack.includes("invalid registration token") ||
    haystack.includes("invalid_argument") ||
    haystack.includes("invalid argument") ||
    haystack.includes("not a valid fcm registration token") ||
    haystack.includes("requested entity was not found") ||
    haystack.includes("unregistered")
  );
};

const fetchActiveDeviceTokens = async (
  supabase: ReturnType<typeof getSupabaseClient>,
  userId: string,
): Promise<DeviceTokenRow[]> => {
  const { data: fcmTokens, error: fcmTokensError } = await supabase
    .from("fcm_tokens")
    .select("id, token, app, device_type, platform")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (fcmTokensError && !isMissingTableError(fcmTokensError, "fcm_tokens")) {
    throw fcmTokensError;
  }

  if (fcmTokens && fcmTokens.length > 0) {
    return fcmTokens.map((row) => ({
      ...row,
      sourceTable: "fcm_tokens" as const,
    }));
  }

  const { data: userDevices, error: userDevicesError } = await supabase
    .from("user_devices")
    .select("id, fcm_token, app, device_type, platform")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (userDevicesError && !isMissingTableError(userDevicesError, "user_devices")) {
    throw userDevicesError;
  }

  if (userDevices && userDevices.length > 0) {
    return userDevices.map((row) => ({
      id: row.id,
      token: row.fcm_token,
      app: row.app,
      device_type: row.device_type,
      platform: row.platform,
      sourceTable: "user_devices" as const,
    }));
  }

  const { data: legacyTokens, error: legacyTokensError } = await supabase
    .from("device_tokens")
    .select("id, token, app, platform")
    .eq("user_id", userId)
    .eq("status", "active");

  if (legacyTokensError && !isMissingTableError(legacyTokensError, "device_tokens")) {
    throw legacyTokensError;
  }

  return (legacyTokens || []).map((row) => ({
    ...row,
    device_type: row.platform,
    sourceTable: "device_tokens" as const,
  }));
};

const disableInvalidTokens = async (
  supabase: ReturnType<typeof getSupabaseClient>,
  tokenRows: DeviceTokenRow[],
) => {
  if (tokenRows.length === 0) {
    return null;
  }

  const invalidFcmTokenIds = tokenRows
    .filter((row) => row.sourceTable === "fcm_tokens")
    .map((row) => row.id);
  const invalidUserDeviceIds = tokenRows
    .filter((row) => row.sourceTable === "user_devices")
    .map((row) => row.id);
  const invalidLegacyTokenIds = tokenRows
    .filter((row) => row.sourceTable === "device_tokens")
    .map((row) => row.id);

  const cleanupErrors: string[] = [];

  if (invalidFcmTokenIds.length > 0) {
    const { error } = await supabase
      .from("fcm_tokens")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .in("id", invalidFcmTokenIds);

    if (error && !isMissingTableError(error, "fcm_tokens")) {
      cleanupErrors.push(error.message);
    }
  }

  if (invalidLegacyTokenIds.length > 0) {
    const { error } = await supabase
      .from("device_tokens")
      .update({
        status: "disabled",
        updated_at: new Date().toISOString(),
      })
      .in("id", invalidLegacyTokenIds);

    if (error && !isMissingTableError(error, "device_tokens")) {
      cleanupErrors.push(error.message);
    }
  }

  if (invalidUserDeviceIds.length > 0) {
    const { error } = await supabase
      .from("user_devices")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .in("id", invalidUserDeviceIds);

    if (error && !isMissingTableError(error, "user_devices")) {
      cleanupErrors.push(error.message);
    }
  }

  return cleanupErrors.length > 0 ? cleanupErrors.join("; ") : null;
};

const insertNotificationIfNeeded = async (
  supabase: ReturnType<typeof getSupabaseClient>,
  payload: Record<string, unknown>,
) => {
  if (payload.notification_id) {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("id", payload.notification_id)
      .maybeSingle();
    return data as NotificationRow | null;
  }

  const title = String(payload.title || "").trim();
  const body = String(payload.body || payload.message || "").trim();
  const userId = String(payload.user_id || payload.userId || "").trim();
  if (!title || !body || !userId) {
    throw new Error("notification_id or user_id/title/body is required");
  }

  const eventId = String(payload.event_id || payload.eventId || "").trim();
  const notificationData = {
    ...(payload.data && typeof payload.data === "object" ? payload.data : {}),
    ...(eventId ? { event_id: eventId } : {}),
  };
  const normalizedType = normalizeNotificationType(
    payload.notification_type,
    payload.type,
    notificationData,
  );

  if (eventId) {
    const { data: existing } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .contains("data", { event_id: eventId })
      .maybeSingle();
    if (existing) return existing as NotificationRow;
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      title,
      message: body,
      type: payload.type || "system",
      notification_type: normalizedType,
      status: "queued",
      data: notificationData,
      is_read: false,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as NotificationRow;
};

const logInfo = (message: string, details: Record<string, unknown>) => {
  console.info(JSON.stringify({ level: "info", message, ...details }));
};

const logWarn = (message: string, details: Record<string, unknown>) => {
  console.warn(JSON.stringify({ level: "warn", message, ...details }));
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const { headers } = resolveCors(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405, origin);

  try {
    const supabase = getSupabaseClient();
    const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const notification = await insertNotificationIfNeeded(supabase, payload);

    if (!notification?.id) {
      return json({ success: true, skipped: true }, 200, origin);
    }

    const currentStatus = lower(notification.status);
    if (currentStatus && !["queued", "processing"].includes(currentStatus)) {
      return json(
        {
          success: true,
          notificationId: notification.id,
          status: notification.status,
          skipped: true,
        },
        200,
        origin,
      );
    }

    const route = deriveRoute(notification);
    const normalizedNotificationType = normalizeNotificationType(
      notification.notification_type,
      notification.type,
      notification.data as Record<string, unknown> | null | undefined,
    );
    const normalizedData = normalizeData({
      ...((notification.data as Record<string, unknown> | null | undefined) || {}),
      route,
      notification_id: notification.id,
      type: normalizedNotificationType,
    });

    const tokens = await fetchActiveDeviceTokens(supabase, notification.user_id);

    if (!tokens || tokens.length === 0) {
      await supabase.from("notifications").update({ status: "failed" }).eq("id", notification.id);
      return json(
        {
          success: false,
          notificationId: notification.id,
          status: "failed",
          error: "No active FCM tokens found for user",
        },
        404,
        origin,
      );
    }

    const serviceAccount = getFirebaseServiceAccount();
    logInfo("send-notification:start", {
      notificationId: notification.id,
      userId: notification.user_id,
      tokenCount: tokens.length,
      projectId: serviceAccount.project_id,
      type: normalizedNotificationType,
    });

    const invalidTokenRows: DeviceTokenRow[] = [];
    const results: Array<Record<string, unknown>> = [];

    for (const tokenRow of tokens) {
      const result = await sendWithRetry(
        () =>
          sendPush({
            token: String(tokenRow.token),
            title: notification.title,
            body: notification.message,
            type: normalizedNotificationType,
            bookingId: String(
              ((notification.data as Record<string, unknown> | null | undefined) || {}).booking_id || "",
            ).trim() || undefined,
            data: normalizedData,
          }),
        3,
      ).catch((error) => ({
        ok: false,
        errorCode: "send_failed",
        errorMessage: error instanceof Error ? error.message : String(error || "Unknown push error"),
        payload: null,
      }));

      if (isInvalidTokenError(result.errorCode, result.errorMessage)) {
        invalidTokenRows.push(tokenRow);
      }

      if (result.ok) {
        logInfo("send-notification:sent", {
          notificationId: notification.id,
          tokenId: tokenRow.id,
          app: tokenRow.app,
        });
      } else {
        logWarn("send-notification:failed", {
          notificationId: notification.id,
          tokenId: tokenRow.id,
          app: tokenRow.app,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        });
      }

      results.push({
        tokenId: tokenRow.id,
        app: tokenRow.app,
        ok: result.ok,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }

    const invalidTokenIds = invalidTokenRows.map((row) => row.id);
    const invalidTokenCleanupError = await disableInvalidTokens(supabase, invalidTokenRows);
    if (invalidTokenRows.length > 0) {
      logWarn("send-notification:invalid-tokens-disabled", {
        notificationId: notification.id,
        invalidTokenIds,
        cleanupError: invalidTokenCleanupError,
      });
    }

    const successCount = results.filter((entry) => entry.ok).length;
    const nextStatus = successCount > 0 ? "sent" : "failed";

    await supabase
      .from("notifications")
      .update({ status: nextStatus })
      .eq("id", notification.id);

    return json(
      {
        success: successCount > 0,
        notificationId: notification.id,
        status: nextStatus,
        successCount,
        failureCount: results.length - successCount,
        invalidTokenIds,
        invalidTokenCleanupError,
        results,
      },
      successCount > 0 ? 200 : 502,
      origin,
    );
  } catch (error: any) {
    const message = error?.message || "Dispatch failed";
    logWarn("send-notification:exception", { error: message });
    return json({ success: false, error: message }, 400, origin);
  }
});
