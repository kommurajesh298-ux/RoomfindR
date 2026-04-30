import { requireOwnerOrAdminUser } from "../_shared/auth.ts";
import { errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import {
  normalize,
  syncPendingOwnerBankVerifications,
} from "../_shared/owner-bank-verification.ts";
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
  parseBearerToken(req.headers.get("authorization"));

const isServiceRoleRequest = (req: Request) => {
  const requestToken = getRequestToken(req);
  const serviceRoleKey =
    String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim() ||
    String(Deno.env.get("SERVICE_ROLE_KEY") || "").trim();

  return Boolean(requestToken && serviceRoleKey && requestToken === serviceRoleKey);
};

const resolveOwnerId = (
  role: "owner" | "admin",
  userId: string,
  requestedOwnerId: string,
) => {
  if (role === "admin" && requestedOwnerId) return requestedOwnerId;
  return userId;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedOwnerId = normalize(body.ownerId || body.owner_id);
    const limit = Math.max(1, Math.min(100, Number(body.limit || 20) || 20));

    let supabase: any;
    let ownerId = requestedOwnerId;

    if (isServiceRoleRequest(req)) {
      supabase = createServiceClient();
    } else {
      const auth = await requireOwnerOrAdminUser(req);
      supabase = auth.supabase;
      ownerId = resolveOwnerId(auth.role, auth.user.id, requestedOwnerId);
    }

    const results = await syncPendingOwnerBankVerifications(supabase, {
      ...(ownerId ? { ownerId } : {}),
      limit,
    });

    return jsonResponse(req, {
      success: true,
      owner_id: ownerId || null,
      scanned: results.length,
      updated: results.filter((result) => result.changed).length,
      results: results.map((result) => ({
        changed: result.changed,
        owner_id: result.verification?.owner_id || null,
        transfer_reference_id: result.verification?.transfer_reference_id || null,
        transfer_status: result.verification?.transfer_status || null,
      })),
    });
  } catch (error) {
    return errorResponse(
      req,
      500,
      error instanceof Error ? error.message : "Unable to sync owner bank verification status",
      "owner_bank_verification_sync_error",
    );
  }
});
