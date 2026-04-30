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
import { validateEmail } from "../utils/validation";
import { showError, showSuccess } from "../utils/toast";

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!validateEmail(normalizedEmail)) {
      showError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      await authService.sendPasswordResetOtp(normalizedEmail);
      showSuccess("If an account exists, a reset code has been sent.");
      navigate("/reset-password", {
        replace: true,
        state: { email: normalizedEmail },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send reset OTP. Please try again.";
      showError(message);
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

        <ReferenceAuthButton type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send Reset Code"}
        </ReferenceAuthButton>
      </form>
    </ReferenceAuthLayout>
  );
};

export default ForgotPassword;
