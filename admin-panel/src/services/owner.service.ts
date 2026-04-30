import { supabase } from './supabase-config';
import { invokeProtectedEdgeFunction } from './protected-edge.service';
import type {
    OwnerBankVerificationHistoryEntry,
    OwnerBankVerificationRecord,
} from '../types/owner.types';

const OWNER_SIGNUP_VERIFICATION_TABLE = 'owner_signup_bank_verifications';
const OWNER_CURRENT_VERIFICATION_TABLE = 'owner_bank_verification';
const OWNER_BANK_ACCOUNTS_TABLE = 'owner_bank_accounts';

const isMissingRelationError = (error: unknown) => {
    const code = String((error as { code?: string } | null)?.code || '').trim();
    const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
    return code === 'PGRST204'
        || code === 'PGRST205'
        || code === '42P01'
        || code === '42703'
        || message.includes('schema cache')
        || message.includes('does not exist')
        || message.includes('could not find the');
};

const mapOwnerVerificationRecord = (row: Record<string, unknown> | null | undefined): OwnerBankVerificationRecord | null => {
    if (!row?.id || !row.owner_id) return null;

    const accountNumberLast4 = String(row.account_number_last4 || '').replace(/\D/g, '').slice(-4);
    const maskedAccountNumber = String(row.bank_account_number || '').trim();
    const fallbackAccount = String(row.account_number_encrypted || '').trim();

    return {
        id: String(row.id),
        owner_id: String(row.owner_id),
        bank_account_number: accountNumberLast4.length === 4
            ? `XXXX${accountNumberLast4}`
            : maskedAccountNumber || fallbackAccount,
        ifsc_code: String(row.ifsc_code || row.ifsc || ''),
        account_holder_name: String(row.account_holder_name || row.full_name || ''),
        transfer_amount: Number(row.transfer_amount || 1),
        transfer_reference_id: row.transfer_reference_id ? String(row.transfer_reference_id) : null,
        provider_reference_id: row.provider_reference_id ? String(row.provider_reference_id) : null,
        transfer_status: row.transfer_status === 'success' || row.transfer_status === 'failed' ? row.transfer_status : 'pending',
        status_message: row.status_message ? String(row.status_message) : null,
        last_attempt_at: row.last_attempt_at ? String(row.last_attempt_at) : null,
        verified_at: row.verified_at ? String(row.verified_at) : null,
        created_at: String(row.created_at || ''),
        updated_at: String(row.updated_at || row.created_at || ''),
    };
};

