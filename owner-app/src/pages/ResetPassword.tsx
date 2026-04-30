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
import { showToast } from "../utils/toast";
import { validateEmail, validateOTP, validatePassword } from "../utils/validation";

const RESEND_SECONDS = 30;
const passwordValidationMessage =
  "Password must be at least 8 characters and include upper/lowercase letters and a number.";

type ResetLocationState = {
  email?: string;
};

type ResetFieldName = "email" | "otp" | "newPassword" | "confirmPassword";

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
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(RESEND_SECONDS);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ResetFieldName, string>>
  >({});
  const [fieldTouched, setFieldTouched] = useState<
    Partial<Record<ResetFieldName, boolean>>
  >({});

  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = setInterval(() => {
      setResendTimer((previous) => previous - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendTimer]);

  const passwordIsValid = useMemo(() => validatePassword(newPassword), [newPassword]);

  const isFormValid = useMemo(
    () =>
      validateEmail(email.trim().toLowerCase()) &&
      validateOTP(otp) &&
      passwordIsValid &&
      newPassword === confirmPassword,
    [confirmPassword, email, newPassword, otp, passwordIsValid],
  );

  const validateField = (
    field: ResetFieldName,
    values: {
      email: string;
      otp: string;
      newPassword: string;
      confirmPassword: string;
    },
    touched?: Partial<Record<ResetFieldName, boolean>>,
  ) => {
    if (!touched?.[field]) return "";

    if (field === "email") {
      const normalizedEmail = values.email.trim().toLowerCase();
      if (!normalizedEmail) return "Please enter your email address.";
      return validateEmail(normalizedEmail) ? "" : "Please enter a valid email address.";
    }

    if (field === "otp") {
      if (!values.otp) return "Please enter the 6-digit OTP.";
      return validateOTP(values.otp) ? "" : "Please enter a valid 6-digit OTP.";
    }

    if (field === "newPassword") {
      if (!values.newPassword) return "Please enter a new password.";
      return validatePassword(values.newPassword) ? "" : passwordValidationMessage;
    }

    if (!values.confirmPassword) return "Please confirm your new password.";
    return values.newPassword === values.confirmPassword
      ? ""
      : "Passwords do not match.";
  };

  const currentValues = () => ({
    email,
    otp,
    newPassword,
    confirmPassword,
  });

  const setTouchedAndValidate = (
    field: ResetFieldName,
    values: ReturnType<typeof currentValues>,
  ) => {
    const nextTouched = { ...fieldTouched, [field]: true };
    setFieldTouched(nextTouched);
    setFieldErrors((previous) => ({
      ...previous,
      [field]: validateField(field, values, nextTouched),
      ...(field === "newPassword" || field === "confirmPassword"
        ? {
            confirmPassword: validateField(
              "confirmPassword",
              values,
              {
                ...nextTouched,
                confirmPassword:
                  nextTouched.confirmPassword || Boolean(values.confirmPassword),
              },
            ),
          }
        : {}),
    }));
  };

  const handleResendOtp = async () => {
    if (loading || resendTimer > 0) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!validateEmail(normalizedEmail)) {
      setFieldTouched((previous) => ({ ...previous, email: true }));
      setFieldErrors((previous) => ({
        ...previous,
        email: "Please enter a valid email address.",
      }));
      showToast.error("Please enter a valid email first.");
      return;
    }

    setLoading(true);
    try {
      await authService.sendPasswordResetOtp(normalizedEmail);
      setResendTimer(RESEND_SECONDS);
      showToast.success("If an account exists, a new OTP has been sent.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to resend OTP.";
      showToast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    const nextTouched = {
      email: true,
      otp: true,
      newPassword: true,
      confirmPassword: true,
    } satisfies Partial<Record<ResetFieldName, boolean>>;
    const values = {
      email: normalizedEmail,
      otp,
      newPassword,
      confirmPassword,
    };
    const nextErrors = {
      email: validateField("email", values, nextTouched),
      otp: validateField("otp", values, nextTouched),
      newPassword: validateField("newPassword", values, nextTouched),
      confirmPassword: validateField("confirmPassword", values, nextTouched),
    };
    setFieldTouched(nextTouched);
    setFieldErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      showToast.error("Please fix the highlighted fields.");
      return;
    }

    setLoading(true);
    try {
      await authService.verifyPasswordResetOtp({
        email: normalizedEmail,
        otp,
        new_password: newPassword,
      });
      showToast.success("Password reset successful. Please sign in.");
      navigate("/login", { replace: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to reset password. Please try again.";
      showToast.error(message);
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
        <ReferenceAuthField
          label="Email"
          htmlFor="email"
          helper={fieldErrors.email || undefined}
          helperTone={fieldErrors.email ? "error" : "default"}
        >
          <ReferenceAuthInput
            id="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => {
              const nextEmail = event.target.value;
              setEmail(nextEmail);
              setTouchedAndValidate("email", {
                ...currentValues(),
                email: nextEmail,
              });
            }}
            onBlur={() => setTouchedAndValidate("email", currentValues())}
            autoComplete="email"
            invalid={Boolean(fieldErrors.email)}
            required
          />
        </ReferenceAuthField>

        <ReferenceAuthField
          label="OTP"
          helper={
            fieldErrors.otp ? (
              fieldErrors.otp
            ) : resendTimer > 0 ? (
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
          helperTone={fieldErrors.otp ? "error" : "default"}
        >
          <ReferenceAuthOtpInput
            value={otp}
            onChange={(value) => {
              setOtp(value);
              setTouchedAndValidate("otp", {
                ...currentValues(),
                otp: value,
              });
            }}
            disabled={loading}
          />
        </ReferenceAuthField>

        <ReferenceAuthField
          label="New Password"
          htmlFor="newPassword"
          helper={fieldErrors.newPassword || undefined}
          helperTone={fieldErrors.newPassword ? "error" : "default"}
        >
          <ReferenceAuthInput
            id="newPassword"
            type={showNewPassword ? "text" : "password"}
            placeholder="New Password"
            value={newPassword}
            onChange={(event) => {
              const nextPassword = event.target.value;
              setNewPassword(nextPassword);
              setTouchedAndValidate("newPassword", {
                ...currentValues(),
                newPassword: nextPassword,
              });
            }}
            onBlur={() => setTouchedAndValidate("newPassword", currentValues())}
            autoComplete="new-password"
            invalid={Boolean(fieldErrors.newPassword)}
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

        <ReferenceAuthField
          label="Confirm Password"
          htmlFor="confirmPassword"
          helper={fieldErrors.confirmPassword || undefined}
          helperTone={fieldErrors.confirmPassword ? "error" : "default"}
        >
          <ReferenceAuthInput
            id="confirmPassword"
            type={showConfirmPassword ? "text" : "password"}
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(event) => {
              const nextConfirmPassword = event.target.value;
              setConfirmPassword(nextConfirmPassword);
              setTouchedAndValidate("confirmPassword", {
                ...currentValues(),
                confirmPassword: nextConfirmPassword,
              });
            }}
            onBlur={() =>
              setTouchedAndValidate("confirmPassword", currentValues())
            }
            autoComplete="new-password"
            invalid={Boolean(fieldErrors.confirmPassword)}
            required
            endAdornment={
              <button
                type="button"
                onClick={() => setShowConfirmPassword((previous) => !previous)}
                className="rf-auth-icon-button"
                aria-label={
                  showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"
                }
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
