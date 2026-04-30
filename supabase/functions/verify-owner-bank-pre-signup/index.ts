import {
  createCashfreeBeneficiary,
} from "../_shared/cashfree.ts";
import {
  assertAllowedOrigin,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import { fetchPreSignupLicenseDocument } from "../_shared/owner-license-document.ts";
import {
  accountNameRegex,
  accountRegex,
  applyPreSignupBankVerificationTransferStatus,
  buildPreSignupBeneficiaryId,
  buildPreSignupTransferId,
  createOwnerVerificationTransfer,
  encryptOwnerBankAccount,
  fetchLatestPreSignupBankVerification,
  fetchPreSignupBankVerificationByTransferReference,
  getPreSignupPendingRetryGraceMs,
  getPreSignupVerificationAttemptLimit,
  getCashfreeSandboxBankValidationMessage,
  ifscRegex,
  isDuplicateBeneficiaryError,
  lower,
  normalize,
  normalizeAccountNumber,
  normalizeIfsc,
  reconcilePreSignupBankVerification,
  resolveIfscDetails,
  resolveVerificationMessage,
  resolveVerificationTransferStatus,
  syncPreSignupBankVerificationPhone,
  waitForConfirmedBeneficiary,
} from "../_shared/owner-bank-verification.ts";
import {
  normalizeEmail,
  normalizePhone,
  validateEmail,
} from "../_shared/security.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type PreSignupPayload = {
  name?: string;
  email?: string;
  phone?: string;
  accountHolderName?: string;
  accountNumber?: string;
  confirmAccountNumber?: string;
  ifsc?: string;
  transferId?: string;
  transfer_id?: string;
  statusOnly?: boolean;
};

type TransferStatus = "pending" | "success" | "failed";
const LICENSE_REQUIRED_MESSAGE =
  "Upload your business license before verifying bank details.";

const buildVerificationResponse = (
  verification: Record<string, unknown> | null | undefined,
  fallbackMessage?: string,
  options?: {
    alreadyVerified?: boolean;
  },
) => {
  const transferStatus = resolveVerificationTransferStatus(
    verification?.transfer_status,
    verification,
  );
  const statusMessage =
    normalize(verification?.status_message) ||
    resolveVerificationMessage(transferStatus, fallbackMessage || null);

  return {
    success: true,
    message: statusMessage,
    verification: {
      transfer_status: transferStatus,
      status_message: statusMessage,
    },
    transfer_id: normalize(verification?.transfer_reference_id) || null,
    already_verified: options?.alreadyVerified === true,
  };
};

