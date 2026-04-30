import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import {
  ReferenceAuthButton,
  ReferenceAuthField,
  ReferenceAuthInput,
  ReferenceAuthLayout,
  ReferenceAuthOtpInput,
  ReferenceAuthPrompt,
  ReferenceAuthSelect,
  type ReferenceAuthStep,
} from "../../../shared/auth-ui";
import OnboardingModal from "../components/common/OnboardingModal";
import { authService } from "../services/auth.service";
import {
  validateEmail,
  validateOTP,
  validatePassword,
  validatePhone,
} from "../utils/validation";
import { showError, showSuccess } from "../utils/toast";

const INDIAN_CITIES = ["Bengaluru", "Chennai", "Hyderabad"];
const OTP_RESEND_SECONDS = 30;

type ValidationField = "email" | "phone" | "city";
type AvailabilityField = "email" | "phone";
type SignupStep = 1 | 2 | 3;

const buildSteps = (step: SignupStep): ReferenceAuthStep[] => [
  { label: "Account", status: step === 1 ? "active" : "complete" },
  {
    label: "Contact",
    status: step === 2 ? "active" : step > 2 ? "complete" : "upcoming",
  },
  { label: "Verify", status: step === 3 ? "active" : "upcoming" },
];

const Signup: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<SignupStep>(1);
  const [otp, setOtp] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPasswordHint, setShowPasswordHint] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    password: "",
    confirmPassword: "",
  });

  const [touchedFields, setTouchedFields] = useState<Record<ValidationField, boolean>>({
    email: false,
    phone: false,
    city: false,
  });
  const [asyncFieldErrors, setAsyncFieldErrors] = useState<
    Partial<Record<AvailabilityField, string>>
  >({});
  const [availabilityState, setAvailabilityState] = useState<
    Record<AvailabilityField, "idle" | "checking">
  >({
    email: "idle",
    phone: "idle",
  });

  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = setInterval(() => {
      setResendTimer((previous) => previous - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendTimer]);

  const normalizePhone = (phone: string) => {
    const digits = phone.replaceAll(/\D/g, "").slice(-10);
    return `+91${digits}`;
  };

  const markFieldTouched = (field: ValidationField) => {
    setTouchedFields((previous) =>
      previous[field] ? previous : { ...previous, [field]: true },
    );
  };

  const passwordState = useMemo(
    () => validatePassword(formData.password),
    [formData.password],
  );

  const emailFormatError = useMemo(() => {
    const normalizedEmail = formData.email.trim().toLowerCase();
    if (!touchedFields.email) return "";
    if (!normalizedEmail) return "Email address is required.";
    if (!validateEmail(normalizedEmail)) return "Enter a valid email address.";
    return "";
  }, [formData.email, touchedFields.email]);

  const phoneFormatError = useMemo(() => {
    if (!touchedFields.phone) return "";
    if (!formData.phone) return "Phone number is required.";
    if (!validatePhone(formData.phone)) {
      return "Enter a valid 10-digit phone number.";
    }
    return "";
  }, [formData.phone, touchedFields.phone]);

  const cityError = useMemo(() => {
    if (!touchedFields.city) return "";
    if (!formData.city) return "Location is required.";
    if (!INDIAN_CITIES.includes(formData.city)) return "Select a valid location.";
    return "";
  }, [formData.city, touchedFields.city]);

  const emailError = emailFormatError || asyncFieldErrors.email || "";
  const phoneError = phoneFormatError || asyncFieldErrors.phone || "";

  useEffect(() => {
    if (step !== 1) return;

    const normalizedEmail = formData.email.trim().toLowerCase();

    if (!normalizedEmail || emailFormatError) {
      setAvailabilityState((previous) =>
        previous.email === "idle" ? previous : { ...previous, email: "idle" },
      );
      setAsyncFieldErrors((previous) => {
        if (!previous.email) return previous;
        const next = { ...previous };
        delete next.email;
        return next;
      });
      return;
    }

    setAsyncFieldErrors((previous) => {
      if (!previous.email) return previous;
      const next = { ...previous };
      delete next.email;
      return next;
    });

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAvailabilityState((previous) => ({ ...previous, email: "checking" }));
      try {
        const status = await authService.checkEmailExists(normalizedEmail);
        if (cancelled) return;
        setAsyncFieldErrors((previous) => {
          const next = { ...previous };
          if (status.isFullyRegistered) {
            next.email = "Email address already exists.";
          } else {
            delete next.email;
          }
          return next;
        });
      } finally {
        if (!cancelled) {
          setAvailabilityState((previous) => ({ ...previous, email: "idle" }));
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [emailFormatError, formData.email, step]);

  useEffect(() => {
    if (step !== 2) return;

    if (!formData.phone || phoneFormatError) {
      setAvailabilityState((previous) =>
        previous.phone === "idle" ? previous : { ...previous, phone: "idle" },
      );
      setAsyncFieldErrors((previous) => {
        if (!previous.phone) return previous;
        const next = { ...previous };
        delete next.phone;
        return next;
      });
      return;
    }

    setAsyncFieldErrors((previous) => {
      if (!previous.phone) return previous;
      const next = { ...previous };
      delete next.phone;
      return next;
    });

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAvailabilityState((previous) => ({ ...previous, phone: "checking" }));
      try {
        const status = await authService.checkPhoneExists(formData.phone);
        if (cancelled) return;
        setAsyncFieldErrors((previous) => {
          const next = { ...previous };
          if (status.isFullyRegistered) {
            next.phone = "Phone number already exists.";
          } else {
            delete next.phone;
          }
          return next;
        });
      } finally {
        if (!cancelled) {
          setAvailabilityState((previous) => ({ ...previous, phone: "idle" }));
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [formData.phone, phoneFormatError, step]);

  const handleNextToContact = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setTouchedFields((previous) => ({ ...previous, email: true }));

    const normalizedEmail = formData.email.trim().toLowerCase();
    const nextEmailError = !normalizedEmail
      ? "Email address is required."
      : !validateEmail(normalizedEmail)
        ? "Enter a valid email address."
        : "";

    setAsyncFieldErrors((previous) => {
      const next = { ...previous };
      if (nextEmailError) delete next.email;
      return next;
    });

    if (!formData.name.trim()) {
      showError("Full name is required.");
      return;
    }

    if (nextEmailError) {
      showError("Please fix the highlighted fields.");
      return;
    }

    if (!formData.password || !formData.confirmPassword) {
      showError("Please complete the password fields.");
      return;
    }

    if (!passwordState.valid) {
      showError(`Weak password: ${passwordState.messages.join(", ")}`);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      showError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const emailStatus = await authService.checkEmailExists(normalizedEmail);
      if (emailStatus.isFullyRegistered) {
        setAsyncFieldErrors((previous) => ({
          ...previous,
          email: "Email address already exists.",
        }));
        showError("Email address is already registered.");
        return;
      }

      setFormData((previous) => ({
        ...previous,
        name: previous.name.trim(),
        email: normalizedEmail,
      }));
      setStep(2);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to continue.";
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setTouchedFields((previous) => ({ ...previous, phone: true, city: true }));

    const nextPhoneError = !formData.phone
      ? "Phone number is required."
      : !validatePhone(formData.phone)
        ? "Enter a valid 10-digit phone number."
        : "";
    const nextCityError = !formData.city
      ? "Location is required."
      : !INDIAN_CITIES.includes(formData.city)
        ? "Select a valid location."
        : "";

    setAsyncFieldErrors((previous) => {
      const next = { ...previous };
      if (nextPhoneError) delete next.phone;
      return next;
    });

    if (nextPhoneError || nextCityError) {
      showError("Please fix the highlighted fields.");
      return;
    }

    setLoading(true);
    try {
      const [emailStatus, phoneStatus] = await Promise.all([
        authService.checkEmailExists(formData.email),
        authService.checkPhoneExists(normalizePhone(formData.phone)),
      ]);

      const emailExists = emailStatus.isFullyRegistered;
      const phoneExists = phoneStatus.isFullyRegistered;

      if (emailExists || phoneExists) {
        setAsyncFieldErrors((previous) => ({
          ...previous,
          ...(emailExists ? { email: "Email address already exists." } : {}),
          ...(phoneExists ? { phone: "Phone number already exists." } : {}),
        }));
        showError("Email or phone number is already registered.");
        return;
      }

      await authService.requestEmailOtp(formData.email);
      setOtp("");
      setResendTimer(OTP_RESEND_SECONDS);
      setStep(3);
      showSuccess("OTP sent to your email.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send OTP. Please try again.";
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateOTP(otp)) {
      showError("Please enter a valid 6-digit OTP.");
      return;
    }

    if (loading) return;
    setLoading(true);
    try {
      const verification = await authService.verifyEmailOTP({
        email: formData.email,
        otp,
        password: formData.password,
        role: "customer",
        name: formData.name,
        phone: formData.phone,
        city: formData.city,
      });

      if (!verification.success || verification.account_status !== "active") {
        showError("Account verification failed. Please contact support.");
        return;
      }

      await authService.signInWithEmail(formData.email, formData.password);
      showSuccess("Account verified successfully!");
      setShowOnboarding(true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Verification failed. Please try again.";
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendTimer > 0 || loading) return;

    setLoading(true);
    try {
      await authService.requestEmailOtp(formData.email);
      setResendTimer(OTP_RESEND_SECONDS);
      showSuccess("OTP resent successfully.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resend OTP.";
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ReferenceAuthLayout
        heroTitle="SIGNUP"
        heroSubtitle=""
        shellClassName={
          step === 3
            ? "rf-auth-shell--signup rf-auth-shell--signup-otp"
            : "rf-auth-shell--signup"
        }
        cardClassName="rf-auth-card--signup"
        bodyClassName="rf-auth-body--signup"
        steps={buildSteps(step)}
        footer={
          step === 1 ? (
            <ReferenceAuthPrompt>
              Already a user? <Link to="/login">LOGIN</Link>
            </ReferenceAuthPrompt>
          ) : undefined
        }
      >
        {step === 1 ? (
          <form onSubmit={handleNextToContact} className="rf-auth-stack">
            <ReferenceAuthField label="Full Name" htmlFor="name">
              <ReferenceAuthInput
                id="name"
                type="text"
                placeholder="Full Name"
                value={formData.name}
                onChange={(event) =>
                  setFormData((previous) => ({ ...previous, name: event.target.value }))
                }
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Email"
              htmlFor="email"
              helper={
                emailError
                  ? emailError
                  : availabilityState.email === "checking" && formData.email
                    ? "Checking email..."
                    : undefined
              }
              helperTone={
                emailError
                  ? "error"
                  : availabilityState.email === "checking" && formData.email
                    ? "info"
                    : "default"
              }
            >
              <ReferenceAuthInput
                id="email"
                type="email"
                placeholder="Email"
                value={formData.email}
                onChange={(event) => {
                  markFieldTouched("email");
                  setFormData((previous) => ({
                    ...previous,
                    email: event.target.value.toLowerCase(),
                  }));
                }}
                onBlur={() => markFieldTouched("email")}
                invalid={Boolean(emailError)}
                autoComplete="email"
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Password"
              htmlFor="password"
              helper={
                showPasswordHint
                  ? "Must be 8 or more characters and contain at least 1 number and 1 special character."
                  : undefined
              }
              helperTone={showPasswordHint ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={formData.password}
                onChange={(event) =>
                  setFormData((previous) => ({ ...previous, password: event.target.value }))
                }
                onFocus={() => setShowPasswordHint(true)}
                onBlur={() => setShowPasswordHint(false)}
                autoComplete="new-password"
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

            <ReferenceAuthField label="Confirm Password" htmlFor="confirmPassword">
              <ReferenceAuthInput
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm Password"
                value={formData.confirmPassword}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    confirmPassword: event.target.value,
                  }))
                }
                autoComplete="new-password"
                required
                endAdornment={
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((previous) => !previous)}
                    className="rf-auth-icon-button"
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirmation password"
                        : "Show confirmation password"
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                }
              />
            </ReferenceAuthField>

            <ReferenceAuthButton type="submit" disabled={loading}>
              {loading ? "Loading..." : "Next"}
            </ReferenceAuthButton>
          </form>
        ) : null}

        {step === 2 ? (
          <form onSubmit={handleSendOtp} className="rf-auth-stack">
            <ReferenceAuthField
              label="Contact"
              htmlFor="phone"
              helper={
                phoneError
                  ? phoneError
                  : availabilityState.phone === "checking" && formData.phone
                    ? "Checking phone..."
                    : undefined
              }
              helperTone={
                phoneError
                  ? "error"
                  : availabilityState.phone === "checking" && formData.phone
                    ? "info"
                    : "default"
              }
            >
              <ReferenceAuthInput
                id="phone"
                type="tel"
                placeholder="Contact Number"
                value={formData.phone}
                onChange={(event) => {
                  markFieldTouched("phone");
                  setFormData((previous) => ({
                    ...previous,
                    phone: event.target.value.replaceAll(/\D/g, "").slice(0, 10),
                  }));
                }}
                onBlur={() => markFieldTouched("phone")}
                invalid={Boolean(phoneError)}
                maxLength={10}
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Location"
              htmlFor="city"
              helper={cityError || undefined}
              helperTone={cityError ? "error" : "default"}
            >
              <ReferenceAuthSelect
                id="city"
                value={formData.city}
                onChange={(event) => {
                  markFieldTouched("city");
                  setFormData((previous) => ({ ...previous, city: event.target.value }));
                }}
                invalid={Boolean(cityError)}
                required
              >
                <option value="" disabled>
                  Location
                </option>
                {INDIAN_CITIES.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </ReferenceAuthSelect>
            </ReferenceAuthField>

            <ReferenceAuthButton type="submit" disabled={loading}>
              {loading ? "Sending..." : "Next"}
            </ReferenceAuthButton>

            <div className="rf-auth-link-row">
              <ReferenceAuthButton
                variant="link"
                type="button"
                onClick={() => setStep(1)}
              >
                Back
              </ReferenceAuthButton>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form onSubmit={handleVerifyOtp} className="rf-auth-stack">
            <ReferenceAuthField
              label="Email Verification Code"
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

            <ReferenceAuthButton type="submit" disabled={loading}>
              {loading ? "Signing Up..." : "Sign Up"}
            </ReferenceAuthButton>

            <div className="rf-auth-link-row">
              <ReferenceAuthButton
                variant="link"
                type="button"
                onClick={() => {
                  setStep(2);
                  setOtp("");
                }}
              >
                Back
              </ReferenceAuthButton>
            </div>
          </form>
        ) : null}
      </ReferenceAuthLayout>

      <OnboardingModal
        isOpen={showOnboarding}
        onClose={() => {
          setShowOnboarding(false);
          globalThis.location.href = "/";
        }}
      />
    </>
  );
};

export default Signup;
