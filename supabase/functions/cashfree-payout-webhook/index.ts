// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  constantTimeEqual,
  hmacSha256Base64,
  verifyCashfreeSignature,
} from "../_shared/crypto.ts";
import {
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import {
  applyPreSignupBankVerificationTransferStatus,
  applyOwnerBankVerificationTransferStatus,
  fetchPreSignupBankVerificationByTransferReference,
  fetchOwnerBankVerificationByTransferReference,
} from "../_shared/owner-bank-verification.ts";
import { buildPayoutNotificationCopy } from "../_shared/notification-copy.ts";

const lower = (value: unknown) => String(value || "").toLowerCase();
const upper = (value: unknown) => String(value || "").toUpperCase();
const toAmount = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

const getSupabaseClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("LOCAL_SUPABASE_URL");
  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
};

const getWebhookSecret = () => {
  const secret =
    String(Deno.env.get("CASHFREE_PAYOUT_WEBHOOK_SECRET") || "").trim() ||
    String(Deno.env.get("CASHFREE_PAYOUT_CLIENT_SECRET") || "").trim() ||
    String(Deno.env.get("CASHFREE_CLIENT_SECRET") || "").trim();

  if (!secret) throw new Error("Missing CASHFREE_PAYOUT_WEBHOOK_SECRET");
  return secret;
};

const parseRawPayload = async (req: Request) => {
  const rawBody = await req.text();
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return {
      rawBody,
      payload: Object.fromEntries(new URLSearchParams(rawBody)),
    };
  }

  try {
    return {
      rawBody,
      payload: JSON.parse(rawBody || "{}"),
    };
  } catch {
    return {
      rawBody,
      payload: {},
    };
  }
};

const normalizeLegacyPayload = (payload: Record<string, unknown>) => {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload || {})) {
    output[key] = String(value);
  }
  return output;
};

const verifyLegacySignature = async (
  payload: Record<string, unknown>,
  secret: string,
) => {
  const normalized = normalizeLegacyPayload(payload);
  const providedSignature = String(normalized.signature || "");
  if (!providedSignature) return false;

  const entries = Object.entries(normalized)
    .filter(([key]) => key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right));
  const message = entries.map(([, value]) => value).join("");
  const computedSignature = await hmacSha256Base64(secret, message);
  return constantTimeEqual(computedSignature, providedSignature);
};

const verifyWebhook = async (
  req: Request,
  rawBody: string,
  payload: Record<string, unknown>,
  secret: string,
) => {
  const signature = String(req.headers.get("x-webhook-signature") || "").trim();
  const timestamp = String(req.headers.get("x-webhook-timestamp") || "").trim();

  if (signature && timestamp) {
    return verifyCashfreeSignature({
      rawBody,
      timestamp,
      signature,
      secret,
      maxAgeSeconds: 600,
    });
  }

  return verifyLegacySignature(payload, secret);
};

const extractEventDetails = (payload: Record<string, unknown>) => {
  const data = (payload?.data as Record<string, unknown>) || {};
  const transfer = (data?.transfer as Record<string, unknown>) || data;

  return {
    eventType: upper(
      payload?.type ||
        payload?.event_type ||
        payload?.eventType ||
        data?.event_type,
    ),
    transferId: String(
      transfer?.transfer_id ||
        transfer?.transferId ||
        payload?.transfer_id ||
        payload?.transferId ||
        "",
    ).trim(),
    transferStatus: upper(
      transfer?.status ||
        transfer?.transfer_status ||
        transfer?.transferStatus ||
        payload?.status ||
        payload?.transfer_status,
    ),
    statusCode: upper(
      transfer?.status_code || payload?.status_code || data?.status_code,
    ),
    providerReference: String(
      transfer?.cf_transfer_id ||
        transfer?.reference_id ||
        payload?.cf_transfer_id ||
        payload?.reference_id ||
        "",
    ).trim() || null,
  };
};

