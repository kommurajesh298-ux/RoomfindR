import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
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

const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname || "/";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();

    if (!validateEmail(normalizedEmail)) {
      const message = "Please enter a valid email address.";
      setInlineError(message);
      showError(message);
      return;
    }

    if (!password) {
      const message = "Password is required.";
      setInlineError(message);
      showError(message);
      return;
    }

    setInlineError("");
    setLoading(true);
    try {
      const { user } = await authService.signInWithEmail(normalizedEmail, password);

      if (!user) {
        throw new Error("Unable to sign in. Please try again.");
      }

      const role = await authService.getUserRole(user.id);
      if (role !== "customer") {
        await authService.signOut();
        const message = "Unauthorized access. Please use the correct app.";
        setInlineError(message);
        showError(message);
        return;
      }

      const accountStatus = await authService.getAccountStatus(user.id);
      if (accountStatus === "blocked") {
        await authService.signOut();
        const message = "Your account has been blocked.";
        setInlineError(message);
        showError(message);
        return;
      }

      setInlineError("");
      showSuccess("Welcome back!");
      navigate(from, { replace: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Login failed. Please check your credentials.";
      setInlineError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ReferenceAuthLayout
      heroTitle="LOGIN"
      heroSubtitle=""
      shellClassName="rf-auth-shell--login"
      cardClassName="rf-auth-card--login"
      bodyClassName="rf-auth-body--login"
      footer={
        <ReferenceAuthPrompt>
          Need an account? <Link to="/signup">SIGN UP</Link>
        </ReferenceAuthPrompt>
      }
    >
      <form onSubmit={handleSubmit} className="rf-auth-stack">
        <ReferenceAuthField label="Email" htmlFor="email">
          <ReferenceAuthInput
            id="email"
            name="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (inlineError) setInlineError("");
            }}
            autoComplete="email"
            required
          />
        </ReferenceAuthField>

        <ReferenceAuthField label="Password" htmlFor="password">
          <ReferenceAuthInput
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (inlineError) setInlineError("");
            }}
            autoComplete="current-password"
            required
            endAdornment={
              <button
                type="button"
                onClick={() => setShowPassword((previous) => !previous)}
                className="rf-auth-icon-button"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
        </ReferenceAuthField>

        <div className="rf-auth-inline-end">
          <Link to="/forgot-password" className="rf-auth-text-link">
            Forgot password?
          </Link>
        </div>

        {inlineError ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600"
          >
            {inlineError}
          </div>
        ) : null}

        <ReferenceAuthButton type="submit" disabled={loading}>
          {loading ? "Logging In..." : "Login"}
        </ReferenceAuthButton>
      </form>
    </ReferenceAuthLayout>
  );
};

export default Login;
