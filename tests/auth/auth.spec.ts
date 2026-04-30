import { expect, test } from '@playwright/test';
import { gotoAppRoute, primeAppStorage } from '../helpers/app-shell';
import { BASE_URLS } from '../helpers/e2e-config';
import { createAuthHelper } from '../utils/authHelper';
import { cleanupIdentity, ensureTestIdentity } from '../utils/apiHelper';

test.describe.configure({ mode: 'serial' });

const fillCustomerAccountStep = async (page: import('@playwright/test').Page, identity: {
    fullName: string;
    email: string;
    password: string;
}) => {
    await primeAppStorage(page, 'customer');
    await gotoAppRoute(page, `${BASE_URLS.customer}/signup`);
    await page.getByLabel(/Full Name/i).fill(identity.fullName);
    await page.getByLabel(/Email/i).fill(identity.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(identity.password);
    await page.getByRole('textbox', { name: 'Confirm Password', exact: true }).fill(identity.password);
};

const continueCustomerSignupToOtp = async (page: import('@playwright/test').Page, identity: {
    fullName: string;
    email: string;
    password: string;
    phone: string;
    city?: string;
}) => {
    await fillCustomerAccountStep(page, identity);
    await page.getByRole('button', { name: /^Next$/i }).click();
    await page.locator('#phone').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#phone').fill(identity.phone.replace(/^\+91/, ''));
    await page.locator('#city').selectOption(identity.city || 'Bengaluru');
    await page.getByRole('button', { name: /^Next$/i }).click();
};

test('AUTHSYS-01 customer signup reaches OTP verification and duplicate signup is blocked', async ({ page }) => {
    const auth = createAuthHelper(page);
    const customer = auth.createIdentity('system-auth', 'customer', { password: 'Password@123' });
    await cleanupIdentity(customer).catch(() => undefined);

    await auth.signup('customer', customer, true);
    await expect(page).toHaveURL(/127\.0\.0\.1:5173/);
    await auth.logout('customer');

    await fillCustomerAccountStep(page, customer);
    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.locator('body')).toContainText(/already exists|already registered/i, {
        timeout: 15000,
    });

    await cleanupIdentity(customer);
});

test('AUTHSYS-02 login success, wrong credentials rejection, and logout stay consistent', async ({ page }) => {
    const auth = createAuthHelper(page);
    const customer = auth.createIdentity('system-auth', 'customer');
    await cleanupIdentity(customer).catch(() => undefined);
    await ensureTestIdentity(customer);

    await auth.login('customer', {
        email: customer.email,
        password: customer.password,
        mode: 'ui',
    });
    await expect(page).toHaveURL(/127\.0\.0\.1:5173/);

    await auth.logout('customer');
    await expect.poll(async () => {
        try {
            return await page.evaluate(() =>
                Object.keys(window.localStorage).filter((key) => key.includes('auth-token') && window.localStorage.getItem(key)).length,
            );
        } catch {
            return -1;
        }
    }).toBe(0);

    await auth.login('customer', {
        email: customer.email,
        password: 'wrong-password',
        mode: 'ui',
    }).catch(() => undefined);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/invalid|failed|password/i);

    await auth.login('customer', {
        email: `missing-${Date.now()}@example.com`,
        password: customer.password,
        mode: 'ui',
    }).catch(() => undefined);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/invalid|failed|account|email/i);

    await cleanupIdentity(customer);
});

test('AUTHSYS-03 owner login uses a verified account state with bank/KYC data ready', async ({ page }) => {
    const auth = createAuthHelper(page);
    const owner = auth.createIdentity('system-auth', 'owner');
    await cleanupIdentity(owner).catch(() => undefined);
    const user = await ensureTestIdentity(owner);

    await auth.login('owner', {
        email: owner.email,
        password: owner.password,
        mode: 'ui',
    });

    await expect(page).toHaveURL(/\/dashboard/);
    const admin = (await import('../utils/apiHelper')).getAdminHelper();
    const { data, error } = await admin.supabase
        .from('owners')
        .select('verified, verification_status, bank_verified, bank_verification_status')
        .eq('id', user?.id || '')
        .maybeSingle();
    expect(error).toBeNull();
    expect(Boolean(data?.verified)).toBe(true);
    expect(String(data?.verification_status || '').toLowerCase()).toBe('approved');
    expect(Boolean(data?.bank_verified)).toBe(true);
    expect(String(data?.bank_verification_status || '').toLowerCase()).toBe('verified');

    await cleanupIdentity(owner);
});
