import type { Owner } from "../types/owner.types";

type OwnerLike = Partial<Owner> & {
  bank_verified?: boolean | null;
  bank_verification_status?: string | null;
  cashfree_status?: string | null;
  verification_status?: string | null;
  verified?: boolean | null;
};

const lower = (value: unknown) => String(value ?? "").trim().toLowerCase();

const normalizeTransferStatus = (
  value: unknown,
): "pending" | "success" | "failed" => {
  const normalized = lower(value);
  if (normalized === "success" || normalized === "verified") {
    return "success";
  }
  if (normalized === "failed" || normalized === "rejected") {
    return "failed";
  }
  return "pending";
};

export const resolveOwnerVerificationState = (
  owner: OwnerLike | null | undefined,
) => {
  const rawTransferStatus =
    owner?.bankVerification?.transfer_status ??
    owner?.cashfree_status ??
    owner?.bankVerificationStatus ??
    owner?.bank_verification_status;
  const hasTransferSignal =
    rawTransferStatus !== null &&
    rawTransferStatus !== undefined &&
    String(rawTransferStatus).trim() !== "";
  const transferStatus = normalizeTransferStatus(rawTransferStatus);
  const explicitBankVerified = owner?.bankVerified ?? owner?.bank_verified;
  const bankVerified = hasTransferSignal
    ? transferStatus === "success"
    : explicitBankVerified === true;
  const approved =
    lower(owner?.verification_status) === "approved" || owner?.verified === true;
  const isGrandfatheredApproved = approved && !bankVerified;
  const ownerActive = bankVerified && approved;

  return {
    approved,
    bankVerified,
    transferStatus,
    isGrandfatheredApproved,
    ownerActive,
    requiresBankVerification: !bankVerified,
    requiresAdminApproval: bankVerified && !approved,
  };
};

export const isOwnerBankVerified = (owner: OwnerLike | null | undefined) =>
  resolveOwnerVerificationState(owner).bankVerified;
