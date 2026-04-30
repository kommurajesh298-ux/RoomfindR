import { assertAllowedOrigin, errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { getLatestUnusedOtp, incrementOtpAttempt, markOtpUsed } from "../_shared/otp-store.ts";
import {
  fetchPreSignupLicenseDocument,
  markPreSignupLicenseDocumentConsumed,
  syncPreSignupLicenseDocumentContact,
  type PreSignupLicenseDocument,
} from "../_shared/owner-license-document.ts";
import {
  fetchLatestPreSignupBankVerification,
  fetchPreSignupBankVerificationByTransferReference,
  reconcilePreSignupBankVerification,
  resolveVerificationTransferStatus,
  syncPreSignupBankVerificationPhone,
} from "../_shared/owner-bank-verification.ts";
import {
  normalizeEmail,
  normalizePhone,
  sha256Hex,
  validateEmail,
  validateOtp,
  validatePassword,
} from "../_shared/security.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type SignupRole = "customer" | "owner";

type SignupPayload = {
  email?: string;
  otp?: string;
  password?: string;
  role?: SignupRole;
  name?: string;
  phone?: string;
  city?: string;
  transferId?: string;
  transfer_id?: string;
};

type PreSignupBankVerification = {
  id: string;
  email: string;
  phone: string | null;
  account_holder_name: string;
  account_number_encrypted: string;
  account_number_last4: string | null;
  account_number_hash: string;
  ifsc: string;
  bank_name: string | null;
  branch_name: string | null;
  city: string | null;
  cashfree_beneficiary_id: string | null;
  transfer_reference_id: string | null;
  provider_reference_id: string | null;
  transfer_status: string | null;
  status_message: string | null;
  verified_at: string | null;
  last_attempt_at: string | null;
  consumed_at: string | null;
};

const isExpired = (expiresAt: string): boolean =>
  Date.parse(expiresAt) <= Date.now();

const rejectInvalidOtp = async (
  req: Request,
  supabase: any,
  otpId: string,
  attempts: number,
): Promise<Response> => {
  const nextAttempts = attempts + 1;
  await incrementOtpAttempt(supabase, "email_otps", otpId, nextAttempts);

  if (nextAttempts >= 5) {
    return errorResponse(
      req,
      429,
      "Too many invalid attempts. Please request a new OTP.",
      "otp_attempts_exceeded",
    );
  }

  return errorResponse(req, 400, "Invalid OTP", "otp_invalid");
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

  let createdUserId: string | null = null;

  try {
    const payload = (await req.json().catch(() => ({}))) as SignupPayload;
    const email = normalizeEmail(String(payload.email ?? ""));
    const otp = String(payload.otp ?? "").trim();
    const password = String(payload.password ?? "");
    const role = payload.role;
    const transferId = String(payload.transferId ?? payload.transfer_id ?? "").trim();

    if (!validateEmail(email)) {
      return errorResponse(req, 400, "Invalid email format", "invalid_email");
    }

    if (!validateOtp(otp)) {
      return errorResponse(req, 400, "Invalid OTP format", "invalid_otp_format");
    }

    if (!validatePassword(password)) {
      return errorResponse(
        req,
        400,
        "Password must be at least 8 characters and include upper/lowercase letters and a number.",
        "invalid_password",
      );
    }

    if (role !== "customer" && role !== "owner") {
      return errorResponse(req, 400, "Invalid account role", "invalid_role");
    }

    const name = String(payload.name ?? "").trim();
    if (!name) {
      return errorResponse(req, 400, "Name is required", "name_required");
    }

    const phone = normalizePhone(String(payload.phone ?? ""));
    if (!phone) {
      return errorResponse(req, 400, "Valid phone number is required", "invalid_phone");
    }

    const supabase = createServiceClient();

    const otpRecord = await getLatestUnusedOtp(supabase, "email_otps", email);
    if (!otpRecord) {
      return errorResponse(req, 400, "OTP is invalid or already used", "otp_not_found");
    }

    if (isExpired(otpRecord.expires_at)) {
      return errorResponse(req, 400, "OTP has expired", "otp_expired");
    }

    if (otpRecord.attempts >= 5) {
      return errorResponse(
        req,
        429,
        "Too many invalid attempts. Please request a new OTP.",
        "otp_attempts_exceeded",
      );
    }

    const otpHash = await sha256Hex(otp);
    if (otpHash !== otpRecord.otp_hash) {
      return await rejectInvalidOtp(req, supabase, otpRecord.id, otpRecord.attempts);
    }

    const { data: existingUserId, error: existingUserError } = await supabase.rpc(
      "get_auth_user_id_by_email",
      { p_email: email },
    );
    if (existingUserError) {
      throw existingUserError;
    }

    if (existingUserId) {
      await markOtpUsed(supabase, "email_otps", otpRecord.id);
      return errorResponse(req, 409, "Account already exists", "account_exists");
    }

    const city = String(payload.city ?? "").trim();
    let preSignupBank: PreSignupBankVerification | null = null;
    let preSignupLicense: PreSignupLicenseDocument | null = null;

    if (role === "owner") {
      preSignupLicense = await fetchPreSignupLicenseDocument(supabase, email);
      if (!preSignupLicense || preSignupLicense.consumed_at) {
        return errorResponse(
          req,
          400,
          "Upload your business license before completing signup.",
          "license_document_required",
        );
      }

      preSignupLicense = await syncPreSignupLicenseDocumentContact(
        supabase,
        preSignupLicense,
        {
          phone,
          fullName: name,
        },
      );

      const latestVerification = await fetchLatestPreSignupBankVerification(
        supabase,
        email,
      );
      const verificationByTransferId = transferId
        ? await fetchPreSignupBankVerificationByTransferReference(
            supabase,
            transferId,
          )
        : null;
      const targetVerification =
        verificationByTransferId &&
          normalizeEmail(String(verificationByTransferId.email ?? "")) === email
          ? verificationByTransferId
          : latestVerification;
      const reconciled = await reconcilePreSignupBankVerification(
        supabase,
        targetVerification,
      );
      let verification =
        (reconciled.verification as PreSignupBankVerification | null) ||
        (targetVerification as PreSignupBankVerification | null);
      const transferStatus = resolveVerificationTransferStatus(
        verification?.transfer_status,
        verification as Record<string, unknown> | null,
      );

      if (!verification || transferStatus !== "success") {
        return errorResponse(
          req,
          400,
          "Bank account must be validated before OTP verification",
          "bank_validation_required",
        );
      }

      if (phone) {
        verification = (await syncPreSignupBankVerificationPhone(
          supabase,
          verification as Record<string, unknown>,
          phone,
        )) as PreSignupBankVerification;
      }
      preSignupBank = verification as PreSignupBankVerification;
    }

    const { data: createdUserData, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        name,
        phone,
        ...(city ? { city } : {}),
      },
      app_metadata: {
        role,
      },
    });

    if (createUserError || !createdUserData?.user?.id) {
      throw createUserError ?? new Error("Unable to create user");
    }

    createdUserId = createdUserData.user.id;

    const accountStatus =
      role === "owner" ? "pending_admin_approval" : "active";

    const { error: accountError } = await supabase.from("accounts").upsert({
      id: createdUserId,
      email,
      phone,
      role,
      account_status: accountStatus,
      updated_at: new Date().toISOString(),
    });
    if (accountError) throw accountError;

    if (role === "customer") {
      const { error: customerError } = await supabase.from("customers").upsert({
        id: createdUserId,
        name,
        email,
        phone,
        city: city || null,
        updated_at: new Date().toISOString(),
      });
      if (customerError) throw customerError;
    } else {
      const verifiedAt = preSignupBank?.verified_at || new Date().toISOString();
      const maskedAccount = preSignupBank?.account_number_last4
        ? `XXXX${preSignupBank.account_number_last4}`
        : "XXXX";
      const statusMessage =
        preSignupBank?.status_message || "Bank account verified successfully.";

      const { error: ownerError } = await supabase.from("owners").upsert({
        id: createdUserId,
        owner_id: createdUserId,
        name,
        full_name: name,
        email,
        phone,
        mobile_number: phone,
        verification_documents: preSignupLicense?.document_url
          ? [preSignupLicense.document_url]
          : [],
        verified: false,
        verification_status: "pending",
        bank_verified: true,
        bank_verified_at: verifiedAt,
        bank_verification_status: "verified",
        verification_reference_id: preSignupBank?.transfer_reference_id || null,
        cashfree_transfer_id: preSignupBank?.transfer_reference_id || null,
        cashfree_status: "success",
        cashfree_beneficiary_id: preSignupBank?.cashfree_beneficiary_id || null,
        account_holder_name: preSignupBank?.account_holder_name || null,
        bank_account_number: maskedAccount,
        bank_ifsc: preSignupBank?.ifsc || null,
        bank_details: preSignupBank
          ? {
              accountHolderName: preSignupBank.account_holder_name,
              accountNumber: maskedAccount,
              ifscCode: preSignupBank.ifsc,
              bankName: preSignupBank.bank_name,
              branchName: preSignupBank.branch_name,
              city: preSignupBank.city,
            }
          : null,
        updated_at: new Date().toISOString(),
      });
      if (ownerError) throw ownerError;

      if (preSignupBank) {
        const { data: verificationRecord, error: verificationError } = await supabase
          .from("owner_bank_verification")
          .upsert(
            {
              owner_id: createdUserId,
              bank_account_number: maskedAccount,
              ifsc_code: preSignupBank.ifsc,
              account_holder_name: preSignupBank.account_holder_name,
              transfer_amount: 1,
              transfer_reference_id: preSignupBank.transfer_reference_id,
              provider_reference_id: preSignupBank.provider_reference_id,
              transfer_status: "success",
              status_message: statusMessage,
              last_attempt_at: preSignupBank.last_attempt_at || verifiedAt,
              verified_at: verifiedAt,
            },
            { onConflict: "owner_id" },
          )
          .select("id")
          .single();

        if (verificationError) throw verificationError;

        const { error: historyError } = await supabase
          .from("owner_bank_verification_history")
          .insert({
            owner_id: createdUserId,
            verification_id: verificationRecord?.id || null,
            bank_account_number: maskedAccount,
            ifsc_code: preSignupBank.ifsc,
            account_holder_name: preSignupBank.account_holder_name,
            transfer_amount: 1,
            transfer_reference: preSignupBank.transfer_reference_id,
            provider_reference_id: preSignupBank.provider_reference_id,
            transfer_status: "success",
            error_message: null,
          });

        if (historyError) throw historyError;

        const { error: bankAccountError } = await supabase
          .from("owner_bank_accounts")
          .upsert(
            {
              owner_id: createdUserId,
              account_holder_name: preSignupBank.account_holder_name,
              account_number: preSignupBank.account_number_encrypted,
              account_number_last4: preSignupBank.account_number_last4,
              account_number_hash: preSignupBank.account_number_hash,
              ifsc: preSignupBank.ifsc,
              bank_name: preSignupBank.bank_name,
              branch_name: preSignupBank.branch_name,
              city: preSignupBank.city,
              cashfree_beneficiary_id: preSignupBank.cashfree_beneficiary_id,
              verified: true,
              bank_verification_status: "verified",
              verification_method: "penny_drop",
            },
            { onConflict: "owner_id" },
          );

        if (bankAccountError) throw bankAccountError;

        const { error: consumeError } = await supabase
          .from("owner_signup_bank_verifications")
          .update({
            consumed_at: new Date().toISOString(),
            owner_id: createdUserId,
          })
          .eq("id", preSignupBank.id);

        if (consumeError) throw consumeError;

        if (preSignupLicense) {
          await markPreSignupLicenseDocumentConsumed(
            supabase,
            preSignupLicense.id,
            createdUserId,
          );
        }
      }
    }

    await markOtpUsed(supabase, "email_otps", otpRecord.id);

    return jsonResponse(req, {
      success: true,
      user_id: createdUserId,
      role,
      account_status: accountStatus,
    });
  } catch (error) {
    if (createdUserId) {
      const supabase = createServiceClient();
      await supabase.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    }

    const message =
      error instanceof Error ? error.message : "Unable to verify OTP and create account";
    const errorCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code: string }).code)
        : "signup_verify_failed";

    return errorResponse(
      req,
      500,
      message,
      errorCode,
    );
  }
});
