import { requireOwnerOrAdminUser } from "../_shared/auth.ts";
import { errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import {
  fetchCurrentOwnerBankVerification,
  fetchOwnerBankAccount,
  fetchOwnerBankVerificationHistory,
  insertOwnerNotification,
  normalize,
  OwnerBankDetailsInput,
  syncOwnerSummaryFields,
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
    const currentVerification = await fetchCurrentOwnerBankVerification(
      supabase,
      ownerId,
    );

    if (currentVerification?.transfer_status === "success") {
      return errorResponse(
        req,
        409,
        "Verified Rs 1 bank accounts cannot be reset",
        "owner_bank_already_verified",
      );
    }

    if (!hasBankDetailsInput(bankDetailsInput)) {
      if (role !== "admin") {
        return errorResponse(
          req,
          400,
          "New bank details are required to retry verification",
          "bank_details_required",
        );
      }

      const bankAccount = await fetchOwnerBankAccount(supabase, ownerId);
      const adminResetMessage =
        "Admin requested bank details reset. Please update your bank account to continue verification.";

      const { error: bankResetError } = await supabase
        .from("owner_bank_accounts")
        .update({
          verified: false,
          bank_verification_status: "pending",
          cashfree_beneficiary_id: null,
        })
        .eq("owner_id", ownerId);

      if (bankResetError) throw bankResetError;

      await syncOwnerSummaryFields(supabase, {
        ownerId,
        transferStatus: "pending",
        transferReferenceId: null,
        cashfreeBeneficiaryId: null,
        accountHolderName:
          currentVerification?.account_holder_name || bankAccount.account_holder_name,
        maskedAccountNumber:
          currentVerification?.bank_account_number ||
          (bankAccount.account_number_last4
            ? `XXXX${bankAccount.account_number_last4}`
            : "XXXX"),
        ifscCode: currentVerification?.ifsc_code || bankAccount.ifsc,
        bankName: bankAccount.bank_name || null,
        branchName: bankAccount.branch_name || null,
        city: bankAccount.city || null,
        verifiedAt: null,
      });

      const { error: verificationResetError } = await supabase
        .from("owner_bank_verification")
        .upsert(
          {
            id: currentVerification?.id,
            owner_id: ownerId,
            bank_account_number:
              currentVerification?.bank_account_number ||
              (bankAccount.account_number_last4
                ? `XXXX${bankAccount.account_number_last4}`
                : "XXXX"),
            ifsc_code: currentVerification?.ifsc_code || bankAccount.ifsc,
            account_holder_name:
              currentVerification?.account_holder_name ||
              bankAccount.account_holder_name,
            transfer_amount: currentVerification?.transfer_amount || 1,
            transfer_reference_id: currentVerification?.transfer_reference_id || null,
            provider_reference_id: null,
            transfer_status: "failed",
            status_message: adminResetMessage,
            last_attempt_at: new Date().toISOString(),
            verified_at: null,
          },
          { onConflict: "owner_id" },
        );

      if (verificationResetError) throw verificationResetError;

      await insertOwnerNotification(supabase, {
        userId: ownerId,
        title: "Update Bank Details",
        message: adminResetMessage,
        notificationType: "owner_bank_reset_requested",
        data: {
          owner_id: ownerId,
          requested_by: role,
        },
      });

      const verification = await fetchCurrentOwnerBankVerification(supabase, ownerId);
      const history = await fetchOwnerBankVerificationHistory(supabase, ownerId, 10);
      return jsonResponse(req, {
        success: true,
        reset_required: true,
        verification,
        history,
      });
    }

    const result = await verifyOwnerBankDetailsWithPennyDrop(
      supabase,
      ownerId,
      bankDetailsInput,
    );

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
      reset_required: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reset owner bank details";
    const status = /missing bearer token|invalid or expired auth token/i.test(message)
      ? 401
      : /owner or admin access required/i.test(message)
        ? 403
        : 500;
    return errorResponse(
      req,
      status,
      message,
      "reset_owner_bank_error",
    );
  }
});