export const ownerService = {
    getAllOwners: async () => {
        // 1. Fetch owners
        const { data: owners, error: ownersError } = await supabase
            .from('owners')
            .select('*')
            .order('created_at', { ascending: false });

        if (ownersError) throw ownersError;

        const ownerIds = (owners || []).map(owner => owner.id);
        const { data: currentBankVerifications, error: currentBankVerificationsError } = await supabase
            .from(OWNER_CURRENT_VERIFICATION_TABLE)
            .select('*')
            .in('owner_id', ownerIds.length > 0 ? ownerIds : ['00000000-0000-0000-0000-000000000000']);

        if (currentBankVerificationsError) {
            console.error('[Admin] Error fetching current owner bank verifications:', currentBankVerificationsError);
        }

        const { data: signupBankVerifications, error: signupBankVerificationsError } = await supabase
            .from(OWNER_SIGNUP_VERIFICATION_TABLE)
            .select('*')
            .in('owner_id', ownerIds.length > 0 ? ownerIds : ['00000000-0000-0000-0000-000000000000']);

        if (signupBankVerificationsError) {
            console.error('[Admin] Error fetching owner signup bank verifications:', signupBankVerificationsError);
        }

        const currentVerificationMap = new Map(
            (currentBankVerifications || [])
                .map((row) => mapOwnerVerificationRecord(row as Record<string, unknown>))
                .filter((row): row is OwnerBankVerificationRecord => Boolean(row))
                .map((row) => [row.owner_id, row]),
        );

        const signupVerificationMap = new Map(
            (signupBankVerifications || [])
                .map((row) => mapOwnerVerificationRecord(row as Record<string, unknown>))
                .filter((row): row is OwnerBankVerificationRecord => Boolean(row))
                .map((row) => [row.owner_id, row]),
        );

        // 2. Fetch all properties to count them manually (bypassing potential embedding RLS issues)
        const { data: properties, error: propertiesError } = await supabase
            .from('properties')
            .select('id, owner_id');

        if (propertiesError) {
            console.error('[Admin] Error fetching properties:', propertiesError);
            console.error('[Admin] RLS might be blocking. User may not have admin role.');
            // Don't throw - continue with empty array
        }

        // Owners fetched

        return (owners || []).map(owner => {
            const mappedOwner = { ...owner };

            // Calculate property count manually
            const ownerProperties = properties?.filter(p => p.owner_id === owner.id) || [];
            mappedOwner.propertiesCount = ownerProperties.length;

            // Owner processed

            if (mappedOwner.bank_details) {
                mappedOwner.bankDetails = mappedOwner.bank_details;
                // Ensure accountHolderName matches the dedicated column if available
                if (mappedOwner.account_holder_name) {
                    mappedOwner.bankDetails.accountHolderName = mappedOwner.account_holder_name;
                }
                delete mappedOwner.bank_details;
            }

            // Map verification_documents array to licenseDocUrl
            if (mappedOwner.verification_documents && mappedOwner.verification_documents.length > 0) {
                mappedOwner.licenseDocUrl = mappedOwner.verification_documents[0];
            }

            mappedOwner.bankVerificationStatus = mappedOwner.bank_verification_status || mappedOwner.bankVerificationStatus;
            mappedOwner.bankVerified = mappedOwner.bank_verified ?? mappedOwner.bankVerified ?? false;
            mappedOwner.cashfreeStatus = mappedOwner.cashfree_status || mappedOwner.cashfreeStatus || null;
            mappedOwner.cashfreeBeneficiaryId = mappedOwner.cashfree_beneficiary_id || mappedOwner.cashfreeBeneficiaryId || null;
            mappedOwner.bankVerification =
                currentVerificationMap.get(owner.id) ||
                signupVerificationMap.get(owner.id) ||
                null;

            return mappedOwner;
        });
    },

    verifyOwner: async (id: string, verified: boolean) => {
        await supabase.from('owners').update({ verified }).eq('id', id);
    },
    getOwnerProperties: async (ownerId: string) => {
        const { data, error } = await supabase.from('properties').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },
    approveOwner: async (id: string) => {
        const { data: bankVerification, error: verificationError } = await supabase
            .from(OWNER_CURRENT_VERIFICATION_TABLE)
            .select('transfer_status')
            .eq('owner_id', id)
            .maybeSingle();

        if (verificationError && !isMissingRelationError(verificationError)) {
            console.error('[Admin] Error checking owner bank verification:', verificationError);
            throw verificationError;
        }

        let verificationSucceeded = bankVerification?.transfer_status === 'success';

        if (!verificationSucceeded) {
            const { data: signupVerification, error: signupVerificationError } = await supabase
                .from(OWNER_SIGNUP_VERIFICATION_TABLE)
                .select('transfer_status')
                .eq('owner_id', id)
                .maybeSingle();

            if (signupVerificationError && !isMissingRelationError(signupVerificationError)) {
                console.error('[Admin] Error checking owner signup bank verification:', signupVerificationError);
                throw signupVerificationError;
            }

            verificationSucceeded = signupVerification?.transfer_status === 'success';
        }

        if (!verificationSucceeded) {
            const { data: bankAccount, error: bankAccountError } = await supabase
                .from(OWNER_BANK_ACCOUNTS_TABLE)
                .select('verified, bank_verification_status')
                .eq('owner_id', id)
                .maybeSingle();

            if (bankAccountError && !isMissingRelationError(bankAccountError)) {
                console.error('[Admin] Error checking owner bank account verification:', bankAccountError);
                throw bankAccountError;
            }

            verificationSucceeded = bankAccount?.verified === true
                || bankAccount?.bank_verification_status === 'verified';
        }

        if (!verificationSucceeded) {
            const { data: ownerState, error: ownerStateError } = await supabase
                .from('owners')
                .select('bank_verified, bank_verification_status, cashfree_status')
                .eq('id', id)
                .maybeSingle();

            if (ownerStateError && !isMissingRelationError(ownerStateError)) {
                console.error('[Admin] Error checking owner verification fallback state:', ownerStateError);
                throw ownerStateError;
            }

            verificationSucceeded = ownerState?.bank_verified === true
                || ownerState?.bank_verification_status === 'verified'
                || ownerState?.cashfree_status === 'success';
        }

        if (!verificationSucceeded) {
            throw new Error('Owner bank verification must succeed before approval.');
        }

        const { error: ownerError } = await supabase
            .from('owners')
            .update({ verified: true, verification_status: 'approved' })
            .eq('id', id);
        if (ownerError) {
            console.error('[Admin] Error approving owner:', ownerError);
            throw ownerError;
        }

        const { error: accountError } = await supabase
            .from('accounts')
            .update({ account_status: 'active' })
            .eq('id', id);
        if (accountError) {
            console.error('[Admin] Error activating approved owner account:', accountError);
            throw accountError;
        }
    },
    rejectOwner: async (id: string) => {
        const { error } = await supabase.from('owners').update({ verified: false, verification_status: 'rejected' }).eq('id', id);
        if (error) {
            console.error('[Admin] Error rejecting owner:', error);
            throw error;
        }
    },

    getOwnerVerificationOverview: async (ownerId: string) => {
        return invokeProtectedEdgeFunction<{
            success: boolean;
            verification: OwnerBankVerificationRecord | null;
            history: OwnerBankVerificationHistoryEntry[];
        }>(
            'get-owner-verification-history',
            { ownerId, limit: 20 },
            'Unable to fetch owner verification history',
        );
    },

    resetOwnerBankDetails: async (ownerId: string) => {
        return invokeProtectedEdgeFunction<{
            success: boolean;
            reset_required?: boolean;
            verification: OwnerBankVerificationRecord | null;
            history: OwnerBankVerificationHistoryEntry[];
        }>(
            'reset-owner-bank',
            { ownerId },
            'Unable to reset owner bank details',
        );
    }
};
