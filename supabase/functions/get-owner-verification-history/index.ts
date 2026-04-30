import { requireOwnerOrAdminUser } from "../_shared/auth.ts";
import { errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import {
  fetchCurrentOwnerBankVerification,
  fetchOwnerBankVerificationHistory,
  normalize,
  syncPendingOwnerBankVerifications,
} from "../_shared/owner-bank-verification.ts";

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
    const { supabase, user, role } = await requireOwnerOrAdminUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ownerId = resolveOwnerId(
      role,
      user.id,
      normalize(body.ownerId || body.owner_id),
    );
    const limit = Math.max(
      1,
      Math.min(50, Number(body.limit || 10) || 10),
    );

    await syncPendingOwnerBankVerifications(supabase, {
      ownerId,
      limit: 1,
    });

    const verification = await fetchCurrentOwnerBankVerification(supabase, ownerId);
    const history = await fetchOwnerBankVerificationHistory(supabase, ownerId, limit);

    return jsonResponse(req, {
      success: true,
      verification,
      history,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to fetch owner verification history";
    const status = /missing bearer token|invalid or expired auth token/i.test(message)
      ? 401
      : /owner or admin access required/i.test(message)
        ? 403
        : 500;
    return errorResponse(
      req,
      status,
      message,
      "owner_verification_history_error",
    );
  }
});
