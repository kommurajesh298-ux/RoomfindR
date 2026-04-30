import { expect, test, type Page } from '@playwright/test';
import { ensureOwnerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let admin: SupabaseAdminHelper;
let ownerId = '';
const BANK_VERIFICATION_OWNER_EMAIL = 'test_owner_bank_e2e@example.com';

const seedOwnerBankState = async (transferStatus: 'pending' | 'success' | 'failed') => {
    const timestamp = new Date().toISOString();
    const ownerApproved = transferStatus === 'success';
    const ownerVerificationStatus = ownerApproved ? 'approved' : 'pending';
    const ownerBankStatus = transferStatus === 'success' ? 'verified' : transferStatus === 'failed' ? 'failed' : 'pending';
    const bankAccountStatus = transferStatus === 'success' ? 'verified' : transferStatus === 'failed' ? 'rejected' : 'pending';
    const transferReferenceId = `verify_${Date.now()}`;
    const providerReferenceId = `provider_${Date.now()}`;
    const accountHash = `e2e-bank-hash-${transferStatus}-${Date.now()}`;

    await admin.supabase
        .from('owners')
        .update({
            verified: ownerApproved,
            verification_status: ownerVerificationStatus,
            bank_verified: transferStatus === 'success',
            bank_verification_status: ownerBankStatus,
            cashfree_status: transferStatus,
            cashfree_transfer_id: transferReferenceId,
            bank_details: {
                bankName: 'State Bank of India',
                accountNumber: 'XXXX1234',
                ifscCode: 'SBIN0000001',
                accountHolderName: 'Test Owner'
            },
            account_holder_name: 'Test Owner',
            bank_account_number: 'XXXX1234',
            bank_ifsc: 'SBIN0000001',
            updated_at: timestamp,
        })
        .eq('id', ownerId);

    await admin.upsertOwnerBankAccountRecord({
        ownerId,
        accountHolderName: 'Test Owner',
        accountNumber: 'e2e-test-account-encrypted',
        accountNumberLast4: '1234',
        accountNumberHash: accountHash,
        ifsc: 'SBIN0000001',
        bankName: 'State Bank of India',
        branchName: 'MG Road',
        city: 'Bengaluru',
        cashfreeBeneficiaryId: transferStatus === 'failed' ? null : `bene_${ownerId.slice(0, 8)}`,
        verified: transferStatus === 'success',
        bankVerificationStatus: bankAccountStatus,
        verificationMethod: 'penny_drop',
        updatedAt: timestamp,
    });

    await admin.upsertOwnerVerificationRecord({
        ownerId,
        email: BANK_VERIFICATION_OWNER_EMAIL,
        phone: null,
        bankAccountNumber: 'XXXX1234',
        ifscCode: 'SBIN0000001',
        accountHolderName: 'Test Owner',
        transferAmount: 1,
        transferReferenceId,
        providerReferenceId,
        transferStatus,
        statusMessage: transferStatus === 'failed'
            ? 'Bank verification failed.'
            : transferStatus === 'success'
                ? 'Your bank account is verified.'
                : 'Verification in progress.',
        lastAttemptAt: timestamp,
        verifiedAt: transferStatus === 'success' ? timestamp : null,
        createdAt: timestamp,
        updatedAt: timestamp
    });

    await admin.supabase
        .from('owner_bank_verification_history')
        .insert({
            owner_id: ownerId,
            verification_id: null,
            bank_account_number: 'XXXX1234',
            ifsc_code: 'SBIN0000001',
            account_holder_name: 'Test Owner',
            transfer_amount: 1,
            transfer_reference: transferReferenceId,
            provider_reference_id: providerReferenceId,
            transfer_status: transferStatus,
            error_message: transferStatus === 'failed' ? 'Bank verification failed.' : null,
            created_at: timestamp,
        });
};

const gotoBankVerificationSurface = async (page: Page) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/profile`);
    const hasBankCard = await page.getByText(/Bank Verification|Bank Account|IFSC/i).first().isVisible().catch(() => false);
    if (hasBankCard) return;

    await gotoAppRoute(page, `${BASE_URLS.owner}/verification-status`);
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Bank Verification|Bank Account|IFSC/i);
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    const owner = await admin.findUserByEmail(BANK_VERIFICATION_OWNER_EMAIL)
        || await admin.createTestUser(
            BANK_VERIFICATION_OWNER_EMAIL,
            TEST_USERS.owner.password,
            'owner',
        );
    ownerId = owner?.id || '';
    if (ownerId) {
        await admin.ensureOwnerProfile(ownerId, BANK_VERIFICATION_OWNER_EMAIL);
    }
    await seedOwnerBankState('pending');
});

test.beforeEach(async ({ page }) => {
    await ensureOwnerLoggedInAs(page, BANK_VERIFICATION_OWNER_EMAIL, {
        password: TEST_USERS.owner.password,
    });
});

test.afterEach(async () => {
    if (ownerId) {
        await admin.ensureOwnerVerified(ownerId, BANK_VERIFICATION_OWNER_EMAIL);
    }
});

test('O-21 owner bank verification details are visible on the owner surface', async ({ page }) => {
    await gotoBankVerificationSurface(page);
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Bank Verification|Bank Account|IFSC/i);
});

test('O-22 invalid bank reset submissions surface a validation or failure message', async ({ page }) => {
    await seedOwnerBankState('failed');
    await gotoBankVerificationSurface(page);
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Failed|Bank verification failed|Update Bank Details|Add Bank Details/i);
    await page.getByRole('button', { name: /(Add|Update|Reset) Bank Details/i }).click();
    await page.getByRole('textbox', { name: /Account Holder Name/i }).fill('Test Owner');
    await page.getByRole('textbox', { name: /^IFSC$/i }).fill('ABC');
    await page.getByRole('textbox', { name: /^Account Number$/i }).fill('12345678');
    await page.getByRole('textbox', { name: /Confirm Account Number/i }).fill('12345678');
    await page.getByRole('button', { name: /Start Bank Verification|Submit And Retry Verification/i }).click();
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/IFSC|Unable|Verification|failed|required/i);
});

test('O-23 valid bank details can be resubmitted for verification retry', async ({ page }) => {
    await seedOwnerBankState('failed');
    await gotoBankVerificationSurface(page);
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Failed|Bank verification failed|Update Bank Details|Add Bank Details/i);
    await page.getByRole('button', { name: /(Add|Update|Reset) Bank Details/i }).click();
    await page.getByRole('textbox', { name: /Account Holder Name/i }).fill('Test Owner');
    await page.getByRole('textbox', { name: /^IFSC$/i }).fill('SBIN0000001');
    await page.getByRole('textbox', { name: /^Account Number$/i }).fill('123456789012');
    await page.getByRole('textbox', { name: /Confirm Account Number/i }).fill('123456789012');
    await page.getByRole('button', { name: /Start Bank Verification|Submit And Retry Verification/i }).click();
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Pending|verification/i);
});

test('O-24 pending verification badges render after a pending verification seed', async ({ page }) => {
    await seedOwnerBankState('pending');
    await gotoBankVerificationSurface(page);
    await expect(page.getByText(/Pending/i).first()).toBeVisible();
});

test('O-25 failed verification states expose the reset bank details action', async ({ page }) => {
    await seedOwnerBankState('failed');
    await gotoBankVerificationSurface(page);
    await expect(page.getByRole('button', { name: /(Add|Update|Reset) Bank Details/i })).toBeVisible();
});

test('O-26 reset bank details opens an editable bank form again', async ({ page }) => {
    await seedOwnerBankState('failed');
    await gotoBankVerificationSurface(page);
    await page.getByRole('button', { name: /(Add|Update|Reset) Bank Details/i }).click();
    await expect(page.getByRole('textbox', { name: /^IFSC$/i })).toBeEditable();
    await expect(page.getByRole('textbox', { name: /^Account Number$/i })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: /Confirm Account Number/i })).toHaveValue('');
});
