import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ReferenceAuthButton,
  ReferenceAuthField,
  ReferenceAuthInput,
  ReferenceAuthLayout,
  ReferenceAuthPrompt,
} from "../../../shared/auth-ui";
import { authService } from "../services/auth.service";
import { showToast } from "../utils/toast";
import { validateEmail } from "../utils/validation";

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const navigate = useNavigate();

  const validateEmailField = (value: string, touched = emailTouched) => {
    if (!touched) return "";
    const normalizedEmail = value.trim().toLowerCase();
    if (!normalizedEmail) return "Please enter your email address.";
    return validateEmail(normalizedEmail) ? "" : "Please enter a valid email address.";
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    const nextError = validateEmailField(normalizedEmail, true);
    setEmailTouched(true);
    setEmailError(nextError);
    if (nextError) {
      showToast.error("Please fix the highlighted field.");
      return;
    }

    setLoading(true);
    try {
      await authService.sendPasswordResetOtp(normalizedEmail);
      showToast.success("If an account exists, a reset code has been sent.");
      navigate("/reset-password", {
        replace: true,
        state: { email: normalizedEmail },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send reset OTP. Please try again.";
      showToast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ReferenceAuthLayout
      heroTitle="FORGOT PASSWORD"
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
          helper={emailError || undefined}
          helperTone={emailError ? "error" : "default"}
        >
          <ReferenceAuthInput
            id="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => {
              const nextEmail = event.target.value;
              setEmail(nextEmail);
              setEmailTouched(true);
              setEmailError(validateEmailField(nextEmail, true));
            }}
            onBlur={() => {
              setEmailTouched(true);
              setEmailError(validateEmailField(email, true));
            }}
            autoComplete="email"
            invalid={Boolean(emailError)}
            required
          />
        </ReferenceAuthField>

        <ReferenceAuthButton type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send Reset Code"}
        </ReferenceAuthButton>
      </form>
    </ReferenceAuthLayout>
  );
};

export default ForgotPassword;
