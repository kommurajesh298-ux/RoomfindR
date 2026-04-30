import {
  createCashfreeBeneficiary,
  createCashfreeTransfer,
  fetchCashfreeBeneficiary,
  fetchCashfreeTransfer,
} from "./cashfree.ts";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
  sha256Hex,
} from "./crypto.ts";

export const lower = (value: unknown) => String(value || "").trim().toLowerCase();
export const upper = (value: unknown) => String(value || "").trim().toUpperCase();
export const normalize = (value: unknown) => String(value || "").trim();
export const normalizeIfsc = (value: unknown) => normalize(value).toUpperCase();
export const normalizeAccountNumber = (value: unknown) =>
  String(value || "").replace(/\D/g, "").trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const accountNameRegex = /^[A-Za-z ]{3,}$/;
export const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const accountRegex = /^\d{9,18}$/;
const OWNER_BANK_VERIFICATION_ATTEMPT_LIMIT = 3;

export type OwnerBankDetailsInput = {
  accountHolderName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifsc: string;
};

export const buildOwnerBeneficiaryId = (ownerId: string) => {
  const base = String(ownerId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18).toUpperCase();
  const suffix = Date.now().toString(36).slice(-6).toUpperCase();
  return `OWNER_${base}_${suffix}`;
};

export const buildVerificationTransferId = (ownerId: string) => {
  const base = String(ownerId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18).toUpperCase();
  const suffix = Date.now().toString(36).slice(-8).toUpperCase();
  return `VRF_${base}_${suffix}`;
};

const PRE_SIGNUP_BANK_VERIFICATION_ATTEMPT_LIMIT = 3;
const PRE_SIGNUP_PENDING_RETRY_GRACE_MS = 60_000;
const CASHFREE_TEST_BANK_DETAILS = [
  { accountNumber: "026291800001191", ifsc: "YESB0000262" },
  { accountNumber: "1233943142", ifsc: "ICIC0000009" },
  { accountNumber: "388108022658", ifsc: "ICIC0000009" },
  { accountNumber: "000890289871772", ifsc: "SCBL0036078" },
  { accountNumber: "000100289877623", ifsc: "SBIN0008752" },
];

export const getPreSignupVerificationAttemptLimit = () =>
  PRE_SIGNUP_BANK_VERIFICATION_ATTEMPT_LIMIT;

export const getPreSignupPendingRetryGraceMs = () =>
  PRE_SIGNUP_PENDING_RETRY_GRACE_MS;

const isCashfreePayoutTestEnv = () =>
  upper(
    Deno.env.get("CASHFREE_PAYOUT_ENV") ||
      Deno.env.get("CASHFREE_ENV") ||
      "TEST",
  ) === "TEST";

export const getCashfreeSandboxBankValidationMessage = (
  accountNumber: string,
  ifsc: string,
) => {
  if (!isCashfreePayoutTestEnv()) {
    return null;
  }

  const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
  const normalizedIfsc = normalizeIfsc(ifsc);
  const isSupported = CASHFREE_TEST_BANK_DETAILS.some(
    (candidate) =>
      candidate.accountNumber === normalizedAccountNumber &&
      candidate.ifsc === normalizedIfsc,
  );

  if (isSupported) {
    return null;
  }

  return "Cashfree TEST mode only supports official sandbox bank details. Use 000100289877623 / SBIN0008752 or 1233943142 / ICIC0000009, or switch payouts to PROD for real bank accounts.";
};

