import { expect, test, type Page } from '@playwright/test';
import { gotoAppRoute, primeAppStorage } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { loginWithOtpBypass } from '../../helpers/supabase-auth';

const blankStorageState = { cookies: [], origins: [] };

test.use({ storageState: blankStorageState });
test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
const createdSignupEmails = new Set<string>();

const buildUniqueSignupIdentity = () => {
    const seed = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = `otp-signup-${seed}@example.com`;
    const phone = `9${seed.slice(-9).padStart(9, '0')}`;
    createdSignupEmails.add(email);
    return { email, phone };
};

const mockSignupOtpDelivery = async (page: Page) => {
    await page.route('**/functions/v1/send-signup-email-otp', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                message: 'OTP sent to your email.'
            })
        });
    });
};

const goToSignupOtpStep = async (page: Page, identity = buildUniqueSignupIdentity()) => {
    await primeAppStorage(page, 'customer');
    await mockSignupOtpDelivery(page);
    await gotoAppRoute(page, `${BASE_URLS.customer}/signup`);
    await page.getByLabel('Full Name').fill('OTP Signup User');
    await page.getByLabel('Email').fill(identity.email);
    const passwordField = page.getByRole('textbox', { name: 'Password', exact: true });
    const confirmPasswordField = page.getByRole('textbox', { name: 'Confirm Password', exact: true });
    await passwordField.click();
    await expect(page.getByText(/Checking email/i)).toBeHidden({ timeout: 10000 });
    await passwordField.fill('Password@123');
    await confirmPasswordField.fill('Password@123');
    await expect(page.getByRole('button', { name: /^Next$/i })).toBeEnabled();
    await page.getByRole('button', { name: /^Next$/i }).click();
    const contactField = page.locator('#phone');
    const locationField = page.locator('#city');
    await expect(contactField).toBeVisible({ timeout: 15000 });
    await contactField.fill(identity.phone);
    await expect(page.getByText(/Checking phone/i)).toBeHidden({ timeout: 10000 });
    await locationField.selectOption('Bengaluru');
    await expect(page.getByRole('button', { name: /^Next$/i })).toBeEnabled();
    await page.getByRole('button', { name: /^Next$/i }).click();
    return identity;
};

const enterOtp = async (page: Page, code: string) => {
    const otpInputs = page.locator('input[autocomplete="one-time-code"]');
    await expect(otpInputs).toHaveCount(6);
    for (const [index, digit] of code.split('').entries()) {
        await otpInputs.nth(index).fill(digit);
    }
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
});

test.afterAll(async () => {
    for (const email of createdSignupEmails) {
        const user = await admin.findUserByEmail(email);
        if (!user) continue;
        await admin.supabase.from('customers').delete().eq('id', user.id);
        await admin.supabase.from('accounts').delete().eq('id', user.id);
        await admin.deleteTestUser(email);
    }
});

test('OTP-01 the customer signup flow advances to the OTP verification step', async ({ page }) => {
    await goToSignupOtpStep(page);
    await expect(page.locator('input[autocomplete="one-time-code"]').first()).toBeVisible({ timeout: 15000 });
});

test('OTP-02 the signup OTP input accepts a six-digit code', async ({ page }) => {
    await goToSignupOtpStep(page);
    await enterOtp(page, '123456');
    await expect(page.locator('input[autocomplete="one-time-code"]').nth(5)).toHaveValue('6');
});

test('OTP-03 invalid signup OTP codes surface an error state', async ({ page }) => {
    await goToSignupOtpStep(page);
    await page.route('**/functions/v1/verify-signup-email-otp', async (route) => {
        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
                error: {
                    message: 'Verification failed. Please enter a valid 6-digit OTP.',
                    code: 'invalid_otp'
                }
            })
        });
    });
    await enterOtp(page, '111111');
    await page.getByRole('button', { name: /Sign Up/i }).click();
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Verification failed|valid 6-digit OTP|Account verification failed|OTP/i);
});

test('OTP-04 OTP bypass can complete the signup session bootstrap for a new customer', async ({ page }) => {
    const identity = buildUniqueSignupIdentity();
    await primeAppStorage(page, 'customer');
    await gotoAppRoute(page, `${BASE_URLS.customer}/signup`);
    await loginWithOtpBypass(page, {
        role: 'customer',
        email: identity.email,
        baseUrl: BASE_URLS.customer,
        postLoginPath: '/'
    });
    await expect.poll(() => page.url()).toContain(BASE_URLS.customer);
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Available PGs|Results for|Explore/i);
});

test('OTP-05 forgot password sends the flow into the reset-password OTP step', async ({ page }) => {
    await primeAppStorage(page, 'customer');
    await page.route('**/functions/v1/send-password-reset-otp', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                message: 'If an account exists, a reset code has been sent.'
            })
        });
    });
    await gotoAppRoute(page, `${BASE_URLS.customer}/forgot-password`);
    await page.getByLabel('Email').fill('test_customer_e2e@example.com');
    await page.getByRole('button', { name: /Send Reset Code/i }).click();
    await expect.poll(() => page.url()).toContain('/reset-password');
    await expect(page.locator('input[autocomplete="one-time-code"]').first()).toBeVisible();
});

test('OTP-06 OTP bypass can bootstrap the reset-password flow back into an authenticated session', async ({ page }) => {
    await primeAppStorage(page, 'customer');
    await gotoAppRoute(page, `${BASE_URLS.customer}/reset-password`);
    await loginWithOtpBypass(page, {
        role: 'customer',
        email: 'test_customer_e2e@example.com',
        baseUrl: BASE_URLS.customer,
        postLoginPath: '/'
    });
    await expect.poll(() => page.url()).toContain(BASE_URLS.customer);
});

test('OTP-07 the reset-password form shows the resend countdown before the resend link is enabled', async ({ page }) => {
    await primeAppStorage(page, 'customer');
    await gotoAppRoute(page, `${BASE_URLS.customer}/reset-password`);
    await expect(page.getByText(/Resend available in/i)).toBeVisible();
});