const resolveTransferState = (details: {
  eventType: string;
  transferStatus: string;
  statusCode: string;
}) => {
  const candidates = [
    details.eventType,
    details.transferStatus,
    details.statusCode,
  ].filter(Boolean);

  if (
    candidates.some((value) =>
      [
        "TRANSFER_SUCCESS",
        "TRANSFER_SUCCESS_WEBHOOK",
        "TRANSFER_COMPLETED",
        "SUCCESS",
        "COMPLETED",
        "PROCESSED",
      ].includes(value),
    )
  ) {
    return "COMPLETED" as const;
  }

  if (
    candidates.some(
      (value) =>
        value.includes("FAIL") ||
        value.includes("REJECT") ||
        value.includes("REVERSE") ||
        ["FAILED", "CANCELLED", "TERMINATED"].includes(value),
    )
  ) {
    return "FAILED" as const;
  }

  return "PROCESSING" as const;
};

const fetchSettlement = async (supabase: any, transferId: string) => {
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("provider_transfer_id", transferId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const fetchRefund = async (supabase: any, transferId: string) => {
  const { data, error } = await supabase
    .from("refunds")
    .select("*")
    .eq("provider_refund_id", transferId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const fetchWallet = async (supabase: any, ownerId: string) => {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const fetchWalletTransaction = async (supabase: any, settlementId: string) => {
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("*")
    .eq("settlement_id", settlementId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const fetchLatestWallet = async (supabase: any, walletId: string) => {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("id", walletId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Wallet not found");
  return data;
};

const updateWalletBalances = async (
  supabase: any,
  walletId: string,
  previousStatus: string | null,
  nextStatus: "pending" | "completed" | "failed",
  amount: number,
) => {
  const wallet = await fetchLatestWallet(supabase, walletId);
  let available = toAmount(wallet.available_balance);
  let pending = toAmount(wallet.pending_balance);

  const from = lower(previousStatus);
  const to = lower(nextStatus);
  if (from === to) return wallet;

  if (from === "pending") {
    pending = Math.max(0, pending - amount);
  }

  if (from === "completed") {
    available = Math.max(0, available - amount);
  }

  if (to === "pending") {
    pending += amount;
  }

  if (to === "completed") {
    available += amount;
  }

  const { data, error } = await supabase
    .from("wallets")
    .update({
      available_balance: available,
      pending_balance: pending,
    })
    .eq("id", walletId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

const syncSettlementWallet = async (
  supabase: any,
  settlement: any,
  transferId: string,
  nextStatus: "pending" | "completed" | "failed",
) => {
  const wallet = await fetchWallet(supabase, settlement.owner_id);
  if (!wallet) return;

  const walletTxn = await fetchWalletTransaction(supabase, settlement.id);
  const amount = toAmount(settlement.net_payable || settlement.total_amount);
  const linkedPaymentId = String(settlement.payment_id || "").trim() || null;

  if (!walletTxn) {
    const { error } = await supabase.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      settlement_id: settlement.id,
      payment_id: linkedPaymentId,
      amount,
      type: "credit",
      status: nextStatus,
      reference: transferId,
    });

    if (error) throw error;
    await updateWalletBalances(supabase, wallet.id, null, nextStatus, amount);
    return;
  }

  const previousStatus = lower(walletTxn.status);
  const currentPaymentId = String(walletTxn.payment_id || "").trim() || null;
  const needsUpdate =
    previousStatus !== nextStatus ||
    String(walletTxn.reference || "") !== transferId ||
    Boolean(linkedPaymentId && currentPaymentId !== linkedPaymentId);

  if (needsUpdate) {
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      reference: transferId,
    };

    if (linkedPaymentId && currentPaymentId !== linkedPaymentId) {
      updatePayload.payment_id = linkedPaymentId;
    }

    const { error } = await supabase
      .from("wallet_transactions")
      .update(updatePayload)
      .eq("id", walletTxn.id);

    if (error) throw error;
  }

  if (previousStatus !== nextStatus) {
    await updateWalletBalances(supabase, wallet.id, previousStatus, nextStatus, amount);
  }
};

const insertNotification = async (
  supabase: any,
  input: { userId: string; title: string; message: string; type: string; data: Record<string, unknown> },
) => {
  await supabase.from("notifications").insert({
    user_id: input.userId,
    title: input.title,
    message: input.message,
    notification_type: input.type,
    status: "queued",
    data: input.data,
  });
};

const fetchBookingNotificationState = async (supabase: any, bookingId: string) => {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, status, check_in_date, customer_name, room_number, currency")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const bookingHasCheckedIn = (booking: any) => {
  const bookingStatus = lower(booking?.status);
  return Boolean(String(booking?.check_in_date || "").trim()) ||
    ["checked-in", "checked_in", "active", "ongoing"].includes(bookingStatus);
};

const hasSettlementNotification = async (
  supabase: any,
  ownerId: string,
  settlementId: string,
  notificationType: string,
) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("notification_type, type, data")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  return (data || []).some((notification: any) =>
    lower(notification?.notification_type || notification?.type) === lower(notificationType) &&
    String(notification?.data?.settlement_id || "").trim() === settlementId
  );
};

const queueSettlementNotificationIfEligible = async (
  supabase: any,
  settlement: any,
  nextStatus: "COMPLETED" | "FAILED",
) => {
  if (!settlement?.owner_id || !settlement?.booking_id || !settlement?.id) {
    return;
  }

  const booking = await fetchBookingNotificationState(supabase, settlement.booking_id);
  if (!bookingHasCheckedIn(booking)) {
    return;
  }

  const notificationType = nextStatus === "COMPLETED"
    ? "settlement_completed"
    : "settlement_failed";

  if (await hasSettlementNotification(supabase, settlement.owner_id, String(settlement.id), notificationType)) {
    return;
  }

  const notificationCopy = buildPayoutNotificationCopy({
    paymentType: settlement.payment_type,
    customerName: booking.customer_name,
    roomNumber: booking.room_number,
    amount: settlement.net_payable || settlement.total_amount,
    currency: booking.currency,
    status: nextStatus,
  });

  await insertNotification(supabase, {
    userId: settlement.owner_id,
    title: notificationCopy.title,
    message: notificationCopy.message,
    type: notificationType,
    data: { settlement_id: settlement.id },
  });
};

const syncBookingSettlementStatus = async (
  supabase: any,
  bookingId: string,
  nextStatus: "PROCESSING" | "COMPLETED" | "FAILED",
) => {
  await supabase.from("bookings").update({
    settlement_status: lower(nextStatus),
    payout_status:
      nextStatus === "COMPLETED"
        ? "success"
        : nextStatus === "FAILED"
          ? "failed"
          : "processing",
  }).eq("id", bookingId);
};

const applySettlementUpdate = async (
  supabase: any,
  settlement: any,
  details: {
    transferId: string;
    providerReference: string | null;
    nextStatus: "PROCESSING" | "COMPLETED" | "FAILED";
  },
) => {
  const currentStatus = upper(settlement.status);
  if (currentStatus === "COMPLETED" && details.nextStatus !== "COMPLETED") {
    return false;
  }

  const { error } = await supabase
    .from("settlements")
    .update({
      status: details.nextStatus,
      payout_status:
        details.nextStatus === "COMPLETED"
          ? "success"
          : details.nextStatus === "FAILED"
            ? "failed"
            : "processing",
      provider_transfer_id: details.transferId,
      provider_reference: details.providerReference || settlement.provider_reference || null,
      processed_at: details.nextStatus === "COMPLETED" ? new Date().toISOString() : null,
    })
    .eq("id", settlement.id);

  if (error) throw error;

  await syncBookingSettlementStatus(
    supabase,
    settlement.booking_id,
    details.nextStatus,
  );

  const walletStatus =
    details.nextStatus === "COMPLETED"
      ? "completed"
      : details.nextStatus === "FAILED"
        ? "failed"
        : "pending";

  await syncSettlementWallet(
    supabase,
    settlement,
    details.transferId,
    walletStatus,
  );

  if (settlement.owner_id && currentStatus !== details.nextStatus) {
    if (details.nextStatus === "COMPLETED" || details.nextStatus === "FAILED") {
      await queueSettlementNotificationIfEligible(
        supabase,
        settlement,
        details.nextStatus,
      );
    }
  }

  return true;
};

const mapRefundState = (nextStatus: "PROCESSING" | "COMPLETED" | "FAILED") => {
  if (nextStatus === "COMPLETED") return "SUCCESS";
  if (nextStatus === "FAILED") return "FAILED";
  return "PROCESSING";
};

const mapLegacyRefundState = (nextStatus: "PROCESSING" | "COMPLETED" | "FAILED") => {
  if (nextStatus === "COMPLETED") return "success";
  if (nextStatus === "FAILED") return "failed";
  return "pending";
};

const applyRefundUpdate = async (
  supabase: any,
  refund: any,
  nextStatus: "PROCESSING" | "COMPLETED" | "FAILED",
) => {
  const refundStatus = mapRefundState(nextStatus);
  const legacyRefundStatus = mapLegacyRefundState(nextStatus);
  const update: Record<string, unknown> = {
    status: legacyRefundStatus,
    refund_status: refundStatus,
  };

  if (refundStatus === "SUCCESS") {
    update.processed_at = new Date().toISOString();
  }

  const { error } = await supabase.from("refunds").update(update).eq("id", refund.id);
  if (error) throw error;

  if (refundStatus === "SUCCESS") {
    await supabase
      .from("payments")
      .update({ status: "refunded", payment_status: "refunded" })
      .eq("id", refund.payment_id);
    await supabase
      .from("bookings")
      .update({ status: "refunded", payment_status: "refunded" })
      .eq("id", refund.booking_id);
  }
};

export const handleCashfreePayoutWebhook = async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const { rawBody, payload } = await parseRawPayload(req);
    const secret = getWebhookSecret();
    const verified = await verifyWebhook(req, rawBody, payload, secret);

    if (!verified) {
      return errorResponse(req, 401, "Invalid signature");
    }

    const details = extractEventDetails(payload);
    if (!details.transferId) {
      return jsonResponse(req, { success: true, ignored: true });
    }

    const supabase = getSupabaseClient();
    const nextStatus = resolveTransferState(details);

    const settlement = await fetchSettlement(supabase, details.transferId);
    if (settlement) {
      await applySettlementUpdate(supabase, settlement, {
        transferId: details.transferId,
        providerReference: details.providerReference,
        nextStatus,
      });
      return jsonResponse(req, { success: true, kind: "settlement" });
    }

    const refund = await fetchRefund(supabase, details.transferId);
    if (refund) {
      await applyRefundUpdate(supabase, refund, nextStatus);
      return jsonResponse(req, { success: true, kind: "refund" });
    }

    const verification = await fetchOwnerBankVerificationByTransferReference(
      supabase,
      details.transferId,
    );
    if (verification) {
      const bankStatus =
        nextStatus === "COMPLETED"
          ? "success"
          : nextStatus === "FAILED"
            ? "failed"
            : "pending";

      const updatedVerification = await applyOwnerBankVerificationTransferStatus(
        supabase,
        {
          ownerId: verification.owner_id,
          transferReferenceId: details.transferId,
          providerReferenceId: details.providerReference,
          transferStatus: bankStatus,
        },
      );

      if (bankStatus === "success") {
        await insertNotification(supabase, {
          userId: verification.owner_id,
          title: "Bank Account Verified",
          message: "Your bank account is verified. Your owner account is now active.",
          type: "owner_bank_verification_success",
          data: {
            verification_id: updatedVerification.id,
            transfer_reference_id: details.transferId,
          },
        });
      } else if (bankStatus === "failed") {
        await insertNotification(supabase, {
          userId: verification.owner_id,
          title: "Bank Verification Failed",
          message: "₹1 verification transfer failed. Please update your bank details and try again.",
          type: "owner_bank_verification_failed",
          data: {
            verification_id: updatedVerification.id,
            transfer_reference_id: details.transferId,
          },
        });
      }

      return jsonResponse(req, { success: true, kind: "owner_bank_verification" });
    }

    const preSignupVerification = await fetchPreSignupBankVerificationByTransferReference(
      supabase,
      details.transferId,
    );
    if (preSignupVerification) {
      const bankStatus =
        nextStatus === "COMPLETED"
          ? "success"
          : nextStatus === "FAILED"
            ? "failed"
            : "pending";

      await applyPreSignupBankVerificationTransferStatus(supabase, {
        verification: preSignupVerification,
        transferReferenceId: details.transferId,
        transferStatus: bankStatus,
        providerReferenceId: details.providerReference,
      });

      return jsonResponse(req, { success: true, kind: "owner_signup_bank_verification" });
    }

    return jsonResponse(req, { success: true, ignored: true });
  } catch (error) {
    return errorResponse(
      req,
      400,
      error instanceof Error ? error.message : "Webhook failure",
    );
  }
};

if (import.meta.main) {
  Deno.serve((req: Request) => handleCashfreePayoutWebhook(req));
}
