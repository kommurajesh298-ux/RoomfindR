import React, { useEffect, useRef } from "react";
import "./reference-auth.css";

export type ReferenceAuthStep = {
  label: string;
  status: "active" | "complete" | "upcoming";
};

export type ReferenceAuthLayoutProps = {
  steps?: ReferenceAuthStep[];
  children: React.ReactNode;
  footer?: React.ReactNode;
  showBrand?: boolean;
  brandSrc?: string;
  brandAlt?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  shellClassName?: string;
  cardClassName?: string;
  bodyClassName?: string;
};

type ReferenceAuthFieldProps = {
  label: string;
  htmlFor?: string;
  helper?: React.ReactNode;
  helperTone?: "default" | "error" | "info";
  hideLabel?: boolean;
  children: React.ReactNode;
};

type ReferenceAuthInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
};

type ReferenceAuthSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  children: React.ReactNode;
};

type ReferenceAuthButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "link";
};

type ReferenceAuthPromptProps = {
  children: React.ReactNode;
};

type ReferenceAuthOtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
};

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export const ReferenceAuthLayout: React.FC<ReferenceAuthLayoutProps> = ({
  steps = [],
  children,
  footer,
  showBrand = true,
  brandSrc = `${import.meta.env.BASE_URL}assets/images/logos/logo.png`,
  brandAlt = "RoomFindR",
  heroTitle = "Manage your account",
  heroSubtitle = "Login, signup, OTP verification, and password reset in one clean flow.",
  shellClassName,
  cardClassName,
  bodyClassName,
}) => {
  return (
    <div className="rf-auth-page">
      <div className={cx("rf-auth-shell", shellClassName)}>
        <div className={cx("rf-auth-card", cardClassName)}>
          <div className="rf-auth-hero">
            <div className="rf-auth-hero-stage">
              <div className="rf-auth-hero-copy">
                {showBrand ? (
                  <div className="rf-auth-brand">
                    <span className="rf-auth-brand-mark">
                      <img
                        src={brandSrc}
                        alt={brandAlt}
                        className="rf-auth-brand-image no-logo-badge"
                      />
                    </span>
                    <span className="rf-auth-brand-name">{brandAlt}</span>
                  </div>
                ) : null}

                <div className="rf-auth-hero-emblem" aria-hidden="true">
                  <span className="rf-auth-hero-emblem-check">{"\u2713"}</span>
                </div>

                <div className="rf-auth-hero-copy-block">
                  <p className="rf-auth-hero-eyebrow">RoomFindR Access</p>
                  {heroTitle ? <h1 className="rf-auth-hero-title">{heroTitle}</h1> : null}
                  {heroSubtitle ? (
                    <p className="rf-auth-hero-subtitle">{heroSubtitle}</p>
                  ) : null}
                </div>
              </div>

              <div className="rf-auth-hero-visual" aria-hidden="true">
                <div className="rf-auth-hero-device">
                  <span className="rf-auth-hero-device-notch" />
                  <span className="rf-auth-hero-device-screen" />
                  <span className="rf-auth-hero-device-chip rf-auth-hero-device-chip-wide" />
                  <span className="rf-auth-hero-device-chip" />
                  <span className="rf-auth-hero-device-chip rf-auth-hero-device-chip-pill" />
                </div>
              </div>
            </div>
          </div>

          <div className="rf-auth-panel">
            <div className="rf-auth-panel-surface">
              {steps.length > 0 ? (
                <div className="rf-auth-card-header">
                  <ReferenceAuthStepper steps={steps} />
                </div>
              ) : null}

              <div className={cx("rf-auth-card-body", bodyClassName)}>
                {children}
                {footer ? <div className="rf-auth-card-footer">{footer}</div> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ReferenceAuthStepper: React.FC<{ steps: ReferenceAuthStep[] }> = ({
  steps,
}) => {
  return (
    <div className="rf-auth-stepper" aria-label="Progress">
      {steps.map((step, index) => {
        const isComplete = step.status === "complete";
        const isActive = step.status === "active";

        return (
          <div className="rf-auth-step" key={`${step.label}-${index}`}>
            <span
              className={cx(
                "rf-auth-step-node",
                isActive && "rf-auth-step-node-active",
                isComplete && "rf-auth-step-node-complete",
              )}
              aria-label={step.label}
              title={step.label}
            >
              {isComplete ? "\u2713" : index + 1}
            </span>
            <span className="rf-auth-step-label">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
};

export const ReferenceAuthField: React.FC<ReferenceAuthFieldProps> = ({
  label,
  htmlFor,
  helper,
  helperTone = "default",
  hideLabel = true,
  children,
}) => {
  return (
    <div className="rf-auth-field">
      <label className={cx("rf-auth-label", hideLabel && "rf-auth-hidden")} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {helper ? (
        <span
          className={cx(
            "rf-auth-helper",
            helperTone === "error" && "rf-auth-helper-error",
            helperTone === "info" && "rf-auth-helper-info",
          )}
        >
          {helper}
        </span>
      ) : null}
    </div>
  );
};

export const ReferenceAuthInput: React.FC<ReferenceAuthInputProps> = ({
  invalid = false,
  startAdornment,
  endAdornment,
  className,
  ...props
}) => {
  return (
    <span className={cx("rf-auth-input-wrap", invalid && "rf-auth-input-wrap-error")}>
      {startAdornment ? <span className="rf-auth-input-icon">{startAdornment}</span> : null}
      <input {...props} className={cx("rf-auth-input", className)} />
      {endAdornment ? <span className="rf-auth-input-action">{endAdornment}</span> : null}
    </span>
  );
};

export const ReferenceAuthSelect: React.FC<ReferenceAuthSelectProps> = ({
  invalid = false,
  className,
  children,
  ...props
}) => {
  return (
    <span className={cx("rf-auth-input-wrap", invalid && "rf-auth-input-wrap-error")}>
      <select {...props} className={cx("rf-auth-select", className)}>
        {children}
      </select>
      <span className="rf-auth-input-action rf-auth-select-arrow" aria-hidden="true">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="rf-auth-select-arrow-icon"
        >
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
};

export const ReferenceAuthButton = React.forwardRef<
  HTMLButtonElement,
  ReferenceAuthButtonProps
>(({ variant = "primary", className, type = "button", children, ...props }, ref) => {
  if (variant === "link") {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        className={cx("rf-auth-link-button", className)}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={cx(
        "rf-auth-button",
        variant === "primary" ? "rf-auth-button-primary" : "rf-auth-button-secondary",
        className,
      )}
    >
      {children}
    </button>
  );
});

ReferenceAuthButton.displayName = "ReferenceAuthButton";

export const ReferenceAuthPrompt: React.FC<ReferenceAuthPromptProps> = ({
  children,
}) => <div className="rf-auth-prompt">{children}</div>;

export const ReferenceAuthOtpInput: React.FC<ReferenceAuthOtpInputProps> = ({
  value,
  onChange,
  length = 6,
  autoFocus = true,
  disabled = false,
  className,
  inputClassName,
}) => {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) {
      inputsRef.current[0]?.focus();
    }
  }, [autoFocus]);

  const valueArray = Array.from({ length }, (_, index) => value[index] ?? "");

  const updateValueAt = (index: number, nextChar: string) => {
    const chars = valueArray.slice();
    chars[index] = nextChar;
    onChange(chars.join(""));
  };

  const handleChange = (index: number, rawValue: string) => {
    const digits = rawValue.replace(/\D/g, "");
    if (!digits) {
      updateValueAt(index, "");
      return;
    }

    const chars = valueArray.slice();
    let cursor = index;
    for (const digit of digits) {
      if (cursor >= length) break;
      chars[cursor] = digit;
      cursor += 1;
    }

    onChange(chars.join(""));

    if (cursor < length) {
      inputsRef.current[cursor]?.focus();
    } else {
      inputsRef.current[length - 1]?.blur();
    }
  };

  const handleKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (valueArray[index]) {
        updateValueAt(index, "");
      } else if (index > 0) {
        inputsRef.current[index - 1]?.focus();
        updateValueAt(index - 1, "");
      }
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputsRef.current[index - 1]?.focus();
    }

    if (event.key === "ArrowRight" && index < length - 1) {
      event.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!digits) return;

    event.preventDefault();
    const chars = valueArray.slice();
    let cursor = 0;
    for (const digit of digits) {
      if (cursor >= length) break;
      chars[cursor] = digit;
      cursor += 1;
    }

    onChange(chars.join(""));
    inputsRef.current[Math.min(cursor, length - 1)]?.focus();
  };

  return (
    <div className={cx("rf-auth-otp-grid", className)} onPaste={handlePaste}>
      {valueArray.map((digit, index) => (
        <input
          key={index}
          name={`otpDigit${index + 1}`}
          ref={(element) => {
            inputsRef.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          className={cx(
            "rf-auth-otp-input",
            digit && "rf-auth-otp-input-filled",
            inputClassName,
          )}
        />
      ))}
    </div>
  );
};

