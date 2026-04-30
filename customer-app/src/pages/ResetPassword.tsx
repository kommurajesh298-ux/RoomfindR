import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import {
  ReferenceAuthButton,
  ReferenceAuthField,
  ReferenceAuthInput,
  ReferenceAuthLayout,
  ReferenceAuthOtpInput,
  ReferenceAuthPrompt,
} from "../../../shared/auth-ui";
import { authService } from "../services/auth.service";
import { validateEmail, validateOTP, validatePassword } from "../utils/validation";
import { showError, showSuccess } from "../utils/toast";

const RESEND_SECONDS = 30;

type ResetLocationState = {
  email?: string;
};

const ResetPassword: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const presetEmail = (location.state as ResetLocationState | null)?.email ?? "";

  const [email, setEmail] = useState(presetEmail);
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNewPasswordHint, setShowNewPasswordHint] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = setInterval(() => {
      setResendTimer((previous) => previous - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendTimer]);

  const passwordState = useMemo(() => validatePassword(newPassword), [newPassword]);

  const isFormValid = useMemo(() => {
    return (
      validateEmail(email.trim().toLowerCase()) &&
      validateOTP(otp) &&
      passwordState.valid &&
      newPassword === confirmPassword
    );
  }, [confirmPassword, email, newPassword, otp, passwordState.valid]);

  const handleResendOtp = async () => {
    if (loading || resendTimer > 0) return;
    const normalizedEmail = email.trim().toLowerCase();

    if (!validateEmail(normalizedEmail)) {
      showError("Please enter a valid email first.");
      return;
    }

    setLoading(true);
    try {
      await authService.sendPasswordResetOtp(normalizedEmail);
      setResendTimer(RESEND_SECONDS);
      showSuccess("If an account exists, a new OTP has been sent.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to resend OTP.";
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!validateEmail(normalizedEmail)) {
      showError("Please enter a valid email address.");
      return;
    }

    if (!validateOTP(otp)) {
      showError("Please enter a valid 6-digit OTP.");
      return;
    }

    if (!passwordState.valid) {
      showError(`Weak password: ${passwordState.messages.join(", ")}`);
      return;
    }

    if (newPassword !== confirmPassword) {
      showError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await authService.verifyPasswordResetOtp({
        email: normalizedEmail,
        otp,
        new_password: newPassword,
      });
      showSuccess("Password updated successfully. Please sign in.");
      navigate("/login", { replace: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to reset password. Please try again.";
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ReferenceAuthLayout
      heroTitle="RESET PASSWORD"
      heroSubtitle=""
      shellClassName="rf-auth-shell--recovery"
      cardClassName="rf-auth-card--recovery"
      bodyClassName="rf-auth-body--recovery"
      footer={
        <ReferenceAuthPrompt>
          <Link to="/login">Back to LOGIN</Link>
        </ReferenceAuthPrompt>
      }
    >
      <form onSubmit={handleSubmit} className="rf-auth-stack">
        <ReferenceAuthField label="Email" htmlFor="email">
          <ReferenceAuthInput
            id="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </ReferenceAuthField>

        <ReferenceAuthField
          label="OTP"
          helper={
            resendTimer > 0 ? (
              <>Resend available in {resendTimer}s</>
            ) : (
              <button
                type="button"
                onClick={handleResendOtp}
                className="rf-auth-link-button"
                disabled={loading}
              >
                Resend code
              </button>
            )
          }
        >
          <ReferenceAuthOtpInput value={otp} onChange={setOtp} disabled={loading} />
        </ReferenceAuthField>

        <ReferenceAuthField
          label="New Password"
          htmlFor="newPassword"
          helper={
            showNewPasswordHint
              ? "Must be 8 or more characters and contain at least 1 number and 1 special character."
              : undefined
          }
          helperTone={showNewPasswordHint ? "error" : "default"}
        >
          <ReferenceAuthInput
            id="newPassword"
            type={showNewPassword ? "text" : "password"}
            placeholder="New Password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            onFocus={() => setShowNewPasswordHint(true)}
            onBlur={() => setShowNewPasswordHint(false)}
            autoComplete="new-password"
            required
            endAdornment={
              <button
                type="button"
                onClick={() => setShowNewPassword((previous) => !previous)}
                className="rf-auth-icon-button"
                aria-label={showNewPassword ? "Hide password" : "Show password"}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
        </ReferenceAuthField>

        <ReferenceAuthField label="Confirm Password" htmlFor="confirmPassword">
          <ReferenceAuthInput
            id="confirmPassword"
            type={showConfirmPassword ? "text" : "password"}
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            required
            endAdornment={
              <button
                type="button"
                onClick={() => setShowConfirmPassword((previous) => !previous)}
                className="rf-auth-icon-button"
                aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
        </ReferenceAuthField>

        <ReferenceAuthButton type="submit" disabled={loading || !isFormValid}>
          {loading ? "Resetting..." : "Reset Password"}
        </ReferenceAuthButton>
      </form>
    </ReferenceAuthLayout>
  );
};

export default ResetPassword;
