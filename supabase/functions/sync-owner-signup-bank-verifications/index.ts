import {
  normalize,
  syncPendingPreSignupBankVerifications,
} from "../_shared/owner-bank-verification.ts";
import {
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const parseBearerToken = (value: string | null): string => {
  const header = String(value || "").trim();
  if (!header) return "";

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) {
    return token.trim();
  }

  return header;
};

const getRequestToken = (req: Request) =>
  parseBearerToken(req.headers.get("x-supabase-auth")) ||
  parseBearerToken(req.headers.get("authorization")) ||
  parseBearerToken(req.headers.get("apikey"));

const isServiceRoleRequest = (req: Request) => {
  const requestToken = getRequestToken(req);
  const serviceRoleKey =
    String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim() ||
    String(Deno.env.get("SERVICE_ROLE_KEY") || "").trim();

  return Boolean(requestToken && serviceRoleKey && requestToken === serviceRoleKey);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  if (!isServiceRoleRequest(req)) {
    return errorResponse(req, 401, "Unauthorized");
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const limit = Math.max(1, Math.min(100, Number(body.limit || 50) || 50));
    const email = normalize(body.email || "");
    const transferId = normalize(body.transferId || body.transfer_id || "");

    const supabase = createServiceClient();
    const reconciled = await syncPendingPreSignupBankVerifications(supabase, {
      email: email || undefined,
      transferId: transferId || undefined,
      limit,
    });
    const results = reconciled.map((entry) => ({
      id: entry.verification?.id || null,
      transfer_reference_id: normalize(entry.verification?.transfer_reference_id) || null,
      changed: entry.changed,
      transfer_status: normalize(entry.verification?.transfer_status) || "pending",
    }));
    const updated = results.filter((entry) => entry.changed).length;

    return jsonResponse(req, {
      success: true,
      scanned: reconciled.length,
      updated,
      results,
    });
  } catch (error) {
    return errorResponse(
      req,
      500,
      error instanceof Error ? error.message : "Unable to sync signup bank verifications",
      "signup_bank_verification_sync_failed",
    );
  }
});
