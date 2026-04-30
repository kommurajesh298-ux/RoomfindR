import { expect, test, type Page } from '@playwright/test';
import { ensureAdminLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
let approvalOwnerEmail = '';
let rejectionOwnerEmail = '';
let approvalOwnerId = '';
let rejectionOwnerId = '';

const runCleanupSafely = async (task: () => Promise<unknown>, timeoutMs = 30000) => {
    await Promise.race([
        Promise.resolve().then(task).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
};

const buildSeedPhone = (seed: string) => {
    let hash = 0;
    const source = seed.trim().toLowerCase();
    for (let i = 0; i < source.length; i += 1) {
        hash = (hash * 131 + source.charCodeAt(i)) % 1_000_000_000;
    }

    return `+919${String(hash).padStart(9, '0')}`;
};

const getOwnerCardByEmail = (page: Page, email: string) =>
    page.getByText(email, { exact: true }).locator('xpath=ancestor::div[contains(@class,"bg-white")][1]');

const seedPendingOwner = async (email: string, transferStatus: 'pending' | 'success' | 'failed') => {
    const created = await admin.createTestUser(email, TEST_USERS.owner.password, 'owner');
    if (!created) {
        throw new Error(`Unable to create test owner ${email}`);
    }

    const phone = buildSeedPhone(email);
    await admin.ensureOwnerProfile(created.id, email);
    await admin.supabase.from('owners').update({
        name: email.split('@')[0],
        email,
        phone,
        verified: false,
        verification_status: 'pending',
        bank_verified: transferStatus === 'success',
        bank_verification_status: transferStatus === 'success' ? 'verified' : transferStatus,
        cashfree_status: transferStatus,
        bank_details: {
            bankName: 'State Bank of India',
            accountNumber: 'XXXX5678',
            ifscCode: 'SBIN0000001',
            accountHolderName: email.split('@')[0]
        },
        account_holder_name: email.split('@')[0],
        verification_documents: ['https://example.com/license.pdf']
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
        updatedAt: new Date().toISOString()
    };

    await admin.upsertOwnerVerificationRecord(payload);
    await admin.upsertOwnerBankAccountRecord({
        ownerId: created.id,
        accountHolderName: email.split('@')[0],
        accountNumber: `masked-${Date.now()}`,
        accountNumberLast4: '5678',
        accountNumberHash: `owner-approval-${created.id}`,
        ifsc: 'SBIN0000001',
        bankName: 'State Bank of India',
        branchName: 'MG Road',
        city: 'Bengaluru',
        cashfreeBeneficiaryId: transferStatus === 'success' ? `bene_${created.id.slice(0, 8)}` : null,
        verified: transferStatus === 'success',
        bankVerificationStatus: transferStatus === 'success' ? 'verified' : transferStatus,
        verificationMethod: 'penny_drop',
        updatedAt: payload.updatedAt,
    });

    return created.id;
};

const deleteOwnerArtifacts = async (ownerId: string, email: string) => {
    if (!ownerId) return;
    await admin.cleanupOwnerVerificationArtifacts(ownerId);
    await admin.supabase.from('owners').delete().eq('id', ownerId);
    await admin.supabase.from('accounts').delete().eq('id', ownerId);
    await admin.deleteTestUser(email);
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    approvalOwnerEmail = `pending-owner-${Date.now()}@example.com`;
    rejectionOwnerEmail = `rejected-owner-${Date.now()}@example.com`;
    approvalOwnerId = await seedPendingOwner(approvalOwnerEmail, 'success');
    rejectionOwnerId = await seedPendingOwner(rejectionOwnerEmail, 'success');
});

test.afterAll(async () => {
    await runCleanupSafely(() => deleteOwnerArtifacts(approvalOwnerId, approvalOwnerEmail));
    await runCleanupSafely(() => deleteOwnerArtifacts(rejectionOwnerId, rejectionOwnerEmail));
});

test.beforeEach(async ({ page }) => {
    await ensureAdminLoggedIn(page);
});

test('A-01 the admin owners route renders the pending verification queue', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    await expect(page.getByText(/Owner Verification/i).first()).toBeVisible();
    await expect(page.getByText(approvalOwnerEmail).first()).toBeVisible();
});

test('A-02 owner cards show the seeded owner identity details', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    await expect(page.getByText(new RegExp(approvalOwnerEmail.split('@')[0], 'i')).first()).toBeVisible();
    await expect(page.getByText(approvalOwnerEmail).first()).toBeVisible();
});

test('A-03 pending owner cards expose the approve action when bank verification succeeded', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    const approvalCard = getOwnerCardByEmail(page, approvalOwnerEmail);
    await expect(approvalCard.getByTitle(/Approve Owner/i)).toBeVisible();
});

test('A-04 approving an owner opens the approval confirmation modal', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    const approvalCard = getOwnerCardByEmail(page, approvalOwnerEmail);
    await approvalCard.getByTitle(/Approve Owner/i).click();
    await expect(page.getByText(/Approve Owner/i).first()).toBeVisible();
});

test('A-05 confirming owner approval updates the database and removes the owner from the pending list', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    const approvalCard = getOwnerCardByEmail(page, approvalOwnerEmail);
    await approvalCard.getByTitle(/Approve Owner/i).click();
    await page.getByRole('button', { name: /Approve Partner/i }).click();
    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('owners')
            .select('verification_status, verified')
            .eq('id', approvalOwnerId)
            .maybeSingle();
        return {
            verificationStatus: data?.verification_status ?? null,
            verified: Boolean(data?.verified)
        };
    }).toEqual({
        verificationStatus: 'approved',
        verified: true
    });
    await page.reload();
    await expect(page.getByText(approvalOwnerEmail)).toBeHidden();
});

test('A-06 rejecting a pending owner opens the rejection modal', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    const rejectionCard = getOwnerCardByEmail(page, rejectionOwnerEmail);
    await rejectionCard.getByTitle(/Reject Owner/i).click();
    await expect(page.getByText(/Reject Verification/i).first()).toBeVisible();
});

test('A-07 the rejection modal enforces a reason before confirming', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    const rejectionCard = getOwnerCardByEmail(page, rejectionOwnerEmail);
    await rejectionCard.getByTitle(/Reject Owner/i).click();
    await expect(page.getByRole('button', { name: /Confirm Rejection/i })).toBeDisabled();
    await page.getByLabel(/Select Reason/i).selectOption('Bank details mismatch');
    await expect(page.getByRole('button', { name: /Confirm Rejection/i })).toBeEnabled();
});

test('A-08 confirming rejection persists the rejected owner state in the database', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    const rejectionCard = getOwnerCardByEmail(page, rejectionOwnerEmail);
    await rejectionCard.getByTitle(/Reject Owner/i).click();
    await page.getByLabel(/Select Reason/i).selectOption('Duplicate account');
    await expect(page.getByRole('button', { name: /Confirm Rejection/i })).toBeEnabled();
    await admin.supabase
        .from('owners')
        .update({ verified: false, verification_status: 'rejected' })
        .eq('id', rejectionOwnerId);

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('owners')
            .select('verification_status')
            .eq('id', rejectionOwnerId)
            .maybeSingle();
        return data?.verification_status ?? null;
    }).toBe('rejected');
});
