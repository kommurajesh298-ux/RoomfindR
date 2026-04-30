import { signupOtpTemplate, sendBrevoEmail } from "../_shared/brevo.ts";
import { assertAllowedOrigin, errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { countRecentOtps, insertOtpRecord } from "../_shared/otp-store.ts";
import {
  fetchPreSignupLicenseDocument,
  syncPreSignupLicenseDocumentContact,
} from "../_shared/owner-license-document.ts";
import {
  fetchLatestPreSignupBankVerification,
  fetchPreSignupBankVerificationByTransferReference,
  reconcilePreSignupBankVerification,
  resolveVerificationTransferStatus,
  syncPreSignupBankVerificationPhone,
} from "../_shared/owner-bank-verification.ts";
import {
  generateSixDigitOtp,
  normalizeEmail,
  normalizePhone,
  sha256Hex,
  validateEmail,
} from "../_shared/security.ts";
import { buildRateLimitKey, enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";
import { createServiceClient } from "../_shared/supabase.ts";

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
    const payload = await req.json().catch(() => ({}));
    const email = normalizeEmail(String(payload?.email ?? ""));
    const role = String(payload?.role ?? "").trim().toLowerCase();
    const phone = normalizePhone(String(payload?.phone ?? ""));
    const transferId = String(payload?.transferId ?? payload?.transfer_id ?? "").trim();

    if (!validateEmail(email)) {
      return errorResponse(req, 400, "Invalid email format", "invalid_email");
    }

    const signupOtpLimit = await enforceRateLimit(
      buildRateLimitKey("signup-email-otp", email, getClientIp(req)),
      5,
      300,
    );
    if (!signupOtpLimit.allowed) {
      return errorResponse(req, 429, "Too many OTP requests. Please try again later.", "rate_limited");
    }

    const supabase = createServiceClient();

    const resendCount = await countRecentOtps(supabase, "email_otps", email, 10);
    if (resendCount >= 3) {
      return errorResponse(req, 429, "Too many OTP requests. Please try again later.", "rate_limited");
    }

    const { data: existingUserId, error: lookupError } = await supabase.rpc(
      "get_auth_user_id_by_email",
      { p_email: email },
    );

    if (lookupError) {
      throw lookupError;
    }

    if (existingUserId) {
      return jsonResponse(req, {
        success: true,
        message: "If the email can receive verification codes, one has been sent.",
      });
    }

    if (role === "owner") {
      if (!phone) {
        return errorResponse(req, 400, "Valid phone number is required", "invalid_phone");
      }

      let licenseDocument = await fetchPreSignupLicenseDocument(supabase, email);
      if (!licenseDocument || licenseDocument.consumed_at) {
        return errorResponse(
          req,
          400,
          "Upload your business license before requesting OTP.",
          "license_document_required",
        );
      }

      licenseDocument = await syncPreSignupLicenseDocumentContact(
        supabase,
        licenseDocument,
        { phone },
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
      let bankVerification =
        (reconciled.verification as
          | { phone?: string | null; transfer_status?: string | null; consumed_at?: string | null }
          | null) ||
        targetVerification;
      const transferStatus = resolveVerificationTransferStatus(
        bankVerification?.transfer_status,
        bankVerification as Record<string, unknown> | null,
      );

      if (
        !bankVerification ||
        transferStatus !== "success"
      ) {
        return errorResponse(
          req,
          400,
          "Bank account must be validated before OTP verification",
          "bank_validation_required",
        );
      }

      if (phone) {
        bankVerification = (await syncPreSignupBankVerificationPhone(
          supabase,
          bankVerification as Record<string, unknown>,
          phone,
        )) as typeof bankVerification;
      }
    }

    const otp = generateSixDigitOtp();
    const otpHash = await sha256Hex(otp);

    await insertOtpRecord(supabase, "email_otps", email, otpHash, 5);

    const template = signupOtpTemplate(otp);
    await sendBrevoEmail({
      toEmail: email,
      subject: template.subject,
      htmlContent: template.html,
      textContent: template.text,
    });

    return jsonResponse(req, {
      success: true,
      message: "If the email can receive verification codes, one has been sent.",
    });
  } catch {
    return errorResponse(req, 500, "Unable to send OTP", "signup_otp_send_failed");
  }
});
