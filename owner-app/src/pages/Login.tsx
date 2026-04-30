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
import { ownerService } from "../services/owner.service";
import { showToast } from "../utils/toast";
import { resolveOwnerVerificationState } from "../utils/ownerVerification";
import { validateEmail } from "../utils/validation";

type LoginFieldName = "email" | "password";

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<LoginFieldName, string>>
  >({});
  const [fieldTouched, setFieldTouched] = useState<
    Partial<Record<LoginFieldName, boolean>>
  >({});

  const validateField = (
    field: LoginFieldName,
    values: { email: string; password: string },
    touched?: Partial<Record<LoginFieldName, boolean>>,
  ) => {
    if (!touched?.[field]) return "";

    if (field === "email") {
      const normalizedEmail = values.email.trim().toLowerCase();
      if (!normalizedEmail) return "Please enter your email address.";
      return validateEmail(normalizedEmail) ? "" : "Please enter a valid email address.";
    }

    return values.password ? "" : "Password is required.";
  };

  const setTouchedAndValidate = (
    field: LoginFieldName,
    values: { email: string; password: string },
  ) => {
    const nextTouched = { ...fieldTouched, [field]: true };
    setFieldTouched(nextTouched);
    setFieldErrors((previous) => ({
      ...previous,
      [field]: validateField(field, values, nextTouched),
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    const nextTouched = { email: true, password: true } satisfies Partial<
      Record<LoginFieldName, boolean>
    >;
    const nextErrors = {
      email: validateField("email", { email: normalizedEmail, password }, nextTouched),
      password: validateField("password", { email: normalizedEmail, password }, nextTouched),
    };
    setFieldTouched(nextTouched);
    setFieldErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) {
      showToast.error("Please fix the highlighted fields.");
      return;
    }

    setLoading(true);
    try {
      const { user } = await authService.signInWithEmail(normalizedEmail, password);

      if (!user) {
        throw new Error("Unable to sign in. Please try again.");
      }

      const role = await authService.getUserRole(user.id);
      if (role !== "owner") {
        await authService.signOut();
        showToast.error("Unauthorized. This portal is for Property Owners only.");
        return;
      }

      const accountStatus = await authService.getAccountStatus(user.id);
      if (accountStatus === "blocked") {
        await authService.signOut();
        showToast.error("Your account has been blocked. Please contact admin.");
        return;
      }

      if (accountStatus === "pending_admin_approval") {
        navigate("/verification-status", { replace: true });
        return;
      }

      const ownerDoc = await ownerService.getOwnerProfile(user.id);
      const { ownerActive } = resolveOwnerVerificationState(ownerDoc);

      if (!ownerActive) {
        navigate("/verification-status", { replace: true });
        return;
      }

      showToast.success("Welcome back!");
      navigate(from, { replace: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Login failed. Please check your credentials.";
      showToast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ReferenceAuthLayout
      heroTitle="LOGIN"
      heroSubtitle=""
      shellClassName="rf-auth-shell--login rf-auth-shell--owner-login"
      cardClassName="rf-auth-card--login rf-auth-card--owner-login"
      bodyClassName="rf-auth-body--login rf-auth-body--owner-login"
      footer={
        <ReferenceAuthPrompt>
          Need an account? <Link to="/signup">SIGN UP</Link>
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
              setTouchedAndValidate("email", { email: nextEmail, password });
            }}
            onBlur={() =>
              setTouchedAndValidate("email", { email, password })
            }
            autoComplete="email"
            invalid={Boolean(fieldErrors.email)}
            required
          />
        </ReferenceAuthField>

        <ReferenceAuthField
          label="Password"
          htmlFor="password"
          helper={fieldErrors.password || undefined}
          helperTone={fieldErrors.password ? "error" : "default"}
        >
          <ReferenceAuthInput
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(event) => {
              const nextPassword = event.target.value;
              setPassword(nextPassword);
              setTouchedAndValidate("password", { email, password: nextPassword });
            }}
            onBlur={() =>
              setTouchedAndValidate("password", { email, password })
            }
            autoComplete="current-password"
            invalid={Boolean(fieldErrors.password)}
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

        <ReferenceAuthButton type="submit" disabled={loading}>
          {loading ? "Logging In..." : "Login"}
        </ReferenceAuthButton>
      </form>
    </ReferenceAuthLayout>
  );
};

export default Login;
