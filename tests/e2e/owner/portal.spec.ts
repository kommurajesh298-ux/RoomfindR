import { expect, test } from '@playwright/test';
import { ensureOwnerLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';

test.setTimeout(300000);

test.beforeEach(async ({ page }) => {
    await ensureOwnerLoggedIn(page);
});

test('owner management routes render their primary views', async ({ page }) => {
    const routes = [
        { path: '/dashboard', text: /Dashboard/i },
        { path: '/properties', text: /My Properties/i },
        { path: '/bookings', text: /Vacancy/i },
        { path: '/settlements', text: /Payment History Center|No Payment History Yet/i },
        { path: '/chat', text: /Support & Notices|No Properties Found/i },
        { path: '/profile', text: /My Profile/i }
    ];

    for (const route of routes) {
        await test.step(`owner route ${route.path} loads`, async () => {
            await gotoAppRoute(page, `${BASE_URLS.owner}${route.path}`);
            await expect(page.getByText(route.text).first()).toBeVisible();
        });
    }
});

test('owner payment outcome pages render for signed-in users', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/payment/confirmed?context=rent&booking_id=e2e-booking`);
    await expect.poll(() => page.url(), { timeout: 10000 }).toContain('/bookings');
    await expect(page.getByRole('button', { name: /Vacancy/i })).toBeVisible();

    await gotoAppRoute(page, `${BASE_URLS.owner}/payment/error?context=refund&booking_id=e2e-booking`);
    await expect(page.getByRole('heading', { name: /Refund Issued/i })).toBeVisible();
});
