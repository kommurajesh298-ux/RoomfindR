import { expect, test } from '@playwright/test';
import { gotoAppRoute, primeAppStorage } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';

test.describe('public auth screens', () => {
    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
                window.sessionStorage.clear();
            } catch {
                // Ignore guest-session reset failures in bootstrap.
            }
        });
    });

    test('customer auth routes render the expected controls', async ({ page }) => {
        await primeAppStorage(page, 'customer');

        await gotoAppRoute(page, `${BASE_URLS.customer}/login`);
        await expect(page.getByRole('heading', { name: /LOGIN/i })).toBeVisible();
        await expect(page.locator('input[type="email"]').first()).toBeVisible();
        await expect(page.locator('input[type="password"]').first()).toBeVisible();
        await expect(page.getByRole('link', { name: /Forgot password/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /SIGN UP/i })).toBeVisible();

        await gotoAppRoute(page, `${BASE_URLS.customer}/forgot-password`);
        await expect(page.getByRole('button', { name: /Send Reset Code/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /Back to LOGIN/i })).toBeVisible();

        await gotoAppRoute(page, `${BASE_URLS.customer}/reset-password`);
        await expect(page.getByLabel('Email')).toBeVisible();
        await expect(page.getByText(/Resend available in/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /Reset Password/i })).toBeDisabled();
    });

    test('owner auth routes render the expected controls', async ({ page }) => {
        await gotoAppRoute(page, `${BASE_URLS.owner}/login`);
        await expect(page.getByLabel('Email')).toBeVisible();
        await expect(page.locator('input[type="password"]').first()).toBeVisible();
        await expect(page.getByRole('link', { name: /Forgot password/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /SIGN UP/i })).toBeVisible();

        await gotoAppRoute(page, `${BASE_URLS.owner}/forgot-password`);
        await expect(page.getByRole('button', { name: /Send Reset Code/i })).toBeVisible();

        await gotoAppRoute(page, `${BASE_URLS.owner}/reset-password`);
        await expect(page.getByLabel('Email')).toBeVisible();
        await expect(page.getByText(/Resend available in/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /Reset Password/i })).toBeDisabled();
    });

    test('admin login route renders the admin-only shell', async ({ page }) => {
        await gotoAppRoute(page, `${BASE_URLS.admin}/login`);
        await expect(page.getByText(/Verified Admin Sign-In/i)).toBeVisible();
        await expect(page.locator('input[type="email"]').first()).toBeVisible();
        await expect(page.locator('input[type="password"]').first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Enter Admin Console/i })).toBeVisible();
    });
});
