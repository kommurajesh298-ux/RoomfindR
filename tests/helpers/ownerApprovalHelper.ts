import { SupabaseAdminHelper } from './supabase-admin';
import { TEST_USERS, buildSeedPhone } from '../data/test-users';

export const createOwnerApprovalHelper = (admin: SupabaseAdminHelper) => ({
    async seedPendingOwner(email: string, transferStatus: 'pending' | 'success' | 'failed' = 'success') {
        const created = await admin.createTestUser(email, TEST_USERS.owner.password, 'owner');
        if (!created) {
            throw new Error(`Unable to create owner ${email}`);
        }

        const phone = buildSeedPhone(email);
        await admin.ensureOwnerProfile(created.id, email);
        await admin.supabase.from('owners').update({
            name: email.split('@')[0],
            email,
            phone,
            verified: false,
            verification_status: 'pending',
            bank_details: {
                bankName: 'State Bank of India',
                accountNumber: 'XXXX5678',
                ifscCode: 'SBIN0000001',
                accountHolderName: email.split('@')[0],
            },
            account_holder_name: email.split('@')[0],
            verification_documents: ['https://example.com/license.pdf'],
        }).eq('id', created.id);

        const payload = {
            ownerId: created.id,
            email,
            phone,
            bankAccountNumber: 'XXXX5678',
            ifscCode: 'SBIN0000001',
            accountHolderName: email.split('@')[0],
            transferAmount: 1,
            transferReferenceId: `owner_verify_${email.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`,
            providerReferenceId: `provider_${email.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`,
            transferStatus,
            statusMessage: transferStatus === 'success' ? 'Your bank account is verified.' : 'Verification in progress.',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await admin.upsertOwnerVerificationRecord(payload);

        return { ownerId: created.id, email };
    },
});
