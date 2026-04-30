import { handleCorsPreflight } from "../_shared/http.ts";
import { resolveCors } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  fetchBookingForAccess,
  fetchPaymentByInput,
  verifyCashfreePaymentStatus,
} from "../_shared/cashfree-payments.ts";
import { assertAllowedOrigin } from "../_shared/http.ts";
import { buildRateLimitKey, enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";
import {
  isAllowedLocalPaymentReturnUrl,
  isUnsafePaymentReturnUrl,
  sanitizeReturnBaseUrl,
} from "../_shared/return-url.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { decodePaymentStatusToken, verifyPaymentStatusToken } from "../_shared/security.ts";

const normalizeApp = (value: string | null): "customer" | "owner" | "admin" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "owner" || normalized === "admin") return normalized;
  return "customer";
};

const DEFAULT_MOBILE_APP_BASE_URL: Record<"customer" | "owner" | "admin", string> = {
  customer: "roomfinder://app",
  owner: "com.roomfindr.owner://app",
  admin: "com.roomfindr.admin://app",
};

const DEFAULT_ANDROID_PACKAGE_ID: Record<"customer" | "owner" | "admin", string> = {
  customer: "com.roomfinder.app",
  owner: "com.roomfindr.owner",
  admin: "com.roomfindr.admin",
};

const normalizePaymentType = (value: string | null): "booking" | "monthly" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "monthly" || normalized === "rent") return "monthly";
  return "booking";
};

const extractMonth = (value: string | null): string => {
  const month = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : "";
};

const getOptionalAuthenticatedUser = async (req: Request) => {
  try {
    const { user } = await requireAuthenticatedUser(req);
    return user;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/missing bearer token|invalid or expired auth token|unauthorized/i.test(message)) {
      return null;
    }
    throw error;
  }
};

const buildHeaders = (
  req: Request,
  contentType: string,
): Headers => {
  const headers = new Headers(resolveCors(req.headers.get("origin")).headers);
  headers.set("content-type", contentType);
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  headers.set("pragma", "no-cache");
  headers.set("x-content-type-options", "nosniff");
  if (/^text\/html\b/i.test(contentType)) {
    headers.set(
      "content-security-policy",
      "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline'; img-src * data: blob:; connect-src *; frame-src * data: blob:;",
    );
    headers.set("content-disposition", "inline");
  }
  return headers;
};

const jsonResponse = (req: Request, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: buildHeaders(req, "application/json; charset=utf-8"),
  });

const htmlResponse = (req: Request, body: string, status = 200): Response =>
  (() => {
    const headers = buildHeaders(req, "text/html; charset=utf-8");
    return new Response(body, {
      status,
      headers,
    });
  })();

