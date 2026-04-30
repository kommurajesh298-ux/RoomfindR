import { errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const normalize = (value: unknown) => String(value || "").trim();

const parseBearerToken = (value: string | null): string => {
  const header = normalize(value);
  if (!header) return "";

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) {
    return normalize(token);
  }

  return header;
};

const getRequestToken = (req: Request, body?: Record<string, unknown>) =>
  parseBearerToken(req.headers.get("x-supabase-auth")) ||
  parseBearerToken(req.headers.get("authorization")) ||
  parseBearerToken(req.headers.get("apikey")) ||
  parseBearerToken(String(body?.internal_key || body?.service_role_key || ""));

const getRuntimeServiceRoleKey = () =>
  normalize(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ||
  normalize(Deno.env.get("SERVICE_ROLE_KEY"));

const getAllowedAutomationTokens = () =>
  [
    normalize(Deno.env.get("ROOMFINDR_INTERNAL_AUTOMATION_KEY")),
    normalize(Deno.env.get("INTERNAL_AUTOMATION_KEY")),
    getRuntimeServiceRoleKey(),
  ].filter(Boolean);

const getInternalFunctionUrl = (functionName: string) => {
  const supabaseUrl =
    normalize(Deno.env.get("SUPABASE_URL")) ||
    normalize(Deno.env.get("LOCAL_SUPABASE_URL"));

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL");
  }

  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}`;
};

const getServiceRoleHeaders = (serviceRoleKey: string) => {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceRoleKey}`,
    "x-supabase-auth": `Bearer ${serviceRoleKey}`,
    "apikey": serviceRoleKey,
  };
};

const fetchProcessingSettlements = async (supabase: any, limit: number) => {
  const { data, error } = await supabase
    .from("settlements")
    .select("id, booking_id, payment_id, owner_id, status, provider_transfer_id, provider_reference")
    .in("status", ["PENDING", "PROCESSING"])
    .not("provider_transfer_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
};

const syncSettlement = async (settlementId: string, serviceRoleKey: string) => {
  const response = await fetch(getInternalFunctionUrl("cashfree-settlement"), {
    method: "POST",
    headers: getServiceRoleHeaders(serviceRoleKey),
    body: JSON.stringify({ settlementId, internal_key: serviceRoleKey }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      normalize((payload as Record<string, unknown>)?.error) ||
      normalize((payload as Record<string, unknown>)?.message) ||
      `cashfree-settlement returned ${response.status}`;
    throw new Error(message);
  }

  return payload as Record<string, unknown>;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = createServiceClient();
    const requestToken = getRequestToken(req, body);
    const allowedTokens = getAllowedAutomationTokens();
    const serviceRoleKey = getRuntimeServiceRoleKey();

    if (!requestToken || !allowedTokens.includes(requestToken)) {
      return errorResponse(req, 401, "Unauthorized");
    }

    if (!serviceRoleKey) {
      return errorResponse(req, 500, "Missing SUPABASE_SERVICE_ROLE_KEY");
    }

    const limit = Math.max(1, Math.min(50, Number(body.limit || 20) || 20));
    const settlements = await fetchProcessingSettlements(supabase, limit);

    const results = [] as Array<Record<string, unknown>>;
    for (const settlement of settlements) {
      const previousStatus = normalize(settlement.status).toUpperCase();

      try {
        const synced = await syncSettlement(normalize(settlement.id), serviceRoleKey);
        const nextSettlement = (synced.settlement || {}) as Record<string, unknown>;
        const nextStatus = normalize(nextSettlement.status).toUpperCase();

        results.push({
          settlement_id: settlement.id,
          booking_id: settlement.booking_id,
          changed: Boolean(nextStatus && nextStatus !== previousStatus),
          previous_status: previousStatus || null,
          next_status: nextStatus || previousStatus || null,
          provider_transfer_id: nextSettlement.provider_transfer_id || settlement.provider_transfer_id || null,
          provider_reference: nextSettlement.provider_reference || settlement.provider_reference || null,
        });
      } catch (error) {
        results.push({
          settlement_id: settlement.id,
          booking_id: settlement.booking_id,
          changed: false,
          previous_status: previousStatus || null,
          next_status: previousStatus || null,
          error: error instanceof Error ? error.message : "Unable to sync settlement",
        });
      }
    }

    return jsonResponse(req, {
      success: true,
      scanned: settlements.length,
      updated: results.filter((result) => result.changed).length,
      results,
    });
  } catch (error) {
    return errorResponse(
      req,
      500,
      error instanceof Error ? error.message : "Unable to sync processing settlements",
      "processing_settlement_sync_error",
    );
  }
});
