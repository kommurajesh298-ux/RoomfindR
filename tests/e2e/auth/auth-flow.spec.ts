import { test, expect } from '../../fixtures/roomfindr.fixture';
import { createTestIdentity, TEST_USERS } from '../../data/test-users';
import { loginHelper } from '../../helpers/loginHelper';

test.describe('auth lifecycle flows', () => {
    test('AUTH-01 customer signup reaches OTP verification and can bootstrap a fresh session', async ({
        page,
        signup,
        cleanupRegistry,
        cleanupTestData,
    }) => {
        const identity = createTestIdentity('auth-signup', 'customer');
        cleanupRegistry.add(`cleanup ${identity.email}`, async () => {
            await cleanupTestData({
                users: [{ email: identity.email, role: 'customer', deleteAuthUser: true }],
            });
        });

        await signup({
            role: 'customer',
            identity,
            completeWithBypass: false,
        });

        await expect(page.locator('input[autocomplete="one-time-code"]').first()).toBeVisible();

        await signup({
            role: 'customer',
            identity,
            completeWithBypass: true,
        });

        await expect(page).toHaveURL(/127\.0\.0\.1:5173/);
        await expect(page.locator('body')).toContainText(/Available PGs|Explore|Results/i);
    });

    test('AUTH-02 customer login rejects invalid credentials without creating a session', async ({ page, adminHelper, login }) => {
        await adminHelper.createTestUser(TEST_USERS.customer.email, TEST_USERS.customer.password, 'customer');
        await login({
            role: 'customer',
            email: TEST_USERS.customer.email,
            password: 'not-the-right-password',
            mode: 'ui',
        }).catch(() => undefined);

        await expect(page).toHaveURL(/\/login/);
        await expect(page.locator('body')).toContainText(/Invalid|Failed|password/i);
    });

    test('AUTH-03 customer sessions persist across reloads and protected navigation', async ({ page, login, customerApp }) => {
        await login({ role: 'customer' });
        await customerApp.openBookings();
        await expect(page).toHaveURL(/\/bookings/);
        await expect(page.locator('.rfm-bookings-page')).toBeVisible();

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/bookings/);
        await expect(page.locator('.rfm-bookings-page')).toBeVisible();
    });

    test('AUTH-04 customer logout clears the local session and returns the app to a public state', async ({ page, adminHelper, login, logout, customerApp }) => {
        await adminHelper.createTestUser(TEST_USERS.customer.email, TEST_USERS.customer.password, 'customer');
        await login({ role: 'customer', mode: 'ui' });
        await logout({ role: 'customer' });

        await page.waitForLoadState('domcontentloaded');
        await expect.poll(async () => {
            try {
                return await page.evaluate(() => {
                    return Object.keys(window.localStorage)
                        .filter((key) => key.includes('auth-token'))
                        .map((key) => window.localStorage.getItem(key))
                        .filter(Boolean)
                        .length;
                });
            } catch {
                return Number.NaN;
            }
        }).toBe(0);

        await customerApp.openHome();
        await expect(page.locator('body')).toContainText(/Available PGs|Explore|Results/i);
    });

    test('AUTH-05 owner and admin accounts can establish independent authenticated sessions', async ({ browser, login }) => {
        const ownerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const adminContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const ownerPage = await ownerContext.newPage();
        const adminPage = await adminContext.newPage();

        try {
            await loginHelper(ownerPage, { role: 'owner', mode: 'ui' });
            await ownerPage.waitForURL(/\/dashboard/, { timeout: 15000 });
            await expect(ownerPage.getByText(/Dashboard/i).first()).toBeVisible();

            await loginHelper(adminPage, { role: 'admin', mode: 'ui' });
            await adminPage.waitForURL(/\/dashboard/, { timeout: 15000 });
            await expect(adminPage.getByText(/Admin Dashboard/i)).toBeVisible();
        } finally {
            await ownerContext.close().catch(() => undefined);
            await adminContext.close().catch(() => undefined);
        }
    });
});