const redirectResponse = (req: Request, location: string, status = 302): Response =>
  new Response(null, {
    status,
    headers: (() => {
      const headers = new Headers(resolveCors(req.headers.get("origin")).headers);
      headers.set("location", location);
      headers.set("cache-control", "no-store, no-cache, must-revalidate");
      headers.set("pragma", "no-cache");
      headers.set("x-content-type-options", "nosniff");
      return headers;
    })(),
  });

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const cleanEnv = (value: string | null | undefined): string =>
  String(value || "").replaceAll(/["']/g, "").trim();

const getConfiguredReturnBaseUrl = (app: "customer" | "owner" | "admin"): string => {
  const appSpecificKeys = app === "owner"
    ? ["OWNER_PAYMENT_RETURN_BASE_URL", "OWNER_APP_URL", "OWNER_MOBILE_APP_URL"]
    : app === "admin"
      ? ["ADMIN_PAYMENT_RETURN_BASE_URL", "ADMIN_APP_URL", "ADMIN_MOBILE_APP_URL"]
      : ["CUSTOMER_PAYMENT_RETURN_BASE_URL", "CUSTOMER_APP_URL", "CUSTOMER_MOBILE_APP_URL"];

  const sharedKeys = ["PAYMENT_RETURN_BASE_URL", "APP_URL", "SITE_URL", "MOBILE_APP_URL"];

  for (const key of [...appSpecificKeys, ...sharedKeys]) {
    const value = cleanEnv(Deno.env.get(key));
    const normalized = sanitizeReturnBaseUrl(value);
    if (normalized) return normalized;
  }

  return "";
};

const getConfiguredMobileAppBaseUrl = (app: "customer" | "owner" | "admin"): string => {
  const appSpecificKeys = app === "owner"
    ? ["OWNER_MOBILE_APP_URL", "OWNER_APP_URL", "OWNER_PAYMENT_RETURN_BASE_URL"]
    : app === "admin"
      ? ["ADMIN_MOBILE_APP_URL", "ADMIN_APP_URL", "ADMIN_PAYMENT_RETURN_BASE_URL"]
      : ["CUSTOMER_MOBILE_APP_URL", "CUSTOMER_APP_URL", "CUSTOMER_PAYMENT_RETURN_BASE_URL"];

  for (const key of [...appSpecificKeys, "MOBILE_APP_URL"]) {
    const value = cleanEnv(Deno.env.get(key));
    const normalized = sanitizeReturnBaseUrl(value);
    if (normalized && /^[a-z][a-z0-9+\-.]*:/i.test(normalized) && !/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_MOBILE_APP_BASE_URL[app];
};

const getConfiguredAndroidPackageId = (app: "customer" | "owner" | "admin"): string => {
  const appSpecificKeys = app === "owner"
    ? ["OWNER_ANDROID_PACKAGE_ID", "OWNER_ANDROID_APP_ID", "OWNER_APP_ID"]
    : app === "admin"
      ? ["ADMIN_ANDROID_PACKAGE_ID", "ADMIN_ANDROID_APP_ID", "ADMIN_APP_ID"]
      : ["CUSTOMER_ANDROID_PACKAGE_ID", "CUSTOMER_ANDROID_APP_ID", "CUSTOMER_APP_ID"];

  for (const key of appSpecificKeys) {
    const value = cleanEnv(Deno.env.get(key));
    if (value) return value;
  }

  return DEFAULT_ANDROID_PACKAGE_ID[app];
};

const normalizeBaseUrl = (value: string): string => {
  return sanitizeReturnBaseUrl(value);
};

const buildFunctionUrl = (req: Request, functionName: string): string => {
  const configuredSupabaseUrl = cleanEnv(Deno.env.get("SUPABASE_URL"));
  if (configuredSupabaseUrl && /^https?:\/\//i.test(configuredSupabaseUrl)) {
    return new URL(`/functions/v1/${functionName}`, configuredSupabaseUrl).toString();
  }

  const requestUrl = new URL(req.url);
  return new URL(`/functions/v1/${functionName}`, `https://${requestUrl.host}`).toString();
};

const isMobileUserAgent = (value: string | null): boolean =>
  /android|iphone|ipad|ipod|mobile/i.test(String(value || "").trim());

const shouldUseHostedMobileStatusPage = (
  req: Request,
  frontendBaseUrl: string,
): boolean => {
  const normalizedBaseUrl = normalizeBaseUrl(frontendBaseUrl);
  if (!normalizedBaseUrl) return true;
  if (!isMobileUserAgent(req.headers.get("user-agent"))) return false;
  return isUnsafePaymentReturnUrl(normalizedBaseUrl) && isAllowedLocalPaymentReturnUrl(normalizedBaseUrl);
};

const buildFrontendStatusUrl = (
  input: {
    bookingId: string;
    orderId: string;
    app: "customer" | "owner" | "admin";
    frontendBaseUrl?: string;
    paymentType?: "booking" | "monthly";
    month?: string;
    context?: string;
    statusToken?: string;
  },
): string => {
  const configuredBaseUrl = getConfiguredReturnBaseUrl(input.app);
  const resolvedBaseUrl = normalizeBaseUrl(input.frontendBaseUrl || "") || configuredBaseUrl;
  if (!resolvedBaseUrl) return "";

  const params = new URLSearchParams();
  params.set("booking_id", input.bookingId);
  params.set("order_id", input.orderId);
  params.set("app", input.app);
  if (input.context) {
    params.set("context", input.context);
  }
  if (input.paymentType) {
    params.set("payment_type", input.paymentType);
  }
  if (input.month) {
    params.set("month", input.month);
  }
  if (input.statusToken) {
    params.set("status_token", input.statusToken);
  }

  if (/^[a-z][a-z0-9+\-.]*:/i.test(resolvedBaseUrl) && !/^https?:\/\//i.test(resolvedBaseUrl)) {
    return `${resolvedBaseUrl}/payment-status?${params.toString()}`;
  }

  const url = new URL("/payment-status", resolvedBaseUrl);
  url.search = params.toString();
  return url.toString();
};

const buildAppRouteUrl = (
  baseUrl: string,
  path: string,
  params: URLSearchParams,
): string => {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!resolvedBaseUrl) return "";

  if (/^[a-z][a-z0-9+\-.]*:/i.test(resolvedBaseUrl) && !/^https?:\/\//i.test(resolvedBaseUrl)) {
    return `${resolvedBaseUrl}${path}?${params.toString()}`;
  }

  const url = new URL(path, resolvedBaseUrl);
  url.search = params.toString();
  return url.toString();
};

const buildInAppResultUrl = (input: {
  appBaseUrl: string;
  app: "customer" | "owner" | "admin";
  bookingId: string;
  orderId: string;
  paymentType: "booking" | "monthly";
  month?: string;
  context?: string;
  result: "paid" | "failed";
}): string => {
  const params = new URLSearchParams();
  params.set("app", input.app);
  params.set("payment_result", input.result === "paid" ? "success" : "failed");
  params.set("payment_context", input.paymentType === "monthly" ? "rent" : (input.context || "payment"));
  if (input.bookingId) params.set("booking_id", input.bookingId);
  if (input.orderId) params.set("order_id", input.orderId);

  if (input.paymentType === "monthly") {
    if (input.month) params.set("month", input.month);
    params.set("portalTab", "payments");
    params.set(
      "payment_message",
      input.result === "paid"
        ? "Rent payment received successfully."
        : "Rent payment was cancelled or failed. Please try again.",
    );
    return buildAppRouteUrl(input.appBaseUrl, "/chat", params);
  }

  if (input.result === "paid") {
    params.set("owner_wait", "1");
    params.set("highlight", input.bookingId);
    params.set("payment_message", "Payment received. Please wait for owner approval.");
  } else {
    params.set("payment_message", "Payment was cancelled or failed. Please try again.");
  }

  return buildAppRouteUrl(input.appBaseUrl, "/bookings", params);
};

const buildAndroidIntentUrl = (
  deepLinkUrl: string,
  packageId: string,
): string => {
  const normalized = String(deepLinkUrl || "").trim();
  const targetPackage = String(packageId || "").trim();
  if (!normalized || !targetPackage) return "";

  try {
    const url = new URL(normalized);
    if (/^https?:$/i.test(url.protocol)) {
      return normalized;
    }

    const scheme = url.protocol.replace(":", "");
    const host = url.hostname || "";
    const path = `${url.pathname || ""}${url.search || ""}${url.hash || ""}`;
    return `intent://${host}${path}#Intent;scheme=${scheme};package=${targetPackage};end`;
  } catch {
    return "";
  }
};

const buildHostedStatusPage = (
  req: Request,
  input: {
    bookingId: string;
    orderId: string;
    app: "customer" | "owner" | "admin";
    paymentType: "booking" | "monthly";
    month?: string;
    context?: string;
    statusToken?: string;
    appLaunchUrl?: string;
    successAppLaunchUrl?: string;
    failureAppLaunchUrl?: string;
    androidPendingIntentUrl?: string;
    androidSuccessIntentUrl?: string;
    androidFailureIntentUrl?: string;
  },
): string => {
  const statusUrl = new URL(buildFunctionUrl(req, "payment-status"));
  statusUrl.searchParams.set("mode", "status");
  if (input.bookingId) statusUrl.searchParams.set("booking_id", input.bookingId);
  if (input.orderId) statusUrl.searchParams.set("order_id", input.orderId);
  statusUrl.searchParams.set("app", input.app);
  statusUrl.searchParams.set("payment_type", input.paymentType);
  if (input.month) statusUrl.searchParams.set("month", input.month);
  if (input.context) statusUrl.searchParams.set("context", input.context);
  if (input.statusToken) statusUrl.searchParams.set("status_token", input.statusToken);

  const successHeading = input.paymentType === "monthly"
    ? "Rent Payment Successful"
    : "Payment Successful";
  const successBody = input.paymentType === "monthly"
    ? "Your rent payment is received. The booking status will refresh automatically when you reopen RoomFindR."
    : "Your payment is received. Please wait for owner approval.";
  const pendingHeading = "Finalizing Payment";
  const pendingBody = "We are checking the final payment status with Cashfree and the backend.";
  const failureHeading = input.paymentType === "monthly"
    ? "Rent Payment Failed"
    : "Payment Failed";
  const failureBody = input.paymentType === "monthly"
    ? "The rent payment was cancelled or failed. Reopen RoomFindR and try again."
    : "The payment was cancelled or failed. Reopen RoomFindR and try again.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>RoomFindR Payment Status</title>
    <style>
      :root {
        color-scheme: light;
        --bg-start: #eef5ff;
        --bg-end: #f8fbff;
        --card: rgba(255,255,255,0.98);
        --border: rgba(191, 219, 254, 0.75);
        --text: #0f172a;
        --muted: #64748b;
        --primary: #2563eb;
        --primary-soft: rgba(37, 99, 235, 0.12);
        --success: #2563eb;
        --danger: #dc2626;
        --pending: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: Inter, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(59,130,246,0.14), transparent 34%),
          linear-gradient(180deg, var(--bg-start), var(--bg-end));
        color: var(--text);
      }
      .shell {
        width: min(100%, 420px);
        border-radius: 32px;
        overflow: hidden;
        background: var(--card);
        border: 1px solid var(--border);
        box-shadow: 0 32px 80px rgba(15,23,42,0.16);
      }
      .hero {
        padding: 32px 28px 24px;
        text-align: center;
        background: linear-gradient(180deg, rgba(37,99,235,0.10), rgba(255,255,255,0.45));
      }
      .icon {
        width: 88px;
        height: 88px;
        border-radius: 999px;
        margin: 0 auto 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--primary-soft);
        color: var(--primary);
        font-size: 40px;
        font-weight: 700;
      }
      .icon.pending {
        background: rgba(245,158,11,0.14);
        color: var(--pending);
      }
      .icon.failed {
        background: rgba(220,38,38,0.12);
        color: var(--danger);
      }
      h1 {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
        font-weight: 800;
      }
      .message {
        margin: 14px auto 0;
        max-width: 280px;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
        font-weight: 500;
      }
      .body {
        padding: 22px 24px 24px;
      }
      .panel {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        border-radius: 20px;
        border: 1px solid rgba(226,232,240,0.95);
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        padding: 18px;
      }
      .panel-mark {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(37,99,235,0.08);
        color: var(--primary);
        flex: 0 0 auto;
        font-size: 16px;
      }
      .panel h2 {
        margin: 0;
        font-size: 14px;
        line-height: 1.2;
        font-weight: 800;
      }
      .panel p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
        font-weight: 500;
      }
      .cta {
        width: 100%;
        margin-top: 20px;
        border: 0;
        border-radius: 18px;
        background: #162033;
        color: #fff;
        height: 54px;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .cta.secondary {
        margin-top: 12px;
        background: #ffffff;
        color: #162033;
        border: 1px solid rgba(148,163,184,0.28);
      }
      .subtle {
        margin-top: 14px;
        text-align: center;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div id="status-icon" class="icon pending">...</div>
        <h1 id="status-title">${escapeHtml(pendingHeading)}</h1>
        <p id="status-message" class="message">${escapeHtml(pendingBody)}</p>
      </section>
      <section class="body">
        <div class="panel">
          <div class="panel-mark">i</div>
          <div>
            <h2 id="detail-title">Checking Status</h2>
            <p id="detail-message">Please keep this tab open for a few seconds while we confirm the final result.</p>
          </div>
        </div>
        <button id="open-app-button" class="cta" type="button">Open RoomFindR</button>
        <button id="done-button" class="cta secondary" type="button">Okay, Got It</button>
        <p class="subtle">Booking ${escapeHtml(input.bookingId || "-")} • Order ${escapeHtml(input.orderId || "-")}</p>
      </section>
    </main>
    <script>
      const statusUrl = ${JSON.stringify(statusUrl.toString())};
      const appLaunchUrl = ${JSON.stringify(input.appLaunchUrl || '')};
      const content = {
        pending: {
          icon: '...',
          iconClass: 'icon pending',
          title: ${JSON.stringify(pendingHeading)},
          message: ${JSON.stringify(pendingBody)},
          detailTitle: 'Verification Pending',
          detailMessage: 'We will keep checking automatically until the final payment status is available.'
        },
        paid: {
          icon: '✓',
          iconClass: 'icon',
          title: ${JSON.stringify(successHeading)},
          message: ${JSON.stringify(successBody)},
          detailTitle: ${JSON.stringify(input.paymentType === "monthly" ? "Rent Confirmed" : "Approval Pending")},
          detailMessage: ${JSON.stringify(input.paymentType === "monthly"
            ? "Your payment is complete. If RoomFindR is already open, it will reflect the updated status when you return."
            : "The owner will review your request soon. You will be notified once the booking is approved.")}
        },
        failed: {
          icon: '!',
          iconClass: 'icon failed',
          title: ${JSON.stringify(failureHeading)},
          message: ${JSON.stringify(failureBody)},
          detailTitle: 'Try Again in RoomFindR',
          detailMessage: 'Go back to RoomFindR and start the payment again if needed.'
        }
      };

      const els = {
        icon: document.getElementById('status-icon'),
        title: document.getElementById('status-title'),
        message: document.getElementById('status-message'),
        detailTitle: document.getElementById('detail-title'),
        detailMessage: document.getElementById('detail-message'),
        openApp: document.getElementById('open-app-button'),
        done: document.getElementById('done-button'),
      };

      const applyState = (state) => {
        const next = content[state] || content.pending;
        els.icon.className = next.iconClass;
        els.icon.textContent = next.icon;
        els.title.textContent = next.title;
        els.message.textContent = next.message;
        els.detailTitle.textContent = next.detailTitle;
        els.detailMessage.textContent = next.detailMessage;
      };

      let closed = false;
      const openRoomFindR = () => {
        if (!appLaunchUrl) return;
        window.location.replace(appLaunchUrl);
      };

      if (els.openApp) {
        els.openApp.addEventListener('click', () => {
          openRoomFindR();
        });
      }

      els.done.addEventListener('click', () => {
        if (closed) return;
        closed = true;
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
        window.close();
      });

      const poll = async () => {
        if (closed) return;
        try {
          const response = await fetch(statusUrl, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            headers: { 'Cache-Control': 'no-cache' }
          });
          const payload = await response.json().catch(() => null);
          const status = String(payload?.status || '').toLowerCase();
          if (status === 'paid') {
            applyState('paid');
            return;
          }
          if (status === 'failed') {
            applyState('failed');
            return;
          }
        } catch (_) {
          // Keep retrying silently.
        }
        window.setTimeout(poll, 3000);
      };

      applyState('pending');
      if (appLaunchUrl) {
        window.setTimeout(openRoomFindR, 120);
      }
      void poll();
    </script>
  </body>
</html>`;
};

const buildHostedStatusBridgePage = (
  req: Request,
  input: {
    bookingId: string;
    orderId: string;
    app: "customer" | "owner" | "admin";
    paymentType: "booking" | "monthly";
    month?: string;
    context?: string;
    statusToken?: string;
    appLaunchUrl?: string;
    successAppLaunchUrl?: string;
    failureAppLaunchUrl?: string;
    androidPendingIntentUrl?: string;
    androidSuccessIntentUrl?: string;
    androidFailureIntentUrl?: string;
  },
): string => {
  const statusUrl = new URL(buildFunctionUrl(req, "payment-status"));
  statusUrl.searchParams.set("mode", "status");
  if (input.bookingId) statusUrl.searchParams.set("booking_id", input.bookingId);
  if (input.orderId) statusUrl.searchParams.set("order_id", input.orderId);
  statusUrl.searchParams.set("app", input.app);
  statusUrl.searchParams.set("payment_type", input.paymentType);
  if (input.month) statusUrl.searchParams.set("month", input.month);
  if (input.context) statusUrl.searchParams.set("context", input.context);
  if (input.statusToken) statusUrl.searchParams.set("status_token", input.statusToken);

  const successHeading = input.paymentType === "monthly"
    ? "Rent Payment Successful"
    : "Payment Successful";
  const successBody = input.paymentType === "monthly"
    ? "Your rent payment is received. RoomFindR will refresh it when the app opens."
    : "Your payment is received. Please wait for owner approval.";
  const pendingHeading = "Finalizing Payment";
  const pendingBody = "We are checking the final payment status with Cashfree and the backend.";
  const failureHeading = input.paymentType === "monthly"
    ? "Rent Payment Failed"
    : "Payment Failed";
  const failureBody = input.paymentType === "monthly"
    ? "The rent payment was cancelled or failed. Reopen RoomFindR and try again."
    : "The payment was cancelled or failed. Reopen RoomFindR and try again.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>RoomFindR Payment Status</title>
    <style>
      :root {
        color-scheme: light;
        --bg-start: #eef5ff;
        --bg-end: #f8fbff;
        --card: rgba(255,255,255,0.98);
        --border: rgba(191, 219, 254, 0.75);
        --text: #0f172a;
        --muted: #64748b;
        --primary: #2563eb;
        --primary-soft: rgba(37, 99, 235, 0.12);
        --danger: #dc2626;
        --pending: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: Inter, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(59,130,246,0.14), transparent 34%),
          linear-gradient(180deg, var(--bg-start), var(--bg-end));
        color: var(--text);
      }
      .shell {
        width: min(100%, 420px);
        border-radius: 32px;
        overflow: hidden;
        background: var(--card);
        border: 1px solid var(--border);
        box-shadow: 0 32px 80px rgba(15,23,42,0.16);
      }
      .hero {
        padding: 32px 28px 24px;
        text-align: center;
        background: linear-gradient(180deg, rgba(37,99,235,0.10), rgba(255,255,255,0.45));
      }
      .icon {
        width: 88px;
        height: 88px;
        border-radius: 999px;
        margin: 0 auto 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--primary-soft);
        color: var(--primary);
        font-size: 32px;
        font-weight: 800;
      }
      .icon.pending {
        background: rgba(245,158,11,0.14);
        color: var(--pending);
      }
      .icon.failed {
        background: rgba(220,38,38,0.12);
        color: var(--danger);
      }
      h1 {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
        font-weight: 800;
      }
      .message {
        margin: 14px auto 0;
        max-width: 280px;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
        font-weight: 500;
      }
      .body {
        padding: 22px 24px 24px;
      }
      .panel {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        border-radius: 20px;
        border: 1px solid rgba(226,232,240,0.95);
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        padding: 18px;
      }
      .panel-mark {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(37,99,235,0.08);
        color: var(--primary);
        flex: 0 0 auto;
        font-size: 16px;
      }
      .panel h2 {
        margin: 0;
        font-size: 14px;
        line-height: 1.2;
        font-weight: 800;
      }
      .panel p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
        font-weight: 500;
      }
      .cta {
        width: 100%;
        margin-top: 20px;
        border: 0;
        border-radius: 18px;
        background: #162033;
        color: #fff;
        height: 54px;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .cta.secondary {
        margin-top: 12px;
        background: #ffffff;
        color: #162033;
        border: 1px solid rgba(148,163,184,0.28);
      }
      .subtle {
        margin-top: 14px;
        text-align: center;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div id="status-icon" class="icon pending">...</div>
        <h1 id="status-title">${escapeHtml(pendingHeading)}</h1>
        <p id="status-message" class="message">${escapeHtml(pendingBody)}</p>
      </section>
      <section class="body">
        <div class="panel">
          <div class="panel-mark">i</div>
          <div>
            <h2 id="detail-title">Checking Status</h2>
            <p id="detail-message">Please keep this tab open for a few seconds while we confirm the final result.</p>
          </div>
        </div>
        <button id="open-app-button" class="cta" type="button">Open RoomFindR</button>
        <button id="done-button" class="cta secondary" type="button">Okay, Got It</button>
        <p class="subtle">Booking ${escapeHtml(input.bookingId || "-")} | Order ${escapeHtml(input.orderId || "-")}</p>
      </section>
    </main>
    <script>
      const statusUrl = ${JSON.stringify(statusUrl.toString())};
      const appLaunchUrl = ${JSON.stringify(input.appLaunchUrl || "")};
      const successAppLaunchUrl = ${JSON.stringify(input.successAppLaunchUrl || "")};
      const failureAppLaunchUrl = ${JSON.stringify(input.failureAppLaunchUrl || "")};
      const androidIntentUrls = {
        pending: ${JSON.stringify(input.androidPendingIntentUrl || "")},
        paid: ${JSON.stringify(input.androidSuccessIntentUrl || "")},
        failed: ${JSON.stringify(input.androidFailureIntentUrl || "")}
      };
      const content = {
        pending: {
          icon: "...",
          iconClass: "icon pending",
          title: ${JSON.stringify(pendingHeading)},
          message: ${JSON.stringify(pendingBody)},
          detailTitle: "Verification Pending",
          detailMessage: "We will keep checking automatically until the final payment status is available."
        },
        paid: {
          icon: "OK",
          iconClass: "icon",
          title: ${JSON.stringify(successHeading)},
          message: ${JSON.stringify(successBody)},
          detailTitle: ${JSON.stringify(input.paymentType === "monthly" ? "Rent Confirmed" : "Approval Pending")},
          detailMessage: ${JSON.stringify(input.paymentType === "monthly"
            ? "Your payment is complete. If RoomFindR is already open, it will reflect the updated status when you return."
            : "The owner will review your request soon. You will be notified once the booking is approved.")}
        },
        failed: {
          icon: "!",
          iconClass: "icon failed",
          title: ${JSON.stringify(failureHeading)},
          message: ${JSON.stringify(failureBody)},
          detailTitle: "Try Again in RoomFindR",
          detailMessage: "Go back to RoomFindR and start the payment again if needed."
        }
      };
      const isAndroid = /android/i.test(navigator.userAgent || "");

      const els = {
        icon: document.getElementById("status-icon"),
        title: document.getElementById("status-title"),
        message: document.getElementById("status-message"),
        detailTitle: document.getElementById("detail-title"),
        detailMessage: document.getElementById("detail-message"),
        openApp: document.getElementById("open-app-button"),
        done: document.getElementById("done-button"),
      };

      const applyState = (state) => {
        const next = content[state] || content.pending;
        els.icon.className = next.iconClass;
        els.icon.textContent = next.icon;
        els.title.textContent = next.title;
        els.message.textContent = next.message;
        els.detailTitle.textContent = next.detailTitle;
        els.detailMessage.textContent = next.detailMessage;
      };

      let closed = false;
      let latestState = "pending";
      let latestOpenToken = "";

      const launchWithIframe = (targetUrl) => {
        if (!targetUrl) return;
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.setAttribute("aria-hidden", "true");
        iframe.src = targetUrl;
        document.body.appendChild(iframe);
        window.setTimeout(() => iframe.remove(), 1200);
      };

      const resolveLaunchTargets = (state) => {
        if (state === "paid") {
          return {
            appUrl: successAppLaunchUrl || appLaunchUrl,
            intentUrl: androidIntentUrls.paid || androidIntentUrls.pending,
          };
        }
        if (state === "failed") {
          return {
            appUrl: failureAppLaunchUrl || appLaunchUrl,
            intentUrl: androidIntentUrls.failed || androidIntentUrls.pending,
          };
        }
        return {
          appUrl: appLaunchUrl,
          intentUrl: androidIntentUrls.pending,
        };
      };

      const openRoomFindR = (state = latestState, force = false) => {
        const targets = resolveLaunchTargets(state);
        if (!targets.appUrl && !targets.intentUrl) return;

        const nextToken = String(state) + ":" + String(targets.appUrl || "") + ":" + String(targets.intentUrl || "");
        if (!force && latestOpenToken === nextToken) return;
        latestOpenToken = nextToken;

        if (targets.appUrl) {
          launchWithIframe(targets.appUrl);
        }

        if (isAndroid && targets.intentUrl) {
          window.setTimeout(() => {
            window.location.replace(targets.intentUrl);
          }, 40);
          window.setTimeout(() => {
            if (!closed && latestState === state) {
              launchWithIframe(targets.appUrl || "");
            }
          }, 850);
          window.setTimeout(() => {
            if (!closed && latestState === state && targets.intentUrl) {
              window.location.replace(targets.intentUrl);
            }
          }, 1450);
          return;
        }

        if (targets.appUrl) {
          window.location.replace(targets.appUrl);
        }
      };

      if (els.openApp) {
        els.openApp.addEventListener("click", () => {
          openRoomFindR(latestState);
        });
      }

      els.done.addEventListener("click", () => {
        if (closed) return;
        closed = true;
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
        window.close();
      });

      const poll = async () => {
        if (closed) return;
        try {
          const response = await fetch(statusUrl, {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: { "Cache-Control": "no-cache" }
          });
          const payload = await response.json().catch(() => null);
          const status = String(payload?.status || "").toLowerCase();
          if (status === "paid") {
            latestState = "paid";
            applyState("paid");
            window.setTimeout(() => openRoomFindR("paid", true), 80);
            window.setTimeout(() => openRoomFindR("paid", true), 1250);
            return;
          }
          if (status === "failed") {
            latestState = "failed";
            applyState("failed");
            window.setTimeout(() => openRoomFindR("failed", true), 80);
            window.setTimeout(() => openRoomFindR("failed", true), 1250);
            return;
          }
        } catch (_) {
          // Keep retrying silently.
        }
        window.setTimeout(poll, 3000);
      };

      applyState("pending");
      if (appLaunchUrl) {
        window.setTimeout(() => openRoomFindR("pending"), 120);
        window.setTimeout(() => openRoomFindR("pending"), 1500);
      }
      void poll();
    </script>
  </body>
</html>`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (!assertAllowedOrigin(req)) {
    return jsonResponse(req, { success: false, error: "Origin is not allowed" }, 403);
  }
  if (req.method !== "GET") {
    return jsonResponse(req, { success: false, error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const bookingId = url.searchParams.get("booking_id") || url.searchParams.get("bookingId") || url.searchParams.get("b") || "";
  const orderId = url.searchParams.get("order_id") || url.searchParams.get("orderId") || url.searchParams.get("o") || "";
  const app = normalizeApp(url.searchParams.get("app") || url.searchParams.get("a"));
  const frontendBaseUrl = url.searchParams.get("frontend_base_url") || url.searchParams.get("frontendBaseUrl") || url.searchParams.get("f") || "";
  const rawPaymentType = normalizePaymentType(url.searchParams.get("payment_type") || url.searchParams.get("paymentType"));
  const rawMonth = extractMonth(url.searchParams.get("month"));
  const context = String(url.searchParams.get("context") || "").trim().toLowerCase();
  const statusToken = String(url.searchParams.get("status_token") || url.searchParams.get("statusToken") || url.searchParams.get("st") || "").trim();
  const nativeApp = ["1", "true", "yes"].includes(String(url.searchParams.get("native") || url.searchParams.get("n") || "").trim().toLowerCase());
  const decodedStatusToken = statusToken ? await decodePaymentStatusToken(statusToken) : null;
  const paymentType = decodedStatusToken?.paymentType || rawPaymentType;
  const month = decodedStatusToken?.month || rawMonth;
  const mode = String(url.searchParams.get("mode") || "").trim().toLowerCase();
  const clientIp = getClientIp(req);
  const statusRateLimit = await enforceRateLimit(
    buildRateLimitKey("payment-status-ip", bookingId || orderId || "unknown", clientIp, mode || "redirect"),
    30,
    10,
  );
  if (!statusRateLimit.allowed) {
    return jsonResponse(req, { success: false, error: "Too many status checks. Please try again shortly." }, 429);
  }

  if (!bookingId && !orderId) {
    const message = "Missing booking_id or order_id";
    if (mode === "status") {
      return jsonResponse(req, { success: false, error: message }, 400);
    }
    return htmlResponse(
      req,
      `<!doctype html><html lang="en"><body style="font-family:Segoe UI,sans-serif;padding:24px;"><h1>RoomFindR Payment Status</h1><p>${escapeHtml(message)}</p></body></html>`,
      400,
    );
  }

  if (mode === "status") {
    try {
      const supabase = createServiceClient();
      const paymentLookup = {
        bookingId: bookingId || undefined,
        orderId: orderId || undefined,
        paymentType,
        metadata: month ? { month } : undefined,
      };
      if (!statusToken) {
        return jsonResponse(req, { success: false, error: "Payment status token is required" }, 403);
      }

      const hasValidStatusToken = await verifyPaymentStatusToken(statusToken, {
        bookingId: bookingId || undefined,
        orderId: orderId || undefined,
        app,
        paymentType,
        month: month || undefined,
      });
      if (!hasValidStatusToken) {
        return jsonResponse(req, { success: false, error: "Invalid payment status token" }, 403);
      }

      const payment = await fetchPaymentByInput(supabase, paymentLookup);
      if (!payment) {
        return jsonResponse(req, { success: false, error: "Payment not found" }, 404);
      }

      const booking = await fetchBookingForAccess(supabase, payment.booking_id);
      const user = await getOptionalAuthenticatedUser(req);
      if (user) {
        const userRateLimit = await enforceRateLimit(
          buildRateLimitKey("payment-status-user", user.id, bookingId || orderId || "unknown", mode),
          20,
          10,
        );
        if (!userRateLimit.allowed) {
          return jsonResponse(req, { success: false, error: "Too many status checks. Please try again shortly." }, 429);
        }
      }

      if (user && user.id !== booking.customer_id && user.id !== booking.owner_id) {
        return jsonResponse(req, { success: false, error: "Forbidden payment status access" }, 403);
      }

      const result = await verifyCashfreePaymentStatus(supabase, {
        ...paymentLookup,
      });

      return jsonResponse(req, {
        success: true,
        status: result.status,
        booking_id: result.bookingId,
        app,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify payment";
      const statusCode = /missing bearer token|invalid or expired auth token|unauthorized/i.test(message)
        ? 403
        : /not found|mismatch/i.test(message)
          ? 404
          : 400;
      return jsonResponse(req, { success: false, error: message, status: "pending" }, statusCode);
    }
  }

  const frontendStatusUrl = buildFrontendStatusUrl({
    bookingId,
    orderId,
    app,
    frontendBaseUrl,
    paymentType,
    month: month || undefined,
    context: context || (paymentType === "monthly" ? "rent" : ""),
    statusToken: statusToken || undefined,
  });
  const mobileAppStatusUrl = buildFrontendStatusUrl({
    bookingId,
    orderId,
    app,
    frontendBaseUrl: getConfiguredMobileAppBaseUrl(app),
    paymentType,
    month: month || undefined,
    context: context || (paymentType === "monthly" ? "rent" : ""),
    statusToken: statusToken || undefined,
  });
  const mobileAppBaseUrl = getConfiguredMobileAppBaseUrl(app);
  const androidPackageId = getConfiguredAndroidPackageId(app);
  const isMobileRequest = isMobileUserAgent(req.headers.get("user-agent"));
  const successAppLaunchUrl = buildInAppResultUrl({
    appBaseUrl: mobileAppBaseUrl,
    app,
    bookingId,
    orderId,
    paymentType,
    month: month || undefined,
    context: context || (paymentType === "monthly" ? "rent" : ""),
    result: "paid",
  });
  const failureAppLaunchUrl = buildInAppResultUrl({
    appBaseUrl: mobileAppBaseUrl,
    app,
    bookingId,
    orderId,
    paymentType,
    month: month || undefined,
    context: context || (paymentType === "monthly" ? "rent" : ""),
    result: "failed",
  });
  const androidPendingIntentUrl = buildAndroidIntentUrl(mobileAppStatusUrl, androidPackageId);
  const androidSuccessIntentUrl = buildAndroidIntentUrl(successAppLaunchUrl, androidPackageId);
  const androidFailureIntentUrl = buildAndroidIntentUrl(failureAppLaunchUrl, androidPackageId);

  const mobileBridgeRedirectUrl = isMobileRequest
    ? (/android/i.test(String(req.headers.get("user-agent") || ""))
      ? androidPendingIntentUrl || mobileAppStatusUrl
      : mobileAppStatusUrl)
    : "";

  if (nativeApp && mobileAppStatusUrl) {
    return redirectResponse(req, mobileBridgeRedirectUrl || mobileAppStatusUrl, 302);
  }

  if (shouldUseHostedMobileStatusPage(req, frontendBaseUrl) && mobileBridgeRedirectUrl) {
    return redirectResponse(req, mobileBridgeRedirectUrl, 302);
  }

  if (frontendStatusUrl && !shouldUseHostedMobileStatusPage(req, frontendBaseUrl)) {
    return redirectResponse(req, frontendStatusUrl, 302);
  }

  return htmlResponse(
    req,
    buildHostedStatusBridgePage(req, {
      bookingId,
      orderId,
      app,
      paymentType,
      month: month || undefined,
      context: context || (paymentType === "monthly" ? "rent" : ""),
      statusToken: statusToken || undefined,
      appLaunchUrl: mobileAppStatusUrl || undefined,
      successAppLaunchUrl: successAppLaunchUrl || undefined,
      failureAppLaunchUrl: failureAppLaunchUrl || undefined,
      androidPendingIntentUrl: androidPendingIntentUrl || undefined,
      androidSuccessIntentUrl: androidSuccessIntentUrl || undefined,
      androidFailureIntentUrl: androidFailureIntentUrl || undefined,
    }),
  );
});
