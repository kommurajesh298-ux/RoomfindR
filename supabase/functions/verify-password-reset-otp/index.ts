import { assertAllowedOrigin, errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { getLatestUnusedOtp, incrementOtpAttempt, markOtpUsed } from "../_shared/otp-store.ts";
import {
  normalizeEmail,
  sha256Hex,
  validateEmail,
  validateOtp,
  validatePassword,
} from "../_shared/security.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type ResetPayload = {
  email?: string;
  otp?: string;
  new_password?: string;
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
  await incrementOtpAttempt(supabase, "password_reset_otps", otpId, nextAttempts);

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

  try {
    const payload = (await req.json().catch(() => ({}))) as ResetPayload;
    const email = normalizeEmail(String(payload.email ?? ""));
    const otp = String(payload.otp ?? "").trim();
    const newPassword = String(payload.new_password ?? "");

    if (!validateEmail(email)) {
      return errorResponse(req, 400, "Invalid email format", "invalid_email");
    }

    if (!validateOtp(otp)) {
      return errorResponse(req, 400, "Invalid OTP format", "invalid_otp_format");
    }

    if (!validatePassword(newPassword)) {
      return errorResponse(
        req,
        400,
        "Password must be at least 8 characters and include upper/lowercase letters and a number.",
        "invalid_password",
      );
    }

    const supabase = createServiceClient();

    const otpRecord = await getLatestUnusedOtp(
      supabase,
      "password_reset_otps",
      email,
    );

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

    const { data: userId, error: lookupError } = await supabase.rpc(
      "get_auth_user_id_by_email",
      { p_email: email },
    );

    if (lookupError) {
      throw lookupError;
    }

    if (!userId) {
      await markOtpUsed(supabase, "password_reset_otps", otpRecord.id);
      return errorResponse(req, 400, "Invalid OTP", "otp_invalid");
    }

    const { error: updatePasswordError } = await supabase.auth.admin.updateUserById(
      userId,
      {
        password: newPassword,
        email_confirm: true,
      },
    );

    if (updatePasswordError) {
      throw updatePasswordError;
    }

    await markOtpUsed(supabase, "password_reset_otps", otpRecord.id);

    const { error: invalidateSessionsError } = await supabase.rpc(
      "invalidate_user_sessions",
      { p_user_id: userId },
    );

    if (invalidateSessionsError) {
      throw invalidateSessionsError;
    }

    return jsonResponse(req, {
      success: true,
      message: "Password reset successful.",
    });
  } catch {
    return errorResponse(
      req,
      500,
      "Unable to verify OTP and reset password",
      "reset_verify_failed",
    );
  }
});
