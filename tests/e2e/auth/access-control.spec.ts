import { expect, test, type Page } from '@playwright/test';
import { gotoAppRoute, primeAppStorage } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';

const expectLoginRedirect = async (page: Page, expectedLoginBase: string) => {
    await expect.poll(
        async () => {
            const url = page.url();
            const loginVisible = await page.getByLabel(/Email/i).first().isVisible().catch(() => false);
            return url.includes('/login') || loginVisible ? url : '';
        },
        { timeout: 15000 }
    ).toContain('/login');

    if (page.url().includes('/login')) {
        expect(page.url().startsWith(expectedLoginBase)).toBeTruthy();
    }
};

test.describe('route guards', () => {
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

    test('customer protected routes redirect unauthenticated users to login', async ({ page }) => {
        await primeAppStorage(page, 'customer');

        for (const path of ['/bookings', '/profile', '/chat', '/payment']) {
            await test.step(`customer ${path} redirects to login`, async () => {
                await gotoAppRoute(page, `${BASE_URLS.customer}${path}`);
                await expectLoginRedirect(page, `${BASE_URLS.customer}/login`);
                await expect(page.getByLabel('Email')).toBeVisible();
            });
        }
    });

    test('owner protected routes redirect unauthenticated users to login', async ({ page }) => {
        for (const path of ['/dashboard', '/properties', '/bookings', '/settlements', '/chat', '/profile']) {
            await test.step(`owner ${path} redirects to login`, async () => {
                await gotoAppRoute(page, `${BASE_URLS.owner}${path}`);
                await expectLoginRedirect(page, `${BASE_URLS.owner}/login`);
                await expect(page.getByLabel('Email')).toBeVisible();
            });
        }
    });

    test('admin protected routes redirect unauthenticated users to login', async ({ page }) => {
        for (const path of ['/dashboard', '/owners', '/bookings', '/refunds', '/settings']) {
            await test.step(`admin ${path} redirects to login`, async () => {
                await gotoAppRoute(page, `${BASE_URLS.admin}${path}`);
                await expectLoginRedirect(page, `${BASE_URLS.admin}/login`);
                await expect(page.getByRole('button', { name: /Enter Admin Console/i })).toBeVisible();
            });
        }
    });
});
