export interface BankDetails {
  bankName?: string;
  branchName?: string;
  city?: string;
  accountNumber?: string;
  ifscCode?: string;
  accountHolderName?: string;
  beneficiaryId?: string | null;
}

export interface OwnerBankVerificationRecord {
  id: string;
  owner_id: string;
  bank_account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  transfer_amount: number;
  transfer_reference_id?: string | null;
  provider_reference_id?: string | null;
  transfer_status: "pending" | "success" | "failed";
  status_message?: string | null;
  last_attempt_at?: string | null;
  verified_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnerBankVerificationHistoryEntry {
  id: string;
  owner_id: string;
  verification_id?: string | null;
  bank_account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  transfer_amount: number;
  transfer_reference?: string | null;
  provider_reference_id?: string | null;
  transfer_status: "pending" | "success" | "failed";
  error_message?: string | null;
  created_at: string;
}

export interface Owner {
  id: string;
  ownerId?: string;
  owner_id?: string;
  role?: "owner";
  userRef?: string;
  name: string;
  full_name?: string;
  email: string;
  phone: string;
  mobile_number?: string;
  verified: boolean;
  verification_status: "pending" | "approved" | "rejected";
  bank_verified?: boolean;
  bank_verification_status?: string;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  cashfree_status?: string | null;
  created_at?: string;
  updated_at?: string;
  propertiesCount?: number;
  bankDetails?: BankDetails;
  licenseDocUrl?: string;
  rejectionReason?: string;
  bankVerificationStatus?: string;
  bankVerified?: boolean;
  cashfreeBeneficiaryId?: string | null;
  cashfreeTransferId?: string | null;
  cashfreeStatus?: string | null;
  bankVerification?: OwnerBankVerificationRecord | null;
  bankVerificationHistory?: OwnerBankVerificationHistoryEntry[];
}