export const buildPreSignupBeneficiaryId = (email: string) => {
  const base = String(email || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase();
  const suffix = Date.now().toString(36).slice(-6).toUpperCase();
  return `SIGNUP_${base}_${suffix}`;
};

export const buildPreSignupTransferId = (email: string) => {
  const base = String(email || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase();
  const suffix = Date.now().toString(36).slice(-8).toUpperCase();
  return `SGN_${base}_${suffix}`;
};

export const getEncryptionSecret = () => {
  const secret =
    normalize(Deno.env.get("BANK_ACCOUNT_ENCRYPTION_SECRET")) ||
    normalize(Deno.env.get("SUPABASE_JWT_SECRET"));

  if (!secret) {
    throw new Error("Missing account encryption secret");
  }

  return secret;
};

export const isDuplicateBeneficiaryError = (message: string): boolean => {
  const normalized = lower(message);
  if (!normalized) return false;
  if (/(does not exist|not exist|not found|invalid beneficiary)/.test(normalized)) {
    return false;
  }
  return /(already exists|already registered|duplicate|beneficiary.*exists|already added)/.test(normalized);
};

export const fetchBankByIfsc = async (ifsc: string) => {
  const response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`);
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
};

export const getMaskedBankAccountNumber = (accountNumber: string) => {
  const last4 = normalizeAccountNumber(accountNumber).slice(-4);
  return last4 ? `XXXX${last4}` : "XXXX";
};

export const encryptOwnerBankAccount = async (
  accountNumber: string,
  ifsc: string,
) => {
  const normalized = normalizeAccountNumber(accountNumber);
  const encryptionSecret = getEncryptionSecret();

  return {
    encryptedAccountNumber: await encryptSensitiveValue(normalized, encryptionSecret),
    accountNumberHash: await sha256Hex(`${normalized}:${normalizeIfsc(ifsc)}`),
    maskedAccountNumber: getMaskedBankAccountNumber(normalized),
  };
};

export const decryptOwnerBankAccount = async (rawValue: string) => {
  const normalized = normalize(rawValue);
  if (!normalized) {
    throw new Error("Owner bank account number is missing");
  }

  if (/^\d{9,18}$/.test(normalized)) {
    return normalized;
  }

  if (normalized.includes(".")) {
    const decrypted = await decryptSensitiveValue(normalized, getEncryptionSecret());
    const digits = normalizeAccountNumber(decrypted);
    if (/^\d{9,18}$/.test(digits)) {
      return digits;
    }
  }

  const digits = normalizeAccountNumber(normalized);
  if (/^\d{9,18}$/.test(digits)) {
    return digits;
  }

  throw new Error("Stored owner bank account number is invalid");
};

export const resolveVerificationTransferStatus = (
  rawStatus: unknown,
  payload?: Record<string, unknown> | null,
): "pending" | "success" | "failed" => {
  const payloadSnapshot = (() => {
    if (!payload) return payload;
    const data = payload.data;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
      return data[0] as Record<string, unknown>;
    }
    if (data && typeof data === "object") {
      return data as Record<string, unknown>;
    }
    if (Array.isArray(payload.transfers) && payload.transfers.length > 0) {
      return payload.transfers[0] as Record<string, unknown>;
    }
    if (payload.transfer && typeof payload.transfer === "object") {
      return payload.transfer as Record<string, unknown>;
    }
    return payload;
  })();

  const resolvedStatus =
    rawStatus ??
    payloadSnapshot?.status ??
    payloadSnapshot?.transfer_status ??
    payloadSnapshot?.transferStatus ??
    payloadSnapshot?.cf_transfer_status;

  const normalized = upper(resolvedStatus);
  const acknowledgedCandidates = [
    payload?.acknowledged,
    payload?.transfer_acknowledged,
    payloadSnapshot?.acknowledged,
    payloadSnapshot?.transfer_acknowledged,
  ];
  const acknowledgedValue = acknowledgedCandidates.find((value) =>
    value !== undefined && value !== null && String(value).trim() !== ""
  );
  const isAcknowledged =
    acknowledgedValue === undefined
      ? undefined
      : ["1", "true", "yes", "y"].includes(lower(acknowledgedValue));

  if (
    [
      "SUCCESS",
      "COMPLETED",
      "TRANSFER_SUCCESS",
      "TRANSFER_COMPLETED",
      "PROCESSED",
      "PAID",
    ].includes(normalized)
  ) {
    if (isAcknowledged === false) {
      return "pending";
    }
    return "success";
  }

  if (
    [
      "FAILED",
      "CANCELLED",
      "REJECTED",
      "TERMINATED",
      "TRANSFER_FAILED",
      "INVALID",
    ].includes(normalized) ||
    normalized.includes("FAIL") ||
    normalized.includes("REJECT")
  ) {
    return "failed";
  }

  return "pending";
};

const resolveCashfreeBeneficiarySnapshot = (
  payload?: Record<string, unknown> | null,
) => {
  if (!payload) return null;

  const data = payload.data;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
    return data[0] as Record<string, unknown>;
  }
  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }
  if (
    Array.isArray(payload.beneficiaries) &&
    payload.beneficiaries.length > 0 &&
    typeof payload.beneficiaries[0] === "object"
  ) {
    return payload.beneficiaries[0] as Record<string, unknown>;
  }
  if (payload.beneficiary && typeof payload.beneficiary === "object") {
    return payload.beneficiary as Record<string, unknown>;
  }
  return payload;
};

const extractCashfreeBeneficiaryAccountNumber = (
  payload?: Record<string, unknown> | null,
) => {
  const snapshot = resolveCashfreeBeneficiarySnapshot(payload);
  const instrumentDetails =
    snapshot?.beneficiary_instrument_details &&
    typeof snapshot.beneficiary_instrument_details === "object"
      ? (snapshot.beneficiary_instrument_details as Record<string, unknown>)
      : {};

  return normalizeAccountNumber(
    instrumentDetails.bank_account_number ||
      instrumentDetails.bank_account ||
      snapshot?.bank_account_number ||
      snapshot?.bank_account ||
      snapshot?.account_number ||
      snapshot?.accountNumber,
  );
};

const extractCashfreeBeneficiaryIfsc = (
  payload?: Record<string, unknown> | null,
) => {
  const snapshot = resolveCashfreeBeneficiarySnapshot(payload);
  const instrumentDetails =
    snapshot?.beneficiary_instrument_details &&
    typeof snapshot.beneficiary_instrument_details === "object"
      ? (snapshot.beneficiary_instrument_details as Record<string, unknown>)
      : {};

  return normalizeIfsc(
    instrumentDetails.bank_ifsc ||
      instrumentDetails.ifsc ||
      snapshot?.bank_ifsc ||
      snapshot?.ifsc ||
      snapshot?.ifsc_code ||
      snapshot?.ifscCode,
  );
};

const cashfreeBeneficiaryMatchesExpectedBank = (
  payload: Record<string, unknown> | null | undefined,
  accountNumber: string,
  ifsc: string,
) => {
  const beneficiaryAccountNumber = extractCashfreeBeneficiaryAccountNumber(payload);
  const beneficiaryIfsc = extractCashfreeBeneficiaryIfsc(payload);
  if (!beneficiaryAccountNumber || !beneficiaryIfsc) {
    return false;
  }

  return (
    beneficiaryAccountNumber === normalizeAccountNumber(accountNumber) &&
    beneficiaryIfsc === normalizeIfsc(ifsc)
  );
};

export const resolveVerificationMessage = (
  transferStatus: "pending" | "success" | "failed",
  fallback?: string | null,
) => {
  const normalizedFallback = lower(fallback);
  if (normalizedFallback.includes("duplicate")) {
    return "This bank account is already linked to another owner.";
  }
  if (normalizedFallback.includes("maximum 3")) {
    return "Maximum 3 bank verification attempts are allowed for this owner.";
  }
  if (
    normalizedFallback.includes("timeout") ||
    normalizedFallback.includes("temporar") ||
    normalizedFallback.includes("network") ||
    normalizedFallback.includes("gateway")
  ) {
    return "Verification temporarily unavailable. Please try again later.";
  }
  if (normalizedFallback.includes("admin requested")) {
    return normalize(fallback);
  }
  if (transferStatus === "success") return "Bank account verified successfully.";
  if (transferStatus === "failed") {
    return "Bank verification failed. Please check your bank details.";
  }
  return "Rs 1 verification transfer is in progress.";
};

export const extractVerificationProviderReference = (
  payload: Record<string, unknown> | null | undefined,
) =>
  normalize(
    payload?.cf_transfer_id ||
      payload?.reference_id ||
      payload?.provider_reference ||
      (payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>).cf_transfer_id ||
          (payload.data as Record<string, unknown>).reference_id
        : undefined) ||
      (Array.isArray(payload?.data) && payload?.data?.length
        ? (payload.data[0] as Record<string, unknown>).cf_transfer_id ||
          (payload.data[0] as Record<string, unknown>).reference_id
        : undefined) ||
      (payload?.transfer && typeof payload.transfer === "object"
        ? (payload.transfer as Record<string, unknown>).cf_transfer_id ||
          (payload.transfer as Record<string, unknown>).reference_id
        : undefined) ||
      (Array.isArray(payload?.transfers) && payload?.transfers?.length
        ? (payload.transfers[0] as Record<string, unknown>).cf_transfer_id ||
          (payload.transfers[0] as Record<string, unknown>).reference_id
        : undefined),
  ) || null;

export const fetchOwnerProfile = async (supabase: any, ownerId: string) => {
  const { data, error } = await supabase
    .from("owners")
    .select(
      "id, owner_id, name, full_name, email, phone, mobile_number, verified, verification_status, bank_details, account_holder_name, cashfree_beneficiary_id, cashfree_transfer_id, cashfree_status, verification_reference_id, bank_verification_status, bank_verified, bank_verified_at, bank_account_number, bank_ifsc",
    )
    .eq("id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Owner profile not found");
  return data;
};

export const fetchLatestPreSignupBankVerification = async (
  supabase: any,
  email: string,
) => {
  const { data, error } = await supabase
    .from("owner_signup_bank_verifications")
    .select("*")
    .eq("email", lower(email))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const fetchPreSignupBankVerificationByTransferReference = async (
  supabase: any,
  transferReferenceId: string,
) => {
  const { data, error } = await supabase
    .from("owner_signup_bank_verifications")
    .select("*")
    .eq("transfer_reference_id", transferReferenceId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const syncPreSignupBankVerificationPhone = async (
  supabase: any,
  verification: Record<string, unknown> | null | undefined,
  phone: string | null | undefined,
) => {
  const verificationId = normalize(verification?.id);
  const normalizedPhone = normalize(phone);
  if (!verification || !verificationId || !normalizedPhone) {
    return verification || null;
  }

  if (normalize(verification.phone) === normalizedPhone) {
    return verification;
  }

  const { data, error } = await supabase
    .from("owner_signup_bank_verifications")
    .update({
      phone: normalizedPhone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", verificationId)
    .select("*")
    .single();

  if (error) throw error;
  return data || verification;
};

export const fetchOwnerBankAccount = async (supabase: any, ownerId: string) => {
  const { data, error } = await supabase
    .from("owner_bank_accounts")
    .select(
      "id, owner_id, account_holder_name, account_number, account_number_last4, account_number_hash, ifsc, bank_name, branch_name, cashfree_beneficiary_id, verified, bank_verification_status, license_number, license_document_path, created_at, updated_at",
    )
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Owner bank details not found");
  return data;
};

const waitForOwnerBankAccountRecord = async (
  supabase: any,
  ownerId: string,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
  },
) => {
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const intervalMs = options?.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      return await fetchOwnerBankAccount(supabase, ownerId);
    } catch (error) {
      lastError = error instanceof Error
        ? error
        : new Error("Owner bank details not found");
      await sleep(intervalMs);
    }
  }

  throw lastError || new Error("Owner bank details not found");
};

export const fetchCurrentOwnerBankVerification = async (supabase: any, ownerId: string) => {
  const { data, error } = await supabase
    .from("owner_bank_verification")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const fetchOwnerBankVerificationHistory = async (
  supabase: any,
  ownerId: string,
  limit = 10,
) => {
  const { data, error } = await supabase
    .from("owner_bank_verification_history")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
};

export const fetchOwnerBankVerificationByTransferReference = async (
  supabase: any,
  transferReferenceId: string,
) => {
  const { data, error } = await supabase
    .from("owner_bank_verification")
    .select("*")
    .eq("transfer_reference_id", transferReferenceId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const insertOwnerNotification = async (
  supabase: any,
  input: {
    userId: string;
    title: string;
    message: string;
    notificationType: string;
    data?: Record<string, unknown>;
  },
) => {
  const { error } = await supabase.from("notifications").insert({
    user_id: input.userId,
    title: input.title,
    message: input.message,
    type: "system",
    notification_type: input.notificationType,
    status: "queued",
    data: input.data || {},
  });

  if (error) throw error;
};

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const resolveOwnerBankSummaryState = (
  owner: Record<string, unknown> | null | undefined,
  transferStatus: "pending" | "success" | "failed",
) => {
  const ownerVerificationStatus = lower(owner?.verification_status);
  const isApproved = ownerVerificationStatus === "approved";
  const isVerified = transferStatus === "success";

  return {
    isVerified,
    ownerVerificationStatus:
      ownerVerificationStatus === "rejected" ? "rejected" : isApproved ? "approved" : "pending",
    ownerVerified: isApproved,
    bankVerificationStatus: isVerified
      ? "verified"
      : transferStatus === "failed"
        ? "failed"
        : "pending",
  };
};

export const syncOwnerSummaryFields = async (
  supabase: any,
  input: {
    ownerId: string;
    transferStatus: "pending" | "success" | "failed";
    transferReferenceId?: string | null;
    cashfreeBeneficiaryId?: string | null;
    accountHolderName?: string | null;
    maskedAccountNumber?: string | null;
    ifscCode?: string | null;
    bankName?: string | null;
    branchName?: string | null;
    city?: string | null;
    verifiedAt?: string | null;
  },
) => {
  const owner = await fetchOwnerProfile(supabase, input.ownerId);
  const ownerRecord = owner as Record<string, unknown>;
  const state = resolveOwnerBankSummaryState(ownerRecord, input.transferStatus);
  const now = new Date().toISOString();
  const bankDetails =
    ownerRecord.bank_details && typeof ownerRecord.bank_details === "object"
      ? { ...(ownerRecord.bank_details as Record<string, unknown>) }
      : {};

  const accountHolderName = normalize(
    input.accountHolderName ??
      bankDetails.accountHolderName ??
      ownerRecord.account_holder_name,
  ) || null;
  const maskedAccountNumber = normalize(
    input.maskedAccountNumber ??
      bankDetails.accountNumber ??
      ownerRecord.bank_account_number,
  ) || null;
  const ifscCode = normalize(
    input.ifscCode ??
      bankDetails.ifscCode ??
      ownerRecord.bank_ifsc,
  ) || null;
  const bankName = normalize(input.bankName ?? bankDetails.bankName) || null;
  const branchName = normalize(input.branchName ?? bankDetails.branchName) || null;
  const city = normalize(input.city ?? bankDetails.city) || null;
  const verifiedAt = state.isVerified
    ? normalize(input.verifiedAt) || now
    : null;

  const mergedBankDetails = {
    ...bankDetails,
    accountHolderName,
    accountNumber: maskedAccountNumber,
    ifscCode,
    bankName,
    branchName,
    city,
  };

  const update: Record<string, unknown> = {
    owner_id: input.ownerId,
    full_name: normalize(ownerRecord.name || ownerRecord.full_name) || null,
    mobile_number: normalize(ownerRecord.phone || ownerRecord.mobile_number) || null,
    account_holder_name: accountHolderName,
    bank_details: mergedBankDetails,
    bank_verified: state.isVerified,
    bank_verified_at: verifiedAt,
    bank_verification_status: state.bankVerificationStatus,
    verified: state.ownerVerified,
    verification_status: state.ownerVerificationStatus,
    bank_account_number: maskedAccountNumber,
    bank_ifsc: ifscCode,
    cashfree_status: input.transferStatus,
    updated_at: now,
  };

  if (hasOwn(input as Record<string, unknown>, "transferReferenceId")) {
    update.verification_reference_id = input.transferReferenceId ?? null;
    update.cashfree_transfer_id = input.transferReferenceId ?? null;
  }

  if (hasOwn(input as Record<string, unknown>, "cashfreeBeneficiaryId")) {
    update.cashfree_beneficiary_id = input.cashfreeBeneficiaryId ?? null;
  }

  const { error } = await supabase
    .from("owners")
    .update(update)
    .eq("id", input.ownerId);

  if (error) throw error;
};

export const notifyOwnerBankVerificationTerminalState = async (
  supabase: any,
  input: {
    ownerId: string;
    verificationId: string;
    transferReferenceId: string;
    transferStatus: "success" | "failed";
  },
) => {
  if (input.transferStatus === "success") {
    await insertOwnerNotification(supabase, {
      userId: input.ownerId,
      title: "Bank Account Verified",
      message: "Your bank account is verified. Please wait for admin approval to activate your owner account.",
      notificationType: "owner_bank_verification_success",
      data: {
        owner_id: input.ownerId,
        transfer_reference_id: input.transferReferenceId,
        verification_id: input.verificationId,
      },
    });
    return;
  }

  await insertOwnerNotification(supabase, {
    userId: input.ownerId,
    title: "Bank Verification Failed",
    message: "Bank verification failed. Please update your bank details and try again.",
    notificationType: "owner_bank_verification_failed",
    data: {
      owner_id: input.ownerId,
      transfer_reference_id: input.transferReferenceId,
      verification_id: input.verificationId,
    },
  });
};

export const syncOwnerBankAccountFlags = async (
  supabase: any,
  ownerId: string,
  transferStatus: "pending" | "success" | "failed",
  transferReferenceId?: string | null,
) => {
  const isVerified = transferStatus === "success";
  const bankVerificationStatusForAccount = isVerified
    ? "verified"
    : transferStatus === "failed"
      ? "rejected"
      : "pending";
  const bankAccount = await fetchOwnerBankAccount(supabase, ownerId).catch(() => null);

  const { error: bankAccountError } = await supabase
    .from("owner_bank_accounts")
    .update({
      verified: isVerified,
      bank_verification_status: bankVerificationStatusForAccount,
      verification_method: "penny_drop",
    })
    .eq("owner_id", ownerId);

  if (bankAccountError) throw bankAccountError;

  await syncOwnerSummaryFields(supabase, {
    ownerId,
    transferStatus,
    transferReferenceId: transferReferenceId ?? null,
    cashfreeBeneficiaryId: normalize(bankAccount?.cashfree_beneficiary_id) || null,
    accountHolderName: normalize(bankAccount?.account_holder_name) || null,
    maskedAccountNumber: bankAccount?.account_number_last4
      ? `XXXX${bankAccount.account_number_last4}`
      : null,
    ifscCode: normalize(bankAccount?.ifsc) || null,
    bankName: normalize(bankAccount?.bank_name) || null,
    branchName: normalize(bankAccount?.branch_name) || null,
    city: normalize(bankAccount?.city) || null,
    verifiedAt: isVerified ? new Date().toISOString() : null,
  });
};

export const recordOwnerBankVerificationAttempt = async (
  supabase: any,
  input: {
    ownerId: string;
    bankAccountNumber: string;
    ifscCode: string;
    accountHolderName: string;
    transferAmount?: number;
    transferReferenceId: string;
    providerReferenceId?: string | null;
    transferStatus?: "pending" | "success" | "failed";
    statusMessage?: string | null;
  },
) => {
  const transferStatus = input.transferStatus || "pending";
  const statusMessage = resolveVerificationMessage(
    transferStatus,
    input.statusMessage || null,
  );

  const { data: current, error: currentError } = await supabase
    .from("owner_bank_verification")
    .upsert(
      {
        owner_id: input.ownerId,
        bank_account_number: input.bankAccountNumber,
        ifsc_code: input.ifscCode,
        account_holder_name: input.accountHolderName,
        transfer_amount: input.transferAmount || 1,
        transfer_reference_id: input.transferReferenceId,
        provider_reference_id: input.providerReferenceId || null,
        transfer_status: transferStatus,
        status_message: statusMessage,
        last_attempt_at: new Date().toISOString(),
        verified_at: transferStatus === "success" ? new Date().toISOString() : null,
      },
      { onConflict: "owner_id" },
    )
    .select("*")
    .single();

  if (currentError) throw currentError;

  const { data: history, error: historyError } = await supabase
    .from("owner_bank_verification_history")
    .insert({
      owner_id: input.ownerId,
      verification_id: current.id,
      bank_account_number: input.bankAccountNumber,
      ifsc_code: input.ifscCode,
      account_holder_name: input.accountHolderName,
      transfer_amount: input.transferAmount || 1,
      transfer_reference: input.transferReferenceId,
      provider_reference_id: input.providerReferenceId || null,
      transfer_status: transferStatus,
      error_message: transferStatus === "failed" ? statusMessage : null,
    })
    .select("*")
    .single();

  if (historyError) throw historyError;

  await syncOwnerBankAccountFlags(
    supabase,
    input.ownerId,
    transferStatus,
    input.transferReferenceId,
  );

  return { current, history };
};

export const applyOwnerBankVerificationTransferStatus = async (
  supabase: any,
  input: {
    ownerId: string;
    transferReferenceId: string;
    providerReferenceId?: string | null;
    transferStatus: "pending" | "success" | "failed";
    statusMessage?: string | null;
  },
) => {
  const current = await fetchCurrentOwnerBankVerification(supabase, input.ownerId);
  const bankAccount = await fetchOwnerBankAccount(supabase, input.ownerId);
  const maskedAccount = bankAccount.account_number_last4
    ? `XXXX${bankAccount.account_number_last4}`
    : getMaskedBankAccountNumber(await decryptOwnerBankAccount(bankAccount.account_number));

  const statusMessage = resolveVerificationMessage(
    input.transferStatus,
    input.statusMessage || null,
  );

  const { data: updatedCurrent, error: currentError } = await supabase
    .from("owner_bank_verification")
    .upsert(
      {
        id: current?.id,
        owner_id: input.ownerId,
        bank_account_number: maskedAccount,
        ifsc_code: bankAccount.ifsc,
        account_holder_name: bankAccount.account_holder_name,
        transfer_amount: current?.transfer_amount || 1,
        transfer_reference_id: input.transferReferenceId,
        provider_reference_id: input.providerReferenceId || null,
        transfer_status: input.transferStatus,
        status_message: statusMessage,
        last_attempt_at: current?.last_attempt_at || new Date().toISOString(),
        verified_at:
          input.transferStatus === "success"
            ? new Date().toISOString()
            : null,
      },
      { onConflict: "owner_id" },
    )
    .select("*")
    .single();

  if (currentError) throw currentError;

  const { data: existingHistory } = await supabase
    .from("owner_bank_verification_history")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("transfer_reference", input.transferReferenceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingHistory?.id) {
    const { error: historyUpdateError } = await supabase
      .from("owner_bank_verification_history")
      .update({
        verification_id: updatedCurrent.id,
        provider_reference_id: input.providerReferenceId || null,
        transfer_status: input.transferStatus,
        error_message: input.transferStatus === "failed" ? statusMessage : null,
      })
      .eq("id", existingHistory.id);

    if (historyUpdateError) throw historyUpdateError;
  } else {
    const { error: historyInsertError } = await supabase
      .from("owner_bank_verification_history")
      .insert({
        owner_id: input.ownerId,
        verification_id: updatedCurrent.id,
        bank_account_number: maskedAccount,
        ifsc_code: bankAccount.ifsc,
        account_holder_name: bankAccount.account_holder_name,
        transfer_amount: updatedCurrent.transfer_amount || 1,
        transfer_reference: input.transferReferenceId,
        provider_reference_id: input.providerReferenceId || null,
        transfer_status: input.transferStatus,
        error_message: input.transferStatus === "failed" ? statusMessage : null,
      });

    if (historyInsertError) throw historyInsertError;
  }

  await syncOwnerBankAccountFlags(
    supabase,
    input.ownerId,
    input.transferStatus,
    input.transferReferenceId,
  );

  return updatedCurrent;
};

const fetchOwnerBankVerificationAttemptCount = async (
  supabase: any,
  ownerId: string,
) => {
  const { count, error } = await supabase
    .from("owner_bank_verification_history")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);

  if (error) throw error;
  return Number(count || 0);
};

const fetchDuplicateOwnerBankAccount = async (
  supabase: any,
  accountNumberHash: string,
  ownerId: string,
) => {
  const { data, error } = await supabase
    .from("owner_bank_accounts")
    .select("owner_id")
    .eq("account_number_hash", accountNumberHash)
    .neq("owner_id", ownerId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const recordOwnerBankVerificationAudit = async (
  supabase: any,
  input: {
    ownerId: string;
    maskedAccountNumber: string;
    ifscCode: string;
    status: "pending" | "verified" | "failed" | "rate_limited";
    userMessage: string;
    providerStatus?: string | null;
    providerReferenceId?: string | null;
    metadata?: Record<string, unknown>;
  },
) => {
  const requestKey = await sha256Hex(`penny-drop:${input.ownerId}`);

  await supabase.from("owner_bank_verification_attempts").insert({
    owner_id: input.ownerId,
    account_number_masked: input.maskedAccountNumber,
    ifsc_code: input.ifscCode,
    request_key: requestKey,
    status: input.status,
    user_message: input.userMessage,
    provider_status: input.providerStatus || null,
    provider_reference_id: input.providerReferenceId || null,
    metadata: {
      kind: "penny_drop",
      ...(input.metadata || {}),
    },
  });
};

const logOwnerBankVerificationEvent = (
  event: string,
  payload: Record<string, unknown>,
) => {
  void event;
  void payload;
};

export const resolveIfscDetails = async (ifsc: string) => {
  const bankInfo = await fetchBankByIfsc(ifsc);
  if (!bankInfo) {
    return {
      bankName: "",
      branchName: "",
      city: "",
    };
  }

  return {
    bankName: normalize(bankInfo.bank_name || bankInfo.BANK || bankInfo.bank),
    branchName: normalize(
      bankInfo.branch_name || bankInfo.BRANCH || bankInfo.branch,
    ),
    city: normalize(bankInfo.city || bankInfo.CITY),
  };
};

export const upsertOwnerBankDetailsForVerification = async (
  supabase: any,
  ownerId: string,
  input: OwnerBankDetailsInput,
) => {
  const accountHolderName = normalize(input.accountHolderName);
  const accountNumber = normalizeAccountNumber(input.accountNumber);
  const confirmAccountNumber = normalizeAccountNumber(
    input.confirmAccountNumber,
  );
  const ifsc = normalizeIfsc(input.ifsc);

  if (!accountNameRegex.test(accountHolderName)) {
    throw new Error("Invalid account holder name");
  }
  if (!accountRegex.test(accountNumber)) {
    throw new Error("Invalid account number");
  }
  if (accountNumber !== confirmAccountNumber) {
    throw new Error("Account numbers do not match");
  }
  if (!ifscRegex.test(ifsc)) {
    throw new Error("Invalid IFSC format");
  }

  const sandboxValidationMessage = getCashfreeSandboxBankValidationMessage(
    accountNumber,
    ifsc,
  );
  if (sandboxValidationMessage) {
    throw new Error(sandboxValidationMessage);
  }

  const [owner, existingBankAccount, ifscDetails] = await Promise.all([
    fetchOwnerProfile(supabase, ownerId),
    fetchOwnerBankAccount(supabase, ownerId).catch(() => null),
    resolveIfscDetails(ifsc),
  ]);

  const encrypted = await encryptOwnerBankAccount(accountNumber, ifsc);
  const duplicateOwner = await fetchDuplicateOwnerBankAccount(
    supabase,
    encrypted.accountNumberHash,
    ownerId,
  );
  if (duplicateOwner?.owner_id) {
    await recordOwnerBankVerificationAudit(supabase, {
      ownerId,
      maskedAccountNumber: encrypted.maskedAccountNumber,
      ifscCode: ifsc,
      status: "failed",
      userMessage: "This bank account is already linked to another owner.",
      metadata: {
        duplicate_owner_id: duplicateOwner.owner_id,
      },
    });
    logOwnerBankVerificationEvent("BANK_VERIFICATION_FAILED", {
      owner_id: ownerId,
      reason: "DUPLICATE_ACCOUNT",
      duplicate_owner_id: duplicateOwner.owner_id,
    });
    throw new Error("This bank account is already linked to another owner.");
  }

  const currentVerification = await fetchCurrentOwnerBankVerification(
    supabase,
    ownerId,
  );
  const isSameBankAccount =
    normalize(existingBankAccount?.account_number_hash) ===
      encrypted.accountNumberHash &&
    normalizeIfsc(existingBankAccount?.ifsc || "") === ifsc;

  const alreadyVerified =
    currentVerification?.transfer_status === "success" ||
    owner.bank_verified === true ||
    lower(owner.bank_verification_status) === "verified";

  if (alreadyVerified && !isSameBankAccount) {
    await recordOwnerBankVerificationAudit(supabase, {
      ownerId,
      maskedAccountNumber: encrypted.maskedAccountNumber,
      ifscCode: ifsc,
      status: "failed",
      userMessage: "Bank account already verified. Please contact support to update it.",
      metadata: {
        reason: "BANK_ALREADY_VERIFIED",
      },
    });
    logOwnerBankVerificationEvent("BANK_VERIFICATION_BLOCKED", {
      owner_id: ownerId,
      reason: "BANK_ALREADY_VERIFIED",
    });
    throw new Error(
      "Bank account already verified. Please contact support to update it.",
    );
  }

  if (alreadyVerified && isSameBankAccount) {
    return {
      maskedAccountNumber: encrypted.maskedAccountNumber,
      ifscCode: ifsc,
      bankName: ifscDetails.bankName,
      branchName: ifscDetails.branchName,
      city: ifscDetails.city,
      forceNewBeneficiary: false,
    };
  }

  if (currentVerification?.transfer_status !== "success" && !isSameBankAccount) {
    const attemptCount = await fetchOwnerBankVerificationAttemptCount(
      supabase,
      ownerId,
    );
    if (attemptCount >= OWNER_BANK_VERIFICATION_ATTEMPT_LIMIT) {
      await recordOwnerBankVerificationAudit(supabase, {
        ownerId,
        maskedAccountNumber: encrypted.maskedAccountNumber,
        ifscCode: ifsc,
        status: "rate_limited",
        userMessage: "Maximum 3 bank verification attempts are allowed for this owner.",
      });
      logOwnerBankVerificationEvent("BANK_VERIFICATION_FAILED", {
        owner_id: ownerId,
        reason: "RATE_LIMITED",
        attempts: attemptCount,
      });
      throw new Error("Maximum 3 bank verification attempts are allowed for this owner.");
    }
  }

  const beneficiaryId = normalize(
    existingBankAccount?.cashfree_beneficiary_id || owner.cashfree_beneficiary_id,
  ) || null;
  const forceNewBeneficiary = !isSameBankAccount || !beneficiaryId;

  const { error: bankAccountError } = await supabase
    .from("owner_bank_accounts")
    .upsert(
      {
        owner_id: ownerId,
        account_holder_name: accountHolderName,
        account_number: encrypted.encryptedAccountNumber,
        account_number_last4: accountNumber.slice(-4),
        account_number_hash: encrypted.accountNumberHash,
        ifsc,
        bank_name: ifscDetails.bankName || null,
        branch_name: ifscDetails.branchName || null,
        city: ifscDetails.city || null,
        cashfree_beneficiary_id: forceNewBeneficiary ? null : beneficiaryId,
        verified: false,
        bank_verification_status: "pending",
        verification_method: "penny_drop",
      },
      { onConflict: "owner_id" },
    );

  if (bankAccountError) throw bankAccountError;

  await syncOwnerSummaryFields(supabase, {
    ownerId,
    transferStatus: "pending",
    transferReferenceId: null,
    cashfreeBeneficiaryId: forceNewBeneficiary ? null : beneficiaryId,
    accountHolderName,
    maskedAccountNumber: encrypted.maskedAccountNumber,
    ifscCode: ifsc,
    bankName: ifscDetails.bankName || null,
    branchName: ifscDetails.branchName || null,
    city: ifscDetails.city || null,
    verifiedAt: null,
  });

  await waitForOwnerBankAccountRecord(supabase, ownerId);

  return {
    maskedAccountNumber: encrypted.maskedAccountNumber,
    ifscCode: ifsc,
    bankName: ifscDetails.bankName,
    branchName: ifscDetails.branchName,
    city: ifscDetails.city,
    forceNewBeneficiary,
  };
};

export const verifyOwnerBankDetailsWithPennyDrop = async (
  supabase: any,
  ownerId: string,
  input: OwnerBankDetailsInput,
) => {
  const prepared = await upsertOwnerBankDetailsForVerification(
    supabase,
    ownerId,
    input,
  );

  logOwnerBankVerificationEvent("BANK_VERIFICATION_REQUEST", {
    owner_id: ownerId,
    account_number_masked: prepared.maskedAccountNumber,
    ifsc_code: prepared.ifscCode,
  });

  const result = await runOwnerBankVerificationFlow(supabase, ownerId, {
    forceNewBeneficiary: prepared.forceNewBeneficiary,
  });
  const transferStatus =
    result.verification?.transfer_status === "success"
      ? "success"
      : result.verification?.transfer_status === "failed"
        ? "failed"
        : "pending";
  const userMessage = resolveVerificationMessage(
    transferStatus,
    result.verification?.status_message || result.error || null,
  );

  await recordOwnerBankVerificationAudit(supabase, {
    ownerId,
    maskedAccountNumber: prepared.maskedAccountNumber,
    ifscCode: prepared.ifscCode,
    status:
      transferStatus === "success"
        ? "verified"
        : transferStatus === "failed"
          ? "failed"
          : "pending",
    userMessage,
    providerStatus: transferStatus,
    providerReferenceId:
      result.verification?.provider_reference_id || result.transferId || null,
    metadata: {
      transfer_reference_id: result.transferId || null,
      bank_name: prepared.bankName || null,
      branch_name: prepared.branchName || null,
      city: prepared.city || null,
    },
  });

  logOwnerBankVerificationEvent(
    transferStatus === "success"
      ? "PENNY_DROP_SUCCESS"
      : transferStatus === "failed"
        ? "PENNY_DROP_FAILED"
        : "BANK_VERIFICATION_PENDING",
    {
      owner_id: ownerId,
      transfer_reference_id: result.transferId || null,
      transfer_status: transferStatus,
    },
  );

  if (result.error) {
    return {
      ...result,
      error: userMessage,
      verification: result.verification
        ? {
            ...result.verification,
            status_message: userMessage,
          }
        : result.verification,
    };
  }

  if (result.verification) {
    result.verification.status_message = userMessage;
  }

  return result;
};

export const waitForConfirmedBeneficiary = async (input: {
  beneficiaryId: string;
  accountNumber: string;
  ifsc: string;
}) => {
  const deadline = Date.now() + 60_000;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    const lookups = [
      () => fetchCashfreeBeneficiary({ beneficiaryId: input.beneficiaryId }),
      () =>
        fetchCashfreeBeneficiary({
          bankAccount: input.accountNumber,
          ifsc: input.ifsc,
        }),
    ];

    for (const lookup of lookups) {
      try {
        const beneficiary = await lookup();
        const beneficiarySnapshot = resolveCashfreeBeneficiarySnapshot(
          beneficiary as Record<string, unknown> | null,
        );
        const status = upper(
          beneficiarySnapshot?.beneficiary_status ||
            beneficiarySnapshot?.status ||
            (beneficiary as Record<string, unknown> | null)?.beneficiary_status ||
            (beneficiary as Record<string, unknown> | null)?.status,
        );

        if (["INVALID", "FAILED", "DELETED", "CANCELLED"].includes(status)) {
          throw new Error(`Beneficiary status is ${status}`);
        }

        if (
          !cashfreeBeneficiaryMatchesExpectedBank(
            beneficiary as Record<string, unknown> | null,
            input.accountNumber,
            input.ifsc,
          )
        ) {
          lastError = new Error(
            "Cashfree beneficiary does not match the requested bank details",
          );
          continue;
        }

        return beneficiary;
      } catch (error) {
        lastError = error instanceof Error
          ? error
          : new Error("Unable to confirm beneficiary");
      }
    }

    await sleep(3_000);
  }

  throw lastError || new Error("Unable to confirm beneficiary in Cashfree");
};

export const ensureOwnerBeneficiary = async (
  supabase: any,
  ownerId: string,
  options?: { forceNewBeneficiary?: boolean },
) => {
  const owner = await fetchOwnerProfile(supabase, ownerId);
  const bankAccount = await fetchOwnerBankAccount(supabase, ownerId);
  const accountNumber = await decryptOwnerBankAccount(bankAccount.account_number);

  const existingBeneficiaryId =
    !options?.forceNewBeneficiary
      ? normalize(bankAccount.cashfree_beneficiary_id || owner.cashfree_beneficiary_id)
      : "";
  const beneficiaryId = existingBeneficiaryId || buildOwnerBeneficiaryId(ownerId);

  try {
    await createCashfreeBeneficiary({
      beneId: beneficiaryId,
      name: normalize(owner.name || bankAccount.account_holder_name || "RoomFindR Owner"),
      email: normalize(owner.email || "owner@roomfindr.app"),
      phone: String(owner.phone || "").replace(/\D/g, "").slice(-10),
      bankAccount: accountNumber,
      ifsc: normalizeIfsc(bankAccount.ifsc),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Beneficiary creation failed";
    if (!isDuplicateBeneficiaryError(message)) {
      throw error;
    }
  }

  const confirmedBeneficiary = await waitForConfirmedBeneficiary({
    beneficiaryId,
    accountNumber,
    ifsc: normalizeIfsc(bankAccount.ifsc),
  });

  const confirmedBeneficiaryId =
    normalize(
      confirmedBeneficiary?.beneficiary_id ||
        confirmedBeneficiary?.beneficiaryId,
    ) || beneficiaryId;

  await supabase
    .from("owner_bank_accounts")
    .update({
      cashfree_beneficiary_id: confirmedBeneficiaryId,
    })
    .eq("owner_id", ownerId);

  await supabase
    .from("owners")
    .update({
      cashfree_beneficiary_id: confirmedBeneficiaryId,
    })
    .eq("id", ownerId);

  return {
    owner,
    bankAccount: {
      ...bankAccount,
      cashfree_beneficiary_id: confirmedBeneficiaryId,
    },
    beneficiaryId: confirmedBeneficiaryId,
    accountNumber,
  };
};

export const createOwnerVerificationTransfer = async (input: {
  transferId: string;
  beneficiaryId: string;
  amount?: number;
}) => {
  const response = await createCashfreeTransfer({
    transferId: input.transferId,
    beneId: input.beneficiaryId,
    amount: input.amount || 1,
    transferMode: "banktransfer",
    remarks: "Owner bank verification",
  });

  const status = resolveVerificationTransferStatus(
    response?.status ||
      response?.transfer_status ||
      response?.transferStatus ||
      response?.cf_transfer_status,
    response,
  );

  return {
    response,
    status,
    providerReferenceId: extractVerificationProviderReference(response),
  };
};

export const applyPreSignupBankVerificationTransferStatus = async (
  supabase: any,
  input: {
    verification?: Record<string, unknown> | null;
    email?: string;
    transferReferenceId?: string;
    providerReferenceId?: string | null;
    transferStatus: "pending" | "success" | "failed";
    statusMessage?: string | null;
    ownerId?: string | null;
  },
) => {
  const currentRecord =
    input.verification ||
    (input.transferReferenceId
      ? await fetchPreSignupBankVerificationByTransferReference(
          supabase,
          input.transferReferenceId,
        )
      : input.email
        ? await fetchLatestPreSignupBankVerification(supabase, input.email)
        : null);

  if (!currentRecord?.id) {
    return currentRecord;
  }

  const currentStatus = resolveVerificationTransferStatus(
    currentRecord.transfer_status,
    currentRecord,
  );
  if (currentStatus === "success" && input.transferStatus !== "success") {
    return currentRecord;
  }

  const statusMessage = resolveVerificationMessage(
    input.transferStatus,
    input.statusMessage || null,
  );
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("owner_signup_bank_verifications")
    .update({
      transfer_status: input.transferStatus,
      status_message: statusMessage,
      provider_reference_id:
        input.providerReferenceId ??
        currentRecord.provider_reference_id ??
        null,
      verified_at:
        input.transferStatus === "success"
          ? currentRecord.verified_at || now
          : null,
      last_attempt_at: now,
      owner_id:
        input.ownerId ??
        currentRecord.owner_id ??
        null,
    })
    .eq("id", currentRecord.id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

const resolvePreSignupPendingVerificationFailureMessage = async (
  verification: Record<string, unknown>,
) => {
  const encryptedAccountNumber = normalize(verification.account_number_encrypted);
  const ifsc = normalizeIfsc(verification.ifsc);
  if (!encryptedAccountNumber || !ifsc) {
    return null;
  }

  let accountNumber = "";
  try {
    accountNumber = await decryptOwnerBankAccount(encryptedAccountNumber);
  } catch {
    return null;
  }

  const sandboxValidationMessage = getCashfreeSandboxBankValidationMessage(
    accountNumber,
    ifsc,
  );
  if (sandboxValidationMessage) {
    return sandboxValidationMessage;
  }

  const beneficiaryId = normalize(verification.cashfree_beneficiary_id);
  if (!beneficiaryId) {
    return null;
  }

  try {
    const beneficiary = await fetchCashfreeBeneficiary({ beneficiaryId });
    if (
      !cashfreeBeneficiaryMatchesExpectedBank(
        beneficiary as Record<string, unknown> | null,
        accountNumber,
        ifsc,
      )
    ) {
      return "Cashfree beneficiary does not match the entered bank details. Please retry bank verification.";
    }
  } catch {
    return null;
  }

  return null;
};

const resolveOwnerPendingVerificationFailureMessage = async (
  supabase: any,
  verification: Record<string, unknown>,
) => {
  const ownerId = normalize(verification.owner_id);
  if (!ownerId) {
    return null;
  }

  let bankAccount: Record<string, unknown> | null = null;
  try {
    bankAccount = await fetchOwnerBankAccount(supabase, ownerId);
  } catch {
    return null;
  }

  const encryptedAccountNumber = normalize(bankAccount?.account_number);
  const ifsc = normalizeIfsc(bankAccount?.ifsc);
  if (!encryptedAccountNumber || !ifsc) {
    return null;
  }

  let accountNumber = "";
  try {
    accountNumber = await decryptOwnerBankAccount(encryptedAccountNumber);
  } catch {
    return null;
  }

  const sandboxValidationMessage = getCashfreeSandboxBankValidationMessage(
    accountNumber,
    ifsc,
  );
  if (sandboxValidationMessage) {
    return sandboxValidationMessage;
  }

  const beneficiaryId = normalize(
    bankAccount?.cashfree_beneficiary_id || verification.cashfree_beneficiary_id,
  );
  if (!beneficiaryId) {
    return null;
  }

  try {
    const beneficiary = await fetchCashfreeBeneficiary({ beneficiaryId });
    if (
      !cashfreeBeneficiaryMatchesExpectedBank(
        beneficiary as Record<string, unknown> | null,
        accountNumber,
        ifsc,
      )
    ) {
      return "Cashfree beneficiary does not match the entered bank details. Please update your bank details and retry verification.";
    }
  } catch {
    return null;
  }

  return null;
};

export const reconcilePreSignupBankVerification = async (
  supabase: any,
  verification: Record<string, unknown> | null,
) => {
  if (!verification) {
    return { changed: false, verification: null, transfer: null };
  }

  const transferReferenceId = normalize(verification.transfer_reference_id);
  const currentStatus = resolveVerificationTransferStatus(
    verification.transfer_status,
    verification,
  );

  if (!transferReferenceId || currentStatus !== "pending") {
    return { changed: false, verification, transfer: null };
  }

  let transferSnapshot: Record<string, unknown> | null = null;
  try {
    transferSnapshot = (await fetchCashfreeTransfer(transferReferenceId)) as Record<string, unknown>;
  } catch {
    return { changed: false, verification, transfer: null };
  }

  const nextStatus = resolveVerificationTransferStatus(
    transferSnapshot?.status ||
      transferSnapshot?.transfer_status ||
      transferSnapshot?.transferStatus ||
      transferSnapshot?.cf_transfer_status,
    transferSnapshot,
  );
  const providerReferenceId = extractVerificationProviderReference(transferSnapshot);
  const failureMessage =
    nextStatus === "pending"
      ? await resolvePreSignupPendingVerificationFailureMessage(verification)
      : null;
  const effectiveStatus = failureMessage ? "failed" : nextStatus;
  const statusMessage = failureMessage ||
    resolveVerificationMessage(effectiveStatus);
  const shouldPersist =
    effectiveStatus !== currentStatus ||
    providerReferenceId !== (normalize(verification.provider_reference_id) || null) ||
    statusMessage !== normalize(verification.status_message);

  if (!shouldPersist) {
    return { changed: false, verification, transfer: transferSnapshot };
  }

  const updatedVerification = await applyPreSignupBankVerificationTransferStatus(
    supabase,
    {
      verification,
      transferReferenceId,
      providerReferenceId,
      transferStatus: effectiveStatus,
      statusMessage,
    },
  );

  return {
    changed: true,
    verification: updatedVerification,
    transfer: transferSnapshot,
  };
};

export const syncPendingPreSignupBankVerifications = async (
  supabase: any,
  input?: {
    email?: string;
    transferId?: string;
    limit?: number;
  },
) => {
  let query = supabase
    .from("owner_signup_bank_verifications")
    .select("*")
    .eq("transfer_status", "pending")
    .not("transfer_reference_id", "is", null)
    .is("consumed_at", null)
    .order("last_attempt_at", { ascending: true });

  const email = lower(input?.email);
  const transferId = normalize(input?.transferId);
  if (email) {
    query = query.eq("email", email);
  }
  if (transferId) {
    query = query.eq("transfer_reference_id", transferId);
  }
  if (!email && !transferId) {
    query = query.limit(Math.max(1, Math.min(100, Number(input?.limit || 20))));
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const results = [];

  for (const row of rows) {
    results.push(await reconcilePreSignupBankVerification(supabase, row));
  }

  return results;
};

export const reconcileOwnerBankVerification = async (
  supabase: any,
  verification: Record<string, unknown> | null,
) => {
  if (!verification) {
    return { changed: false, verification: null, transfer: null };
  }

  const ownerId = normalize(verification.owner_id);
  const transferReferenceId = normalize(verification.transfer_reference_id);
  const currentStatus = resolveVerificationTransferStatus(
    verification.transfer_status,
    verification,
  );

  if (!ownerId || !transferReferenceId || currentStatus !== "pending") {
    return { changed: false, verification, transfer: null };
  }

  let transferSnapshot: Record<string, unknown> | null = null;
  try {
    transferSnapshot = (await fetchCashfreeTransfer(transferReferenceId)) as Record<string, unknown>;
  } catch {
    return { changed: false, verification, transfer: null };
  }

  const nextStatus = resolveVerificationTransferStatus(
    transferSnapshot?.status ||
      transferSnapshot?.transfer_status ||
      transferSnapshot?.transferStatus ||
      transferSnapshot?.cf_transfer_status,
    transferSnapshot,
  );
  const providerReferenceId = extractVerificationProviderReference(transferSnapshot);
  const failureMessage =
    nextStatus === "pending"
      ? await resolveOwnerPendingVerificationFailureMessage(supabase, verification)
      : null;
  const effectiveStatus = failureMessage ? "failed" : nextStatus;
  const nextMessage = failureMessage || resolveVerificationMessage(effectiveStatus);
  const currentProviderReference = normalize(verification.provider_reference_id) || null;
  const currentMessage = normalize(verification.status_message);
  const shouldPersist =
    effectiveStatus !== currentStatus ||
    providerReferenceId !== currentProviderReference ||
    nextMessage !== currentMessage;

  if (!shouldPersist) {
    return { changed: false, verification, transfer: transferSnapshot };
  }

  const updatedVerification = await applyOwnerBankVerificationTransferStatus(supabase, {
    ownerId,
    transferReferenceId,
    providerReferenceId,
    transferStatus: effectiveStatus,
    statusMessage: nextMessage,
  });

  if (currentStatus !== effectiveStatus && effectiveStatus !== "pending") {
    await notifyOwnerBankVerificationTerminalState(supabase, {
      ownerId,
      verificationId: updatedVerification.id,
      transferReferenceId,
      transferStatus: effectiveStatus,
    });
  }

  return {
    changed: true,
    verification: updatedVerification,
    transfer: transferSnapshot,
  };
};

export const syncPendingOwnerBankVerifications = async (
  supabase: any,
  input?: {
    ownerId?: string;
    limit?: number;
  },
) => {
  let query = supabase
    .from("owner_bank_verification")
    .select("*")
    .eq("transfer_status", "pending")
    .not("transfer_reference_id", "is", null)
    .order("last_attempt_at", { ascending: true });

  const ownerId = normalize(input?.ownerId);
  if (ownerId) {
    query = query.eq("owner_id", ownerId);
  } else {
    query = query.limit(Math.max(1, Math.min(100, Number(input?.limit || 20))));
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const results = [];

  for (const row of rows) {
    results.push(await reconcileOwnerBankVerification(supabase, row));
  }

  return results;
};

export const runOwnerBankVerificationFlow = async (
  supabase: any,
  ownerId: string,
  options?: { forceNewBeneficiary?: boolean },
) => {
  const currentVerification = await fetchCurrentOwnerBankVerification(supabase, ownerId);
  if (
    currentVerification?.transfer_status === "success" &&
    !options?.forceNewBeneficiary
  ) {
    const history = await fetchOwnerBankVerificationHistory(supabase, ownerId, 10);
    return {
      alreadyVerified: true,
      verification: currentVerification,
      history,
      transferId: currentVerification.transfer_reference_id || null,
      transfer: null,
    };
  }

  if (
    currentVerification?.transfer_status === "pending" &&
    currentVerification.transfer_reference_id &&
    !options?.forceNewBeneficiary
  ) {
    const reconciled = await reconcileOwnerBankVerification(supabase, currentVerification);
    const history = await fetchOwnerBankVerificationHistory(supabase, ownerId, 10);
    return {
      alreadyVerified: false,
      verification: reconciled.verification || currentVerification,
      history,
      transferId: currentVerification.transfer_reference_id || null,
      transfer: reconciled.transfer || null,
    };
  }

  const payoutProfile = await ensureOwnerBeneficiary(supabase, ownerId, {
    forceNewBeneficiary: options?.forceNewBeneficiary,
  });
  const maskedAccount =
    payoutProfile.bankAccount.account_number_last4
      ? `XXXX${payoutProfile.bankAccount.account_number_last4}`
      : getMaskedBankAccountNumber(payoutProfile.accountNumber);
  const transferId = buildVerificationTransferId(ownerId);

  await recordOwnerBankVerificationAttempt(supabase, {
    ownerId,
    bankAccountNumber: maskedAccount,
    ifscCode: payoutProfile.bankAccount.ifsc,
    accountHolderName: payoutProfile.bankAccount.account_holder_name,
    transferAmount: 1,
    transferReferenceId: transferId,
    transferStatus: "pending",
    statusMessage: "Rs 1 verification transfer initiated.",
  });

  await insertOwnerNotification(supabase, {
    userId: ownerId,
    title: "Bank Verification Started",
    message: "Rs 1 verification transfer initiated. We are verifying your bank account now.",
    notificationType: "owner_bank_verification_pending",
    data: {
      owner_id: ownerId,
      transfer_reference_id: transferId,
    },
  });

  try {
    const transfer = await createOwnerVerificationTransfer({
      transferId,
      beneficiaryId: payoutProfile.beneficiaryId,
      amount: 1,
    });

    let nextStatus = transfer.status;
    let providerReferenceId = transfer.providerReferenceId;
    let transferSnapshot = transfer.response;

    const verification = await applyOwnerBankVerificationTransferStatus(supabase, {
      ownerId,
      transferReferenceId: transferId,
      providerReferenceId: providerReferenceId || null,
      transferStatus: nextStatus,
      statusMessage: resolveVerificationMessage(nextStatus),
    });

    if (nextStatus === "success") {
      await insertOwnerNotification(supabase, {
        userId: ownerId,
        title: "Bank Account Verified",
        message: "Your bank account is verified. Your owner account is now active.",
        notificationType: "owner_bank_verification_success",
        data: {
          owner_id: ownerId,
          transfer_reference_id: transferId,
          verification_id: verification.id,
        },
      });
    } else if (nextStatus === "failed") {
      await insertOwnerNotification(supabase, {
        userId: ownerId,
        title: "Bank Verification Failed",
        message: "Bank verification failed. Please update your bank details and try again.",
        notificationType: "owner_bank_verification_failed",
        data: {
          owner_id: ownerId,
          transfer_reference_id: transferId,
          verification_id: verification.id,
        },
      });
    }

    const history = await fetchOwnerBankVerificationHistory(supabase, ownerId, 10);
    return {
      alreadyVerified: false,
      verification,
      history,
      transferId,
      transfer: transferSnapshot,
    };
  } catch (error) {
    const message = resolveVerificationMessage(
      "failed",
      error instanceof Error ? error.message : "Unable to verify owner bank account",
    );

    const verification = await applyOwnerBankVerificationTransferStatus(supabase, {
      ownerId,
      transferReferenceId: transferId,
      transferStatus: "failed",
      statusMessage: message,
    });

    await insertOwnerNotification(supabase, {
      userId: ownerId,
      title: "Bank Verification Failed",
      message: "Bank verification failed. Please update your bank details and try again.",
      notificationType: "owner_bank_verification_failed",
      data: {
        owner_id: ownerId,
        transfer_reference_id: transferId,
        verification_id: verification.id,
      },
    });

    const history = await fetchOwnerBankVerificationHistory(supabase, ownerId, 10);

    return {
      alreadyVerified: false,
      verification,
      history,
      transferId,
      transfer: null,
      error: message,
    };
  }
};