const persistVerificationAttempt = async (
  supabase: any,
  input: {
    existingId?: string | null;
    email: string;
    phone: string;
    name?: string | null;
    accountHolderName: string;
    encryptedAccountNumber: string;
    accountLast4: string;
    accountNumberHash: string;
    ifsc: string;
    bankName?: string | null;
    branchName?: string | null;
    city?: string | null;
    beneficiaryId?: string | null;
    transferId?: string | null;
    providerReferenceId?: string | null;
    transferStatus: TransferStatus;
    statusMessage?: string | null;
    attemptCount: number;
  }) => {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("owner_signup_bank_verifications")
    .upsert(
      {
        id: input.existingId || undefined,
        email: input.email,
        phone: input.phone,
        full_name: input.name || null,
        account_holder_name: input.accountHolderName,
        account_number_encrypted: input.encryptedAccountNumber,
        account_number_last4: input.accountLast4,
        account_number_hash: input.accountNumberHash,
        ifsc: input.ifsc,
        bank_name: input.bankName || null,
        branch_name: input.branchName || null,
        city: input.city || null,
        cashfree_beneficiary_id: input.beneficiaryId || null,
        transfer_reference_id: input.transferId || null,
        provider_reference_id: input.providerReferenceId || null,
        transfer_status: input.transferStatus,
        status_message: resolveVerificationMessage(
          input.transferStatus,
          input.statusMessage || null,
        ),
        attempt_count: input.attemptCount,
        last_attempt_at: now,
        verified_at: input.transferStatus === "success" ? now : null,
      },
      { onConflict: "email" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  if (!assertAllowedOrigin(req)) {
    return errorResponse(req, 403, "Origin is not allowed", "origin_not_allowed");
  }

  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed", "method_not_allowed");
  }

  try {
    const payload = (await req.json().catch(() => ({}))) as PreSignupPayload;
    const email = normalizeEmail(String(payload.email ?? ""));
    const phone = normalizePhone(String(payload.phone ?? ""));
    const name = normalize(payload.name ?? "");
    const accountHolderName = normalize(payload.accountHolderName ?? "");
    const accountNumber = normalizeAccountNumber(payload.accountNumber ?? "");
    const confirmAccountNumber = normalizeAccountNumber(
      payload.confirmAccountNumber ?? "",
    );
    const ifsc = normalizeIfsc(payload.ifsc ?? "");
    const transferId = normalize(payload.transferId || payload.transfer_id || "");
    const statusOnly =
      payload.statusOnly === true ||
      String(payload.statusOnly || "").trim().toLowerCase() === "true";

    if (!validateEmail(email)) {
      return errorResponse(req, 400, "Invalid email format", "invalid_email");
    }

    const supabase = createServiceClient();
    const licenseDocument = await fetchPreSignupLicenseDocument(supabase, email);

    if (!licenseDocument || licenseDocument.consumed_at) {
      return errorResponse(
        req,
        400,
        LICENSE_REQUIRED_MESSAGE,
        "license_document_required",
      );
    }

    if (statusOnly) {
      const verificationByTransferId = transferId
        ? await fetchPreSignupBankVerificationByTransferReference(
            supabase,
            transferId,
          )
        : null;
      const verification =
        verificationByTransferId &&
          lower(verificationByTransferId.email) === email
          ? verificationByTransferId
          : await fetchLatestPreSignupBankVerification(supabase, email);

      if (!verification || lower(verification.email) !== email) {
        return errorResponse(
          req,
          404,
          "No pending bank verification found for this email.",
          "bank_verification_not_found",
        );
      }

      const reconciled = await reconcilePreSignupBankVerification(
        supabase,
        verification,
      );
      let resolvedVerification =
        (reconciled.verification as Record<string, unknown> | null) ||
        verification;
      const resolvedStatus = resolveVerificationTransferStatus(
        resolvedVerification?.transfer_status,
        resolvedVerification,
      );
      if (phone && resolvedStatus === "success") {
        resolvedVerification = await syncPreSignupBankVerificationPhone(
          supabase,
          resolvedVerification,
          phone,
        );
      }

      return jsonResponse(
        req,
        buildVerificationResponse(resolvedVerification),
      );
    }

    if (!phone) {
      return errorResponse(req, 400, "Valid phone number is required", "invalid_phone");
    }

    if (!accountNameRegex.test(accountHolderName)) {
      return errorResponse(
        req,
        400,
        "Invalid account holder name",
        "invalid_account_holder",
      );
    }

    if (!accountRegex.test(accountNumber)) {
      return errorResponse(req, 400, "Invalid account number", "invalid_account");
    }

    if (accountNumber !== confirmAccountNumber) {
      return errorResponse(req, 400, "Account numbers do not match", "account_mismatch");
    }

    if (!ifscRegex.test(ifsc)) {
      return errorResponse(req, 400, "Invalid IFSC format", "invalid_ifsc");
    }

    const { data: existingUserId, error: existingUserError } = await supabase.rpc(
      "get_auth_user_id_by_email",
      { p_email: email },
    );
    if (existingUserError) throw existingUserError;
    if (existingUserId) {
      return errorResponse(req, 409, "Account already exists", "account_exists");
    }

    const encrypted = await encryptOwnerBankAccount(accountNumber, ifsc);
    const accountLast4 = accountNumber.slice(-4);

    const { data: duplicateOwner } = await supabase
      .from("owner_bank_accounts")
      .select("owner_id")
      .eq("account_number_hash", encrypted.accountNumberHash)
      .limit(1)
      .maybeSingle();

    if (duplicateOwner?.owner_id) {
      return errorResponse(
        req,
        400,
        "This bank account is already linked to another owner.",
        "bank_duplicate",
      );
    }

    const { data: duplicateSignup } = await supabase
      .from("owner_signup_bank_verifications")
      .select("email")
      .eq("account_number_hash", encrypted.accountNumberHash)
      .eq("transfer_status", "success")
      .is("consumed_at", null)
      .limit(1)
      .maybeSingle();

    if (duplicateSignup?.email && lower(duplicateSignup.email) !== email) {
      return errorResponse(
        req,
        400,
        "This bank account is already linked to another owner.",
        "bank_duplicate",
      );
    }

    const existingVerification = await fetchLatestPreSignupBankVerification(
      supabase,
      email,
    );
    const sameAccount =
      existingVerification?.account_number_hash === encrypted.accountNumberHash &&
      normalizeIfsc(existingVerification?.ifsc || "") === ifsc;

    if (
      existingVerification?.transfer_status === "success" &&
      !existingVerification?.consumed_at &&
      sameAccount
    ) {
      const syncedVerification = await syncPreSignupBankVerificationPhone(
        supabase,
        existingVerification,
        phone,
      );
      return jsonResponse(
        req,
        buildVerificationResponse(syncedVerification, undefined, {
          alreadyVerified: true,
        }),
      );
    }

    if (existingVerification?.transfer_status === "pending") {
      const pendingSince =
        existingVerification.last_attempt_at || existingVerification.created_at;
      const pendingAgeMs = pendingSince
        ? Date.now() - Date.parse(pendingSince)
        : 0;

      if (sameAccount) {
        const reconciled = await reconcilePreSignupBankVerification(
          supabase,
          existingVerification,
        );
        const currentVerification =
          (reconciled.verification as Record<string, unknown> | null) ||
          existingVerification;
        const currentTransferStatus = resolveVerificationTransferStatus(
          currentVerification?.transfer_status,
          currentVerification,
        );

        if (
          currentTransferStatus !== "pending" ||
          pendingAgeMs < getPreSignupPendingRetryGraceMs()
        ) {
          return jsonResponse(
            req,
            buildVerificationResponse(currentVerification),
          );
        }
      }

      if (pendingAgeMs < getPreSignupPendingRetryGraceMs()) {
        return errorResponse(
          req,
          409,
          "Bank verification is already in progress. Please wait for completion.",
          "bank_verification_pending",
        );
      }
    }

    const sandboxValidationMessage = getCashfreeSandboxBankValidationMessage(
      accountNumber,
      ifsc,
    );
    if (sandboxValidationMessage) {
      return errorResponse(
        req,
        400,
        sandboxValidationMessage,
        "cashfree_test_bank_details_required",
      );
    }

    const attemptCount = Number(existingVerification?.attempt_count || 0);
    if (attemptCount >= getPreSignupVerificationAttemptLimit()) {
      return errorResponse(
        req,
        429,
        "Maximum 3 bank verification attempts are allowed for this owner.",
        "bank_attempts_exceeded",
      );
    }

    const ifscDetails = await resolveIfscDetails(ifsc);
    const beneficiaryId = sameAccount
      ? normalize(existingVerification?.cashfree_beneficiary_id) ||
        buildPreSignupBeneficiaryId(email)
      : buildPreSignupBeneficiaryId(email);

    let createdTransferId: string | null = null;
    let confirmedBeneficiaryId = beneficiaryId;
    let providerReferenceId: string | null = null;

    try {
      try {
        await createCashfreeBeneficiary({
          beneId: beneficiaryId,
          name: name || accountHolderName,
          email,
          phone: phone.replace(/\D/g, "").slice(-10),
          bankAccount: accountNumber,
          ifsc,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!isDuplicateBeneficiaryError(message)) {
          throw error;
        }
      }

      const confirmedBeneficiary = await waitForConfirmedBeneficiary({
        beneficiaryId,
        accountNumber,
        ifsc,
      });

      confirmedBeneficiaryId =
        normalize(
          confirmedBeneficiary?.beneficiary_id ||
            confirmedBeneficiary?.beneficiaryId,
        ) || beneficiaryId;

      createdTransferId = buildPreSignupTransferId(email);
      const transfer = await createOwnerVerificationTransfer({
        transferId: createdTransferId,
        beneficiaryId: confirmedBeneficiaryId,
        amount: 1,
      });

      const savedVerification = await persistVerificationAttempt(supabase, {
        existingId: existingVerification?.id,
        email,
        phone,
        name: name || null,
        accountHolderName,
        encryptedAccountNumber: encrypted.encryptedAccountNumber,
        accountLast4,
        accountNumberHash: encrypted.accountNumberHash,
        ifsc,
        bankName: ifscDetails.bankName || null,
        branchName: ifscDetails.branchName || null,
        city: ifscDetails.city || null,
        beneficiaryId: confirmedBeneficiaryId,
        transferId: createdTransferId,
        providerReferenceId: transfer.providerReferenceId || null,
        transferStatus: transfer.status as TransferStatus,
        statusMessage: resolveVerificationMessage(transfer.status as TransferStatus),
        attemptCount: attemptCount + 1,
      });

      const persistedVerification = transfer.status === "pending"
        ? savedVerification
        : await applyPreSignupBankVerificationTransferStatus(supabase, {
            verification: savedVerification,
            transferReferenceId: createdTransferId,
            providerReferenceId: transfer.providerReferenceId || null,
            transferStatus: transfer.status as TransferStatus,
          });

      return jsonResponse(
        req,
        buildVerificationResponse(
          persistedVerification || savedVerification,
          resolveVerificationMessage(transfer.status as TransferStatus),
        ),
      );
    } catch (error) {
      const message = resolveVerificationMessage(
        "failed",
        error instanceof Error ? error.message : null,
      );

      await persistVerificationAttempt(supabase, {
        existingId: existingVerification?.id,
        email,
        phone,
        name: name || null,
        accountHolderName,
        encryptedAccountNumber: encrypted.encryptedAccountNumber,
        accountLast4,
        accountNumberHash: encrypted.accountNumberHash,
        ifsc,
        bankName: ifscDetails.bankName || null,
        branchName: ifscDetails.branchName || null,
        city: ifscDetails.city || null,
        beneficiaryId: confirmedBeneficiaryId,
        transferId: createdTransferId,
        providerReferenceId,
        transferStatus: "failed",
        statusMessage: message,
        attemptCount: attemptCount + 1,
      });

      return errorResponse(req, 400, message, "bank_verification_failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify bank";
    return errorResponse(req, 500, message, "bank_verification_failed");
  }
});
