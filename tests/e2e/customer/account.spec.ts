import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { TEST_USERS } from '../../helpers/test-data';

test.setTimeout(240000);

test.beforeEach(async ({ page }) => {
    await ensureCustomerLoggedInAs(page, TEST_USERS.customer.email, {
        password: TEST_USERS.customer.password,
    });
});

test('customer account routes render their primary surfaces', async ({ page }) => {
    const routes = [
        {
            path: '/bookings',
            assertVisible: async () => {
                await expect(page).toHaveURL(/\/bookings(?:[/?#]|$)/);
                await expect(page.locator('.rfm-bookings-page')).toBeVisible();
                await expect(page.locator('.rfm-bookings-page')).toContainText(/History|No Bookings Yet|Explore PGs/i);
            }
        },
        {
            path: '/profile',
            assertVisible: async () => {
                await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible();
            }
        },
        {
            path: '/chat',
            assertVisible: async () => {
                await expect(page.locator('body')).toContainText(/Messages|Resident Portal|Explore PGs|My PG/i);
            }
        }
    ];

    for (const route of routes) {
        await test.step(`customer route ${route.path} loads`, async () => {
            await gotoAppRoute(page, `${BASE_URLS.customer}${route.path}`);
            await route.assertVisible();
        });
    }
});

test('customer payment outcome pages render for signed-in users', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment/confirmed?context=rent&booking_id=e2e-booking`);
    await expect.poll(() => page.url(), { timeout: 10000 }).toContain('/chat');
    await expect(page.locator('body')).toContainText(/Messages|Resident Portal|Explore PGs|My PG/i);

    await gotoAppRoute(page, `${BASE_URLS.customer}/payment/error?context=refund&booking_id=e2e-booking`);
    await expect.poll(() => page.url(), { timeout: 10000 }).toMatch(/\/payment\/error|\/bookings/);
    if (page.url().includes('/payment/error')) {
        await expect(page.getByRole('heading', { name: /Refund Issued/i })).toBeVisible();
        return;
    }

    await expect(page.locator('.rfm-bookings-page')).toBeVisible();
    await expect(page.locator('body')).toContainText(/Active|History|No Bookings Yet/i);
});
