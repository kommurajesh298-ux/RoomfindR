import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import {
  ReferenceAuthButton,
  ReferenceAuthField,
  ReferenceAuthInput,
  ReferenceAuthLayout,
  ReferenceAuthOtpInput,
  ReferenceAuthPrompt,
  type ReferenceAuthStep,
} from "../../../shared/auth-ui";
import LoadingOverlay from "../components/common/LoadingOverlay";
import Modal from "../components/common/Modal";
import { useAuth } from "../hooks/useAuth";
import { authService } from "../services/auth.service";
import { ownerService } from "../services/owner.service";
import { resolveOwnerVerificationState } from "../utils/ownerVerification";
import { showToast } from "../utils/toast";
import {
  validateEmail,
  validatePhone,
  validatePassword,
  validateIFSC,
  validateOTP,
} from "../utils/validation";

type SignupStep = 1 | 2 | 3 | 4;
type SignupFieldName =
  | "name"
  | "email"
  | "phone"
  | "password"
  | "confirmPassword";
type BankFieldName =
  | "accountHolderName"
  | "ifsc"
  | "accountNo"
  | "confirmAccountNo";
type BankVerificationPayload = {
  name: string;
  email: string;
  phone: string;
  accountHolderName?: string;
  ifsc?: string;
  maskedAccountNumber?: string | null;
  transferId?: string | null;
};
type LicenseUploadState = "idle" | "uploading" | "success" | "failed";
type UploadedLicenseDocument = {
  id: string;
  documentUrl: string;
  documentName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
};

const accountHolderRegex = /^[A-Za-z ]{3,}$/;
const BANK_VERIFICATION_STORAGE_KEY = "owner-signup-bank-verification";
const passwordValidationMessage =
  "Password must be at least 8 characters and include upper/lowercase letters and a number.";
const emailExistsMessage = "Email is already registered.";
const phoneExistsMessage = "Phone number is already registered.";
const cashfreeSandboxHint =
  "If Cashfree payouts are in TEST mode, use sandbox bank details: 000100289877623 / SBIN0008752 or 1233943142 / ICIC0000009.";
const licenseUploadAccept = "image/jpeg,image/png,image/webp,application/pdf";
const maxLicenseFileBytes = 5 * 1024 * 1024;

const buildSteps = (step: SignupStep): ReferenceAuthStep[] => [
  { label: "Account", status: step === 1 ? "active" : "complete" },
  { label: "License", status: step === 2 ? "active" : step > 2 ? "complete" : "upcoming" },
  { label: "Bank", status: step === 3 ? "active" : step > 3 ? "complete" : "upcoming" },
  { label: "OTP", status: step === 4 ? "active" : "upcoming" },
];

