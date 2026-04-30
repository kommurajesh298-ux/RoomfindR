import { requireOwnerOrAdminUser } from "../_shared/auth.ts";
import { errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import {
  normalize,
  OwnerBankDetailsInput,
  runOwnerBankVerificationFlow,
  verifyOwnerBankDetailsWithPennyDrop,
} from "../_shared/owner-bank-verification.ts";

const resolveOwnerId = (
  role: "owner" | "admin",
  userId: string,
  requestedOwnerId: string,
) => {
  if (role === "admin" && requestedOwnerId) return requestedOwnerId;
  return userId;
};

const hasBankDetailsInput = (input: OwnerBankDetailsInput) =>
  Boolean(
    normalize(input.accountHolderName) ||
      normalize(input.accountNumber) ||
      normalize(input.confirmAccountNumber) ||
      normalize(input.ifsc),
  );

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
    const forceNewBeneficiary =
      String(body.forceNewBeneficiary || body.force_new_beneficiary || "").toLowerCase() === "true" ||
      body.forceNewBeneficiary === true ||
      body.force_new_beneficiary === true;
    const bankDetailsInput: OwnerBankDetailsInput = {
      accountHolderName: String(
        body.account_holder_name || body.accountHolderName || "",
      ),
      accountNumber: String(body.account_number || body.accountNumber || ""),
      confirmAccountNumber: String(
        body.confirm_account_number || body.confirmAccountNumber || "",
      ),
      ifsc: String(body.ifsc || body.ifsc_code || ""),
    };

    const hasBankDetails = hasBankDetailsInput(bankDetailsInput);
    const result = hasBankDetails
      ? await verifyOwnerBankDetailsWithPennyDrop(
          supabase,
          ownerId,
          bankDetailsInput,
        )
      : await runOwnerBankVerificationFlow(supabase, ownerId, {
          forceNewBeneficiary,
        });

    if (result.error) {
      return errorResponse(
        req,
        400,
        result.error,
        "bank_verification_failed",
      );
    }

    return jsonResponse(req, {
      success: true,
      verification: result.verification,
      history: result.history,
      transfer_id: result.transferId,
      transfer: result.transfer,
      message: result.alreadyVerified
        ? "Owner bank account is already verified"
        : result.verification?.status_message || "Bank verification started",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to verify owner bank account";

    return errorResponse(
      req,
      400,
      message,
      "owner_bank_verification_error",
    );
  }
});
