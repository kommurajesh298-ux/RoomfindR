// Removed legacy firebase imports

export interface BankDetails {
    bankName: string;
    branchName?: string;
    city?: string;
    accountNumber: string;
    ifscCode: string;
    accountHolderName: string;
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
    transfer_status: 'pending' | 'success' | 'failed';
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
    transfer_status: 'pending' | 'success' | 'failed';
    error_message?: string | null;
    created_at: string;
}

export interface Owner {
    id: string;
    email: string;
    name: string;
    phone: string;
    verified: boolean;
    verification_status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    propertiesCount?: number;
    bankDetails?: BankDetails;
    licenseDocUrl?: string;
    rejectionReason?: string;
    bankVerificationStatus?: string;
    bankVerified?: boolean;
    cashfreeStatus?: string | null;
    cashfreeBeneficiaryId?: string | null;
    bankVerification?: OwnerBankVerificationRecord | null;
    bankVerificationHistory?: OwnerBankVerificationHistoryEntry[];
}

export interface Settlement {
    id: string;
    payment_id?: string | null;
    payment_type?: string | null;
    owner_id: string;
    week_start_date: string;
    week_end_date: string;
    total_amount: number;
    platform_fee: number;
    net_payable: number;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    provider_transfer_id?: string;
    provider_reference?: string;
    processed_at?: string;

    created_at: string;
    owners?: {
        name?: string;
        email?: string;
    };
}
