import type { Owner } from '../types/owner.types';

export const resolveOwnerBankVerificationStatus = (
    owner: Pick<Owner, 'bankVerification' | 'bankVerificationStatus' | 'bankVerified' | 'cashfreeStatus'>
): 'pending' | 'success' | 'failed' => {
    if (owner.bankVerification?.transfer_status === 'success') {
        return 'success';
    }

    if (
        owner.bankVerificationStatus === 'verified'
        || owner.bankVerified === true
        || owner.cashfreeStatus === 'success'
    ) {
        return 'success';
    }

    if (owner.bankVerification?.transfer_status === 'failed') {
        return 'failed';
    }

    if (owner.bankVerificationStatus === 'failed' || owner.bankVerificationStatus === 'rejected') {
        return 'failed';
    }

    return 'pending';
};

export const canResetOwnerBankDetails = (
    owner: Pick<Owner, 'bankVerification' | 'bankVerificationStatus'>
) => resolveOwnerBankVerificationStatus(owner) !== 'success';