const Signup: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, ownerData } = useAuth();
  const [step, setStep] = useState<SignupStep>(1);
  const [loading, setLoading] = useState(false);
  const [showBlockingOverlay, setShowBlockingOverlay] = useState(false);
  const [blockingOverlayMessage, setBlockingOverlayMessage] = useState(
    "Creating account...",
  );
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [otp, setOtp] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [showAlreadyVerifiedModal, setShowAlreadyVerifiedModal] = useState(false);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [uploadedLicense, setUploadedLicense] = useState<UploadedLicenseDocument | null>(
    null,
  );
  const [licenseUploadState, setLicenseUploadState] =
    useState<LicenseUploadState>("idle");
  const [licenseUploadMessage, setLicenseUploadMessage] = useState<string | null>(null);
  const [bankVerificationState, setBankVerificationState] = useState<
    "idle" | "verifying" | "pending" | "success" | "failed" | "timeout"
  >("idle");
  const [bankVerificationMessage, setBankVerificationMessage] = useState<string | null>(
    null,
  );
  const bankVerificationAttempt = useRef(0);
  const bankVerificationPayloadRef = useRef<BankVerificationPayload | null>(null);
  const bankVerificationPollRef = useRef<number | null>(null);
  const bankVerificationPollInFlight = useRef(false);
  const sendOtpButtonRef = useRef<HTMLButtonElement | null>(null);
  const licenseInputRef = useRef<HTMLInputElement | null>(null);
  const emailCheckRequestRef = useRef(0);
  const phoneCheckRequestRef = useRef(0);
  const [signupFieldErrors, setSignupFieldErrors] = useState<
    Partial<Record<SignupFieldName, string>>
  >({});
  const [signupFieldTouched, setSignupFieldTouched] = useState<
    Partial<Record<SignupFieldName, boolean>>
  >({});
  const [signupFieldStatus, setSignupFieldStatus] = useState<{
    email: "idle" | "checking";
    phone: "idle" | "checking";
  }>({
    email: "idle",
    phone: "idle",
  });
  const [bankFieldErrors, setBankFieldErrors] = useState<
    Partial<Record<BankFieldName, string>>
  >({});
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    accountHolderName: "",
    ifsc: "",
    accountNo: "",
    confirmAccountNo: "",
    agreedToTerms: false,
  });

  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = window.setInterval(() => {
      setResendTimer((previous) => previous - 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendTimer]);

  useEffect(() => {
    setFormData((previous) => ({
      ...previous,
      accountHolderName:
        ownerData?.bankDetails?.accountHolderName || previous.accountHolderName,
      ifsc: ownerData?.bankDetails?.ifscCode || previous.ifsc,
    }));
  }, [ownerData?.bankDetails?.accountHolderName, ownerData?.bankDetails?.ifscCode]);

  useEffect(() => {
    if (!currentUser) return;

    const { ownerActive } = resolveOwnerVerificationState(ownerData);

    if (ownerActive) {
      navigate("/dashboard", { replace: true });
      return;
    }

    setStep(3);
  }, [currentUser, navigate, ownerData]);

  const stopBankVerificationPolling = () => {
    if (bankVerificationPollRef.current) {
      window.clearInterval(bankVerificationPollRef.current);
      bankVerificationPollRef.current = null;
    }
    bankVerificationPollInFlight.current = false;
  };

  const clearStoredBankVerification = () => {
    bankVerificationPayloadRef.current = null;
    window.sessionStorage.removeItem(BANK_VERIFICATION_STORAGE_KEY);
  };

  const persistBankVerification = (input: {
    transferStatus: "pending" | "success" | "failed";
    message: string;
    transferId?: string | null;
  }) => {
    if (currentUser || !bankVerificationPayloadRef.current?.email) {
      return;
    }

    const nextPayload = {
      ...bankVerificationPayloadRef.current,
      transferId:
        input.transferId ?? bankVerificationPayloadRef.current.transferId ?? null,
    };
    bankVerificationPayloadRef.current = nextPayload;

    window.sessionStorage.setItem(
      BANK_VERIFICATION_STORAGE_KEY,
      JSON.stringify({
        ...nextPayload,
        transferStatus: input.transferStatus,
        message: input.message,
      }),
    );
  };

  const startBankVerificationPolling = () => {
    if (bankVerificationPollRef.current) return;
    bankVerificationPollRef.current = window.setInterval(() => {
      void checkBankVerificationStatus(true);
    }, 5000);
    void checkBankVerificationStatus(true);
  };

  const focusSendOtpButton = () => {
    window.requestAnimationFrame(() => {
      sendOtpButtonRef.current?.focus();
    });
  };

  const handleCloseAlreadyVerifiedModal = () => {
    setShowAlreadyVerifiedModal(false);
    focusSendOtpButton();
  };

  useEffect(() => {
    if (step !== 3 || currentUser) {
      stopBankVerificationPolling();
      return;
    }

    if (
      bankVerificationState === "pending" ||
      bankVerificationState === "timeout"
    ) {
      startBankVerificationPolling();
    } else {
      stopBankVerificationPolling();
    }

    return stopBankVerificationPolling;
  }, [bankVerificationState, currentUser, step]);

  useEffect(() => {
    if (currentUser) {
      clearStoredBankVerification();
      return;
    }

    const rawValue = window.sessionStorage.getItem(BANK_VERIFICATION_STORAGE_KEY);
    if (!rawValue) return;

    try {
      const saved = JSON.parse(rawValue) as BankVerificationPayload & {
        transferStatus?: "pending" | "success" | "failed";
        message?: string;
      };
      if (!saved.email) {
        clearStoredBankVerification();
        return;
      }

      bankVerificationPayloadRef.current = saved;
      setFormData((previous) => ({
        ...previous,
        name: saved.name || previous.name,
        email: saved.email || previous.email,
        phone: saved.phone || previous.phone,
        accountHolderName: saved.accountHolderName || previous.accountHolderName,
        ifsc: saved.ifsc || previous.ifsc,
      }));

      if (
        saved.transferStatus === "pending" ||
        saved.transferStatus === "success" ||
        saved.transferStatus === "failed"
      ) {
        setStep(3);
        setBankVerificationState(saved.transferStatus);
        setBankVerificationMessage(saved.message || null);
      }
    } catch {
      clearStoredBankVerification();
    }
  }, [currentUser]);

  useEffect(() => {
    const email = normalizeEmail(formData.email);
    if (!signupFieldTouched.email || !email || !validateEmail(email)) {
      emailCheckRequestRef.current += 1;
      setSignupFieldStatus((previous) => ({ ...previous, email: "idle" }));
      setSignupFieldErrors((previous) => ({
        ...previous,
        email: validateSignupField("email", formData, {
          touched: signupFieldTouched,
        }),
      }));
      return;
    }

    const requestId = ++emailCheckRequestRef.current;
    const timeoutId = window.setTimeout(async () => {
      setSignupFieldStatus((previous) => ({ ...previous, email: "checking" }));
      const emailExists = await authService.checkEmailExists(email);
      if (emailCheckRequestRef.current !== requestId) return;
      setSignupFieldStatus((previous) => ({ ...previous, email: "idle" }));
      setSignupFieldErrors((previous) => ({
        ...previous,
        email: validateSignupField("email", { ...formData, email }, {
          touched: { ...signupFieldTouched, email: true },
          emailExists,
        }),
      }));
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [formData.email, signupFieldTouched.email]);

  useEffect(() => {
    if (
      !signupFieldTouched.phone ||
      !formData.phone ||
      !validatePhone(formData.phone)
    ) {
      phoneCheckRequestRef.current += 1;
      setSignupFieldStatus((previous) => ({ ...previous, phone: "idle" }));
      setSignupFieldErrors((previous) => ({
        ...previous,
        phone: validateSignupField("phone", formData, {
          touched: signupFieldTouched,
        }),
      }));
      return;
    }

    const requestId = ++phoneCheckRequestRef.current;
    const timeoutId = window.setTimeout(async () => {
      setSignupFieldStatus((previous) => ({ ...previous, phone: "checking" }));
      const phoneExists = await authService.checkPhoneExists(formData.phone);
      if (phoneCheckRequestRef.current !== requestId) return;
      setSignupFieldStatus((previous) => ({ ...previous, phone: "idle" }));
      setSignupFieldErrors((previous) => ({
        ...previous,
        phone: validateSignupField("phone", formData, {
          touched: { ...signupFieldTouched, phone: true },
          phoneExists,
        }),
      }));
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [formData.phone, signupFieldTouched.phone]);

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const normalizeIfsc = (value: string) =>
    value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normalizeAccountNumber = (value: string) => value.replace(/\D/g, "");
  const formatFileSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };
  const validateLicenseFile = (file: File | null): string => {
    if (!file) return "Please choose your registration or business license.";

    if (
      ![
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
      ].includes(file.type)
    ) {
      return "Upload a JPG, PNG, WEBP, or PDF license document.";
    }

    if (file.size > maxLicenseFileBytes) {
      return "License document must be 5 MB or smaller.";
    }

    return "";
  };
  const resetLicenseUpload = () => {
    setLicenseFile(null);
    setUploadedLicense(null);
    setLicenseUploadState("idle");
    setLicenseUploadMessage(null);

    if (licenseInputRef.current) {
      licenseInputRef.current.value = "";
    }
  };

  const validateSignupField = (
    field: SignupFieldName,
    values: typeof formData,
    options?: {
      touched?: Partial<Record<SignupFieldName, boolean>>;
      force?: boolean;
      emailExists?: boolean;
      phoneExists?: boolean;
    },
  ): string => {
    const touched = options?.force || options?.touched?.[field];
    if (!touched) return "";

    if (field === "name") {
      return values.name.trim() ? "" : "Please enter your full name.";
    }

    if (field === "email") {
      const email = normalizeEmail(values.email);
      if (!email) return "Please enter your email address.";
      if (!validateEmail(email)) return "Please enter a valid email address.";
      if (options?.emailExists) return emailExistsMessage;
      return "";
    }

    if (field === "phone") {
      if (!values.phone) return "Please enter your 10-digit phone number.";
      if (!validatePhone(values.phone)) {
        return "Please enter a valid 10-digit phone number.";
      }
      if (options?.phoneExists) return phoneExistsMessage;
      return "";
    }

    if (field === "password") {
      if (!values.password) return "Please enter a password.";
      if (!validatePassword(values.password)) {
        return passwordValidationMessage;
      }
      return "";
    }

    if (!values.confirmPassword) return "Please confirm your password.";
    return values.password === values.confirmPassword
      ? ""
      : "Passwords do not match.";
  };

  const validateSignupFields = (
    values: typeof formData,
    options?: {
      touched?: Partial<Record<SignupFieldName, boolean>>;
      force?: boolean;
      emailExists?: boolean;
      phoneExists?: boolean;
    },
  ) => ({
    name: validateSignupField("name", values, options),
    email: validateSignupField("email", values, options),
    phone: validateSignupField("phone", values, options),
    password: validateSignupField("password", values, options),
    confirmPassword: validateSignupField("confirmPassword", values, options),
  });

  const resolveFieldHelper = (field: "email" | "phone", error?: string) => {
    if (error) return { helper: error, tone: "error" as const };
    if (signupFieldStatus[field] === "checking") {
      return {
        helper:
          field === "email"
            ? "Checking email availability..."
            : "Checking phone number availability...",
        tone: "info" as const,
      };
    }
    return { helper: undefined, tone: "default" as const };
  };

  const resolveVerificationMessage = (result: {
    message?: string;
    verification?: { transfer_status?: string | null; status_message?: string | null } | null;
  }) => {
    const transferStatus = result.verification?.transfer_status || "pending";
    return (
      result.message ||
      result.verification?.status_message ||
      (transferStatus === "success"
        ? "Bank account verified successfully."
        : transferStatus === "failed"
          ? "Bank verification failed. Please check your bank details."
          : "Verifying your bank account. Please wait...")
    );
  };

  const applyVerificationResult = (
    result: {
      message?: string;
      verification?: { transfer_status?: string | null; status_message?: string | null } | null;
      transfer_id?: string | null;
      already_verified?: boolean;
    },
    options?: { announce?: boolean },
  ) => {
    const transferStatus = result.verification?.transfer_status || "pending";
    const userMessage = resolveVerificationMessage(result);
    persistBankVerification({
      transferStatus:
        transferStatus === "success"
          ? "success"
          : transferStatus === "failed"
            ? "failed"
            : "pending",
      message: userMessage,
      transferId: result.transfer_id || null,
    });

    if (transferStatus === "success") {
      setBankVerificationState("success");
      setBankVerificationMessage(userMessage);
      stopBankVerificationPolling();
      if (result.already_verified && options?.announce) {
        setShowAlreadyVerifiedModal(true);
      }
      if (options?.announce) showToast.success(userMessage);
      if (currentUser) {
        navigate("/dashboard", { replace: true });
      }
      return;
    }

    if (transferStatus === "failed") {
      setBankVerificationState("failed");
      setBankVerificationMessage(userMessage);
      stopBankVerificationPolling();
      if (options?.announce) showToast.error(userMessage);
      return;
    }

    setBankVerificationState("pending");
    setBankVerificationMessage(userMessage);
    if (options?.announce) showToast.success(userMessage);
  };

  const checkBankVerificationStatus = async (silent = false) => {
    if (bankVerificationPollInFlight.current) return;
    if (currentUser) return;
    const payload = bankVerificationPayloadRef.current;
    if (!payload?.email) {
      if (!silent) {
        showToast.error("Verify your bank details first.");
      }
      return;
    }

    bankVerificationPollInFlight.current = true;
    try {
      const result = await authService.verifyOwnerBankPreSignup({
        email: payload.email,
        phone: payload.phone,
        transferId: payload.transferId || null,
        statusOnly: true,
      });
      applyVerificationResult(result, { announce: !silent });
    } catch {
      if (!silent) {
        showToast.error("Unable to check bank status. Please try again.");
      }
    } finally {
      bankVerificationPollInFlight.current = false;
    }
  };

  const handleCheckBankStatus = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await checkBankVerificationStatus(false);
    } finally {
      setLoading(false);
    }
  };

  const validateBankField = (
    field: BankFieldName,
    values: typeof formData,
  ): string => {
    const accountNo = normalizeAccountNumber(values.accountNo);
    const confirmAccountNo = normalizeAccountNumber(values.confirmAccountNo);

    if (field === "accountHolderName") {
      if (!values.accountHolderName.trim()) return "Account holder name is required.";
      if (!accountHolderRegex.test(values.accountHolderName.trim())) {
        return "Enter a valid account holder name.";
      }
      return "";
    }

    if (field === "ifsc") {
      if (!values.ifsc.trim()) return "IFSC is required.";
      if (!validateIFSC(normalizeIfsc(values.ifsc))) {
        return "Enter a valid IFSC (for example HDFC0001234).";
      }
      return "";
    }

    if (field === "accountNo") {
      if (!accountNo) return "Account number is required.";
      if (accountNo.length < 9 || accountNo.length > 18) {
        return "Account number must be 9 to 18 digits.";
      }
      return "";
    }

    if (!confirmAccountNo) return "Please confirm account number.";
    return accountNo === confirmAccountNo ? "" : "Account numbers do not match.";
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    let nextValue = value;

    if (name === "email") nextValue = value.toLowerCase();
    if (name === "phone") nextValue = value.replace(/\D/g, "").slice(0, 10);
    if (name === "ifsc") nextValue = normalizeIfsc(value);
    if (name === "accountNo" || name === "confirmAccountNo") {
      nextValue = normalizeAccountNumber(value);
    }

    const nextFormData = { ...formData, [name]: nextValue };
    setFormData(nextFormData);

    if (
      name === "name" ||
      name === "email" ||
      name === "phone" ||
      name === "password" ||
      name === "confirmPassword"
    ) {
      const fieldName = name as SignupFieldName;
      const nextTouched = { ...signupFieldTouched, [fieldName]: true };
      setSignupFieldTouched(nextTouched);
      setSignupFieldErrors((previous) => ({
        ...previous,
        [fieldName]: validateSignupField(fieldName, nextFormData, {
          touched: nextTouched,
        }),
        ...(fieldName === "password" || fieldName === "confirmPassword"
          ? {
              confirmPassword: validateSignupField(
                "confirmPassword",
                nextFormData,
                {
                  touched: {
                    ...nextTouched,
                    confirmPassword:
                      nextTouched.confirmPassword ||
                      Boolean(nextFormData.confirmPassword),
                  },
                },
              ),
            }
          : {}),
      }));
    }

    if (name === "name" || name === "email" || name === "phone") {
      stopBankVerificationPolling();
      clearStoredBankVerification();
      if (bankVerificationState !== "idle") {
        setBankVerificationState("idle");
        setBankVerificationMessage(null);
      }
      if (
        name === "email" &&
        (uploadedLicense || licenseFile || licenseUploadState !== "idle")
      ) {
        resetLicenseUpload();
      }
    }

    if (
      name === "accountHolderName" ||
      name === "ifsc" ||
      name === "accountNo" ||
      name === "confirmAccountNo"
    ) {
      stopBankVerificationPolling();
      clearStoredBankVerification();
      if (bankVerificationState !== "idle") {
        setBankVerificationState("idle");
        setBankVerificationMessage(null);
      }
      const fieldName = name as BankFieldName;
      setBankFieldErrors((previous) => ({
        ...previous,
        [fieldName]: validateBankField(fieldName, nextFormData),
        ...(fieldName === "accountNo" || fieldName === "confirmAccountNo"
          ? {
              confirmAccountNo: validateBankField(
                "confirmAccountNo",
                nextFormData,
              ),
            }
          : {}),
      }));
    }
  };

  const handleContinueToBank = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const email = normalizeEmail(formData.email);
    const nextTouched: Partial<Record<SignupFieldName, boolean>> = {
      name: true,
      email: true,
      phone: true,
      password: true,
      confirmPassword: true,
    };
    const normalizedForm = {
      ...formData,
      name: formData.name.trim(),
      email,
    };
    setSignupFieldTouched(nextTouched);
    const localErrors = validateSignupFields(normalizedForm, {
      touched: nextTouched,
      force: true,
    });
    setSignupFieldErrors(localErrors);
    if (Object.values(localErrors).some(Boolean)) {
      return showToast.error("Please fix the highlighted fields.");
    }
    if (!formData.agreedToTerms) {
      return showToast.error("You must agree to the Terms and Conditions.");
    }

    setLoading(true);
    try {
      const [emailExists, phoneExists] = await Promise.all([
        authService.checkEmailExists(email),
        authService.checkPhoneExists(normalizedForm.phone),
      ]);

      if (emailExists || phoneExists) {
        setSignupFieldErrors(
          validateSignupFields(normalizedForm, {
            touched: nextTouched,
            force: true,
            emailExists,
            phoneExists,
          }),
        );
        showToast.error("Email or phone number is already registered.");
        return;
      }

      setFormData((previous) => ({
        ...previous,
        name: previous.name.trim(),
        email,
      }));
      clearStoredBankVerification();
      setBankVerificationState("idle");
      setBankVerificationMessage(null);
      setStep(2);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to continue.";
      showToast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (!validateOTP(otp)) {
      return showToast.error("Please enter a valid 6-digit OTP.");
    }

    if (!validatePassword(formData.password)) {
      setSignupFieldTouched((previous) => ({
        ...previous,
        password: true,
        confirmPassword: true,
      }));
      setSignupFieldErrors((previous) => ({
        ...previous,
        password: passwordValidationMessage,
      }));
      setStep(1);
      return showToast.error(passwordValidationMessage);
    }

    setLoading(true);
    setShowBlockingOverlay(true);
    setBlockingOverlayMessage("Creating account...");
    try {
      const verification = await authService.verifyEmailOtp({
        email: formData.email,
        otp,
        password: formData.password,
        role: "owner",
        name: formData.name.trim(),
        phone: formData.phone,
        transferId: bankVerificationPayloadRef.current?.transferId || null,
      });

      if (!verification.success || !verification.user_id) {
        throw new Error("Unable to verify OTP.");
      }

      await authService.signInWithEmail(formData.email, formData.password);
      await authService.updateUserProfile({ name: formData.name.trim() });
      clearStoredBankVerification();
      setOtp("");
      if (verification.account_status === "pending_admin_approval") {
        showToast.success(
          "Account created successfully. Wait for admin approval to access the owner dashboard.",
        );
        navigate("/verification-status", { replace: true });
        return;
      }

      showToast.success("Account verified successfully.");
      navigate("/dashboard", { replace: true });
    } catch (error) {
      const authError = error as Error & { code?: string };
      const rawMessage = authError instanceof Error ? authError.message : "";
      const normalized = rawMessage.toLowerCase();

      if (authError?.code === "invalid_password") {
        setSignupFieldTouched((previous) => ({
          ...previous,
          password: true,
          confirmPassword: true,
        }));
        setSignupFieldErrors((previous) => ({
          ...previous,
          password: passwordValidationMessage,
        }));
        setStep(1);
        showToast.error(passwordValidationMessage);
        return;
      }

      if (authError?.code === "bank_validation_required") {
        showToast.error("Verify your bank details before requesting OTP.");
        setStep(3);
        return;
      }

      if (authError?.code === "license_document_required") {
        resetLicenseUpload();
        showToast.error("Upload your license document before completing signup.");
        setStep(2);
        return;
      }

      if (normalized.includes("otp")) {
        showToast.error("Invalid or expired OTP. Please try again.");
      } else {
        showToast.error(rawMessage || "Failed to verify OTP.");
      }
    } finally {
      setShowBlockingOverlay(false);
      setLoading(false);
    }
  };

  const handleVerifyBank = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const normalizedForm = {
      ...formData,
      accountHolderName: formData.accountHolderName.trim(),
      ifsc: normalizeIfsc(formData.ifsc),
      accountNo: normalizeAccountNumber(formData.accountNo),
      confirmAccountNo: normalizeAccountNumber(formData.confirmAccountNo),
    };
    setFormData(normalizedForm);

    const nextErrors: Partial<Record<BankFieldName, string>> = {};
    ([
      "accountHolderName",
      "ifsc",
      "accountNo",
      "confirmAccountNo",
    ] as BankFieldName[]).forEach((field) => {
      const message = validateBankField(field, normalizedForm);
      if (message) nextErrors[field] = message;
    });
    setBankFieldErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return showToast.error("Please fix the bank detail errors to continue.");
    }

    setLoading(true);
    setShowBlockingOverlay(true);
    setBlockingOverlayMessage("Verifying bank account...");
    const attemptId = ++bankVerificationAttempt.current;
    setBankVerificationState("verifying");
    setBankVerificationMessage("Verifying your bank account. Please wait...");
    const timeoutId = window.setTimeout(() => {
      if (bankVerificationAttempt.current !== attemptId) return;
      setBankVerificationState("timeout");
      setBankVerificationMessage(
        "Verification taking longer than expected. Please try again.",
      );
      setShowBlockingOverlay(false);
      setLoading(false);
    }, 60_000);
    try {
      clearStoredBankVerification();
      const result = currentUser
        ? await ownerService.verifyOwnerBank({
            accountHolderName: normalizedForm.accountHolderName,
            accountNumber: normalizedForm.accountNo,
            confirmAccountNumber: normalizedForm.confirmAccountNo,
            ifsc: normalizedForm.ifsc,
          })
        : await authService.verifyOwnerBankPreSignup({
            name: normalizedForm.name,
            email: normalizedForm.email,
            phone: normalizedForm.phone,
            accountHolderName: normalizedForm.accountHolderName,
            accountNumber: normalizedForm.accountNo,
            confirmAccountNumber: normalizedForm.confirmAccountNo,
            ifsc: normalizedForm.ifsc,
          });
      if (!currentUser) {
        bankVerificationPayloadRef.current = {
          name: normalizedForm.name,
          email: normalizedForm.email,
          phone: normalizedForm.phone,
          accountHolderName: normalizedForm.accountHolderName,
          ifsc: normalizedForm.ifsc,
          maskedAccountNumber: normalizedForm.accountNo
            ? `XXXX${normalizedForm.accountNo.slice(-4)}`
            : null,
          transferId: result.transfer_id || null,
        };
      }
      if (bankVerificationAttempt.current !== attemptId) return;
      window.clearTimeout(timeoutId);
      applyVerificationResult(result, { announce: true });
    } catch (error) {
      const authError = error as Error & { code?: string };
      if (bankVerificationAttempt.current !== attemptId) return;
      window.clearTimeout(timeoutId);
      const message =
        authError instanceof Error
          ? authError.message
          : "Unable to verify bank account.";
      if (authError?.code === "license_document_required") {
        resetLicenseUpload();
        clearStoredBankVerification();
        setBankVerificationState("idle");
        setBankVerificationMessage(null);
        showToast.error(message);
        setStep(2);
        return;
      }
      if (authError?.code === "cashfree_test_bank_details_required") {
        setBankFieldErrors((previous) => ({
          ...previous,
          accountNo: cashfreeSandboxHint,
          ifsc: cashfreeSandboxHint,
        }));
      }
      clearStoredBankVerification();
      setBankVerificationState("failed");
      setBankVerificationMessage(message);
      showToast.error(message);
    } finally {
      if (bankVerificationAttempt.current === attemptId) {
        setShowBlockingOverlay(false);
        setLoading(false);
      }
    }
  };

  const handleSendOtp = async () => {
    if (loading) return;
    if (bankVerificationState !== "success") {
      showToast.error("Verify your bank account before requesting OTP.");
      return;
    }

    setLoading(true);
    try {
      try {
        const verificationStatus = await authService.verifyOwnerBankPreSignup({
          email: formData.email,
          phone: formData.phone,
          transferId: bankVerificationPayloadRef.current?.transferId || null,
          statusOnly: true,
        });

        applyVerificationResult(verificationStatus);
        if (verificationStatus.verification?.transfer_status !== "success") {
          showToast.error(
            verificationStatus.message ||
              "Verify your bank account before requesting OTP.",
          );
          return;
        }
      } catch (error) {
        const authError = error as Error & { code?: string };
        clearStoredBankVerification();
        setBankVerificationState("idle");
        setBankVerificationMessage(null);
        const message =
          authError instanceof Error
            ? authError.message
            : "Verify your bank account before requesting OTP.";
        if (authError?.code === "license_document_required") {
          resetLicenseUpload();
          showToast.error(message);
          setStep(2);
          return;
        }
        showToast.error(message);
        return;
      }

      await authService.requestEmailOtp(formData.email, {
        role: "owner",
        phone: formData.phone,
        transferId: bankVerificationPayloadRef.current?.transferId || null,
      });
      setOtp("");
      setResendTimer(30);
      setStep(4);
      showToast.success("OTP sent to your email.");
    } catch (error) {
      const authError = error as Error & { code?: string };
      const message =
        authError instanceof Error ? authError.message : "Failed to send OTP.";
      if (authError?.code === "license_document_required") {
        resetLicenseUpload();
        showToast.error(message);
        setStep(2);
        return;
      }
      showToast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (loading || resendTimer > 0) return;

    setLoading(true);
    try {
      await authService.requestEmailOtp(formData.email, {
        role: "owner",
        phone: formData.phone,
        transferId: bankVerificationPayloadRef.current?.transferId || null,
      });
      setResendTimer(30);
      showToast.success("OTP resent successfully.");
    } catch (error) {
      const authError = error as Error & { code?: string };
      const message = authError.message?.toLowerCase() ?? "";
      if (authError?.code === "license_document_required") {
        resetLicenseUpload();
        showToast.error(authError.message);
        setStep(2);
        return;
      }
      if (message.includes("rate") || message.includes("too many")) {
        showToast.error("Please wait before requesting another OTP.");
      } else {
        showToast.error("Failed to resend OTP.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLicenseFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const nextFile = event.target.files?.[0] ?? null;

    if (!nextFile) {
      setLicenseFile(null);
      if (!uploadedLicense) {
        setLicenseUploadState("idle");
        setLicenseUploadMessage(null);
      }
      return;
    }

    const validationError = validateLicenseFile(nextFile);
    if (validationError) {
      setLicenseFile(null);
      setLicenseUploadState("failed");
      setLicenseUploadMessage(validationError);
      event.target.value = "";
      return;
    }

    setLicenseFile(nextFile);
    setUploadedLicense(null);
    setLicenseUploadState("idle");
    setLicenseUploadMessage(
      `${nextFile.name} selected. Upload it before continuing.`,
    );
  };

  const handleUploadLicense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    const validationError = validateLicenseFile(licenseFile);
    if (validationError) {
      setLicenseUploadState("failed");
      setLicenseUploadMessage(validationError);
      showToast.error(validationError);
      return;
    }

    if (!licenseFile) {
      return;
    }

    setLoading(true);
    setShowBlockingOverlay(true);
    setBlockingOverlayMessage("Uploading license...");
    setLicenseUploadState("uploading");
    setLicenseUploadMessage("Uploading your license document...");

    try {
      const result = await authService.uploadOwnerLicensePreSignup({
        email: formData.email,
        phone: formData.phone,
        name: formData.name.trim(),
        file: licenseFile,
      });

      if (!result.document?.document_url) {
        throw new Error("Unable to save the uploaded license document.");
      }

      setUploadedLicense({
        id: result.document.id,
        documentUrl: result.document.document_url,
        documentName: result.document.document_name,
        mimeType: result.document.mime_type,
        fileSizeBytes: result.document.file_size_bytes,
      });
      setLicenseFile(null);
      if (licenseInputRef.current) {
        licenseInputRef.current.value = "";
      }
      setLicenseUploadState("success");
      setLicenseUploadMessage(
        result.message || "License document uploaded successfully.",
      );
      showToast.success(result.message || "License uploaded successfully.");
    } catch (error) {
      const authError = error as Error & { code?: string };
      const message =
        error instanceof Error
          ? error.message
          : "Unable to upload license document.";
      if (authError?.code === "account_exists") {
        const existingAccountMessage =
          "An account with this email already exists. Sign in instead or use a different email address.";
        setLicenseUploadState("failed");
        setLicenseUploadMessage(existingAccountMessage);
        setSignupFieldTouched((previous) => ({ ...previous, email: true }));
        setSignupFieldErrors((previous) => ({
          ...previous,
          email: existingAccountMessage,
        }));
        showToast.error(existingAccountMessage);
        setStep(1);
        return;
      }
      setLicenseUploadState("failed");
      setLicenseUploadMessage(message);
      showToast.error(message);
    } finally {
      setShowBlockingOverlay(false);
      setLoading(false);
    }
  };

  const handleContinueToBankDetails = () => {
    if (!uploadedLicense) {
      showToast.error("Upload your license document to continue.");
      return;
    }

    setStep(3);
  };

  const bankInputsDisabled =
    loading ||
    bankVerificationState === "verifying" ||
    bankVerificationState === "pending" ||
    bankVerificationState === "success";
  const bankVerifyButtonDisabled =
    loading ||
    bankVerificationState === "verifying" ||
    bankVerificationState === "pending" ||
    bankVerificationState === "success";
  const bankMessageTone =
    bankVerificationState === "success"
      ? "rf-auth-status-banner-success"
      : bankVerificationState === "failed"
        ? "rf-auth-status-banner-warning"
        : bankVerificationState === "timeout"
          ? "rf-auth-status-banner-warning"
          : "rf-auth-status-banner-info";
  const verifyBankLabel =
    bankVerificationState === "success"
      ? "Verified"
      : bankVerificationState === "pending"
        ? "Verification Pending"
        : bankVerificationState === "timeout"
          ? "Retry Verification"
          : loading
            ? "Verifying..."
            : "Verify Bank Account";
  const licenseMessageTone =
    licenseUploadState === "failed"
      ? "error"
      : licenseUploadState === "uploading" || licenseUploadState === "success"
        ? "info"
        : "default";
  const uploadedLicenseIsImage =
    uploadedLicense?.mimeType?.startsWith("image/") ?? false;

  return (
    <>
      {showBlockingOverlay ? (
        <LoadingOverlay message={blockingOverlayMessage} />
      ) : null}

      <ReferenceAuthLayout
        heroTitle="SIGNUP"
        heroSubtitle=""
        shellClassName={
          step === 4
            ? "rf-auth-shell--signup rf-auth-shell--owner-signup rf-auth-shell--signup-otp"
            : "rf-auth-shell--signup rf-auth-shell--owner-signup"
        }
        cardClassName="rf-auth-card--signup rf-auth-card--owner-signup"
        bodyClassName="rf-auth-body--signup rf-auth-body--owner-signup"
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
          <form onSubmit={handleContinueToBank} className="rf-auth-stack">
            <ReferenceAuthField
              label="Full Name"
              htmlFor="name"
              helper={signupFieldErrors.name || undefined}
              helperTone={signupFieldErrors.name ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="name"
                name="name"
                type="text"
                placeholder="Full Name"
                value={formData.name}
                onChange={handleChange}
                autoComplete="name"
                invalid={Boolean(signupFieldErrors.name)}
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Email"
              htmlFor="email"
              helper={resolveFieldHelper("email", signupFieldErrors.email).helper}
              helperTone={resolveFieldHelper("email", signupFieldErrors.email).tone}
            >
              <ReferenceAuthInput
                id="email"
                name="email"
                type="email"
                placeholder="Email"
                value={formData.email}
                onChange={handleChange}
                autoComplete="email"
                invalid={Boolean(signupFieldErrors.email)}
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Contact"
              htmlFor="phone"
              helper={resolveFieldHelper("phone", signupFieldErrors.phone).helper}
              helperTone={resolveFieldHelper("phone", signupFieldErrors.phone).tone}
            >
              <ReferenceAuthInput
                id="phone"
                name="phone"
                type="tel"
                placeholder="Contact Number"
                value={formData.phone}
                onChange={handleChange}
                autoComplete="tel"
                maxLength={10}
                invalid={Boolean(signupFieldErrors.phone)}
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Password"
              htmlFor="password"
              helper={signupFieldErrors.password || undefined}
              helperTone={signupFieldErrors.password ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
                autoComplete="new-password"
                invalid={Boolean(signupFieldErrors.password)}
                required
                endAdornment={
                  <button
                    type="button"
                    onClick={() => setShowPassword((previous) => !previous)}
                    className="rf-auth-icon-button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                }
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Confirm Password"
              htmlFor="confirmPassword"
              helper={signupFieldErrors.confirmPassword || undefined}
              helperTone={signupFieldErrors.confirmPassword ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm Password"
                value={formData.confirmPassword}
                onChange={handleChange}
                autoComplete="new-password"
                invalid={Boolean(signupFieldErrors.confirmPassword)}
                required
                endAdornment={
                  <button
                    type="button"
                    onClick={() =>
                      setShowConfirmPassword((previous) => !previous)
                    }
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

            <label className="rf-auth-checkbox" htmlFor="terms">
              <input
                id="terms"
                name="terms"
                type="checkbox"
                autoComplete="off"
                checked={formData.agreedToTerms}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    agreedToTerms: event.target.checked,
                  }))
                }
              />
              <span>
                I agree to the{" "}
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  className="rf-auth-link-button"
                >
                  Terms and Conditions
                </button>
              </span>
            </label>

            <ReferenceAuthButton type="submit" disabled={loading}>
              {loading ? "Continuing..." : "Continue"}
            </ReferenceAuthButton>
          </form>
        ) : null}

        {step === 2 ? (
          <form onSubmit={handleUploadLicense} className="rf-auth-stack">
            <div className="rf-auth-note-card">
              <p className="rf-auth-note-eyebrow">
                Registration / Business License
              </p>
              <p className="rf-auth-note-text">
                Upload your license document to continue.
              </p>
            </div>

            <ReferenceAuthField
              label="License Document"
              htmlFor="licenseDocument"
              helper={licenseUploadMessage || undefined}
              helperTone={licenseMessageTone}
            >
              <div className="rf-auth-file-card">
                <input
                  ref={licenseInputRef}
                  id="licenseDocument"
                  name="licenseDocument"
                  type="file"
                  autoComplete="off"
                  accept={licenseUploadAccept}
                  onChange={handleLicenseFileChange}
                  disabled={loading}
                  className="rf-auth-file-input"
                />
              </div>
            </ReferenceAuthField>

            {licenseFile ? (
              <div className="rf-auth-file-summary">
                <p className="rf-auth-note-eyebrow">
                  Selected File
                </p>
                <p className="rf-auth-note-text break-all">
                  {licenseFile.name}
                </p>
                <p className="rf-auth-note-footnote">
                  {formatFileSize(licenseFile.size)}
                </p>
              </div>
            ) : null}

            {uploadedLicense ? (
              <div className="rf-auth-file-success">
                <p className="rf-auth-note-eyebrow">
                  License Uploaded
                </p>
                <p className="rf-auth-note-text break-all">
                  {uploadedLicense.documentName || "License document"}
                </p>
                {uploadedLicense.fileSizeBytes ? (
                  <p className="rf-auth-note-footnote">
                    {formatFileSize(uploadedLicense.fileSizeBytes)}
                  </p>
                ) : null}
                <div className="rf-auth-preview-frame">
                  {uploadedLicenseIsImage ? (
                    <img
                      src={uploadedLicense.documentUrl}
                      alt="Uploaded license preview"
                      className="rf-auth-preview-image"
                    />
                  ) : (
                    <div className="flex min-h-20 items-center justify-center px-4 text-center text-sm font-semibold text-[#1d2a3b]">
                      PDF uploaded successfully.
                    </div>
                  )}
                </div>
                <a
                  href={uploadedLicense.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rf-auth-file-link"
                >
                  Open uploaded document
                </a>
              </div>
            ) : null}

            <div className="rf-auth-actions-stack">
              <ReferenceAuthButton
                type="submit"
                disabled={loading || licenseUploadState === "uploading" || !licenseFile}
              >
                {loading && licenseUploadState === "uploading"
                  ? "Uploading..."
                  : "Upload License"}
              </ReferenceAuthButton>
              <ReferenceAuthButton
                variant="secondary"
                type="button"
                onClick={handleContinueToBankDetails}
                disabled={loading || !uploadedLicense}
              >
                Continue to Bank Details
              </ReferenceAuthButton>
            </div>

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
          <form onSubmit={handleVerifyBank} className="rf-auth-stack">
            <ReferenceAuthField
              label="Account Holder Full Name"
              htmlFor="accountHolderName"
              helper={bankFieldErrors.accountHolderName || undefined}
              helperTone={bankFieldErrors.accountHolderName ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="accountHolderName"
                name="accountHolderName"
                type="text"
                placeholder="Account Holder Full Name"
                value={formData.accountHolderName}
                onChange={handleChange}
                autoComplete="name"
                invalid={Boolean(bankFieldErrors.accountHolderName)}
                disabled={bankInputsDisabled}
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="IFSC Code"
              htmlFor="ifsc"
              helper={bankFieldErrors.ifsc || undefined}
              helperTone={bankFieldErrors.ifsc ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="ifsc"
                name="ifsc"
                type="text"
                placeholder="IFSC Code"
                value={formData.ifsc}
                onChange={handleChange}
                autoComplete="off"
                invalid={Boolean(bankFieldErrors.ifsc)}
                maxLength={11}
                disabled={bankInputsDisabled}
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Account Number"
              htmlFor="accountNo"
              helper={bankFieldErrors.accountNo || undefined}
              helperTone={bankFieldErrors.accountNo ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="accountNo"
                name="accountNo"
                type="text"
                placeholder="Account Number"
                value={formData.accountNo}
                onChange={handleChange}
                autoComplete="off"
                invalid={Boolean(bankFieldErrors.accountNo)}
                disabled={bankInputsDisabled}
                required
              />
            </ReferenceAuthField>

            <ReferenceAuthField
              label="Confirm Account Number"
              htmlFor="confirmAccountNo"
              helper={bankFieldErrors.confirmAccountNo || undefined}
              helperTone={bankFieldErrors.confirmAccountNo ? "error" : "default"}
            >
              <ReferenceAuthInput
                id="confirmAccountNo"
                name="confirmAccountNo"
                type="password"
                placeholder="Confirm Account Number"
                value={formData.confirmAccountNo}
                onChange={handleChange}
                autoComplete="off"
                invalid={Boolean(bankFieldErrors.confirmAccountNo)}
                disabled={bankInputsDisabled}
                required
              />
            </ReferenceAuthField>

            <div className="rf-auth-note-card">
              <p className="rf-auth-note-eyebrow">
                Penny Drop Verification
              </p>
              <p className="rf-auth-note-text">
                We will send Rs 1 to this bank account and activate your owner
                account after verification succeeds.
              </p>
              <p className="rf-auth-note-footnote">
                {cashfreeSandboxHint}
              </p>
            </div>

            {bankVerificationMessage ? (
              <div className={`rf-auth-status-banner ${bankMessageTone}`}>
                {bankVerificationMessage}
              </div>
            ) : null}

            <div className="rf-auth-actions-stack">
              <ReferenceAuthButton type="submit" disabled={bankVerifyButtonDisabled}>
                {verifyBankLabel}
              </ReferenceAuthButton>
              {!currentUser &&
              (bankVerificationState === "pending" ||
                bankVerificationState === "timeout") ? (
                <ReferenceAuthButton
                  variant="secondary"
                  type="button"
                  onClick={handleCheckBankStatus}
                  disabled={loading}
                >
                  {loading ? "Checking..." : "Check Status"}
                </ReferenceAuthButton>
              ) : null}
              {!currentUser ? (
                <ReferenceAuthButton
                  variant="secondary"
                  type="button"
                  ref={sendOtpButtonRef}
                  onClick={handleSendOtp}
                  disabled={loading || bankVerificationState !== "success"}
                >
                  {loading && bankVerificationState === "success"
                    ? "Sending..."
                    : "Send OTP"}
                </ReferenceAuthButton>
              ) : null}
              {bankVerificationState === "failed" ? (
                <ReferenceAuthButton
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    stopBankVerificationPolling();
                    clearStoredBankVerification();
                    setBankVerificationState("idle");
                    setBankVerificationMessage(null);
                  }}
                >
                  Edit Bank Details
                </ReferenceAuthButton>
              ) : null}
            </div>

            <div className="rf-auth-link-row">
              <ReferenceAuthButton
                variant="link"
                type="button"
                onClick={() => setStep(2)}
              >
                Back
              </ReferenceAuthButton>
            </div>
          </form>
        ) : null}

        {step === 4 ? (
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
              <ReferenceAuthOtpInput
                value={otp}
                onChange={setOtp}
                disabled={loading}
              />
            </ReferenceAuthField>

            <ReferenceAuthButton type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify OTP"}
            </ReferenceAuthButton>

            <div className="rf-auth-link-row">
              <ReferenceAuthButton
                variant="link"
                type="button"
                onClick={() => setStep(3)}
              >
                Back
              </ReferenceAuthButton>
            </div>
          </form>
        ) : null}
      </ReferenceAuthLayout>

      <Modal
        isOpen={showTermsModal}
        onClose={() => setShowTermsModal(false)}
        title="Terms and Conditions"
      >
        <div className="rf-auth-modal-copy">
          <p>
            1. By registering as an owner, you agree to provide accurate
            information about your properties.
          </p>
          <p>
            2. You are responsible for maintaining the quality and safety of
            your premises.
          </p>
          <p>
            3. RoomFindR charges a commission on every successful booking.
          </p>
          <p>
            4. Payments are processed periodically to your registered bank
            account.
          </p>
          <div className="flex justify-end pt-4">
            <button
              onClick={() => {
                setFormData((previous) => ({
                  ...previous,
                  agreedToTerms: true,
                }));
                setShowTermsModal(false);
              }}
              className="rf-auth-modal-button"
            >
              I Agree
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showAlreadyVerifiedModal}
        onClose={handleCloseAlreadyVerifiedModal}
        title="Bank Details Already Verified"
      >
        <div className="rf-auth-modal-copy">
          <p>
            These bank details are already verified for this signup.
          </p>
          <p>
            You can continue to the next step and send OTP.
          </p>
          <div className="flex justify-end pt-2">
            <button
              onClick={handleCloseAlreadyVerifiedModal}
              className="rf-auth-modal-button"
            >
              OK
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default Signup;
