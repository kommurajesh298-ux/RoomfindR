import { resetOtpTemplate, sendBrevoEmail } from "../_shared/brevo.ts";
import { assertAllowedOrigin, errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { countRecentOtps, insertOtpRecord } from "../_shared/otp-store.ts";
import { buildRateLimitKey, enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";
import { generateSixDigitOtp, normalizeEmail, sha256Hex, validateEmail } from "../_shared/security.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const GENERIC_MESSAGE =
  "If an account exists for this email, a password reset code has been sent.";

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

    if (!validateEmail(email)) {
      return errorResponse(req, 400, "Invalid email format", "invalid_email");
    }

    const passwordResetLimit = await enforceRateLimit(
      buildRateLimitKey("password-reset-otp", email, getClientIp(req)),
      5,
      300,
    );
    if (!passwordResetLimit.allowed) {
      return jsonResponse(req, {
        success: true,
        message: GENERIC_MESSAGE,
      });
    }

    const supabase = createServiceClient();

    const { data: userId, error: lookupError } = await supabase.rpc(
      "get_auth_user_id_by_email",
      { p_email: email },
    );

    if (lookupError) {
      throw lookupError;
    }

    if (!userId) {
      return jsonResponse(req, {
        success: true,
        message: GENERIC_MESSAGE,
      });
    }

    const resendCount = await countRecentOtps(
      supabase,
      "password_reset_otps",
      email,
      15,
    );

    if (resendCount >= 3) {
      return jsonResponse(req, {
        success: true,
        message: GENERIC_MESSAGE,
      });
    }

    const otp = generateSixDigitOtp();
    const otpHash = await sha256Hex(otp);
    await insertOtpRecord(supabase, "password_reset_otps", email, otpHash, 10);

    const template = resetOtpTemplate(otp);
    await sendBrevoEmail({
      toEmail: email,
      subject: template.subject,
      htmlContent: template.html,
      textContent: template.text,
    });

    return jsonResponse(req, {
      success: true,
      message: GENERIC_MESSAGE,
    });
  } catch {
    return errorResponse(req, 500, GENERIC_MESSAGE, "reset_otp_send_failed");
  }
});
