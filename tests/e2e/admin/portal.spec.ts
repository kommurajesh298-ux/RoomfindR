import { expect, test } from '@playwright/test';
import { ensureAdminLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';

test.beforeEach(async ({ page }) => {
    await ensureAdminLoggedIn(page);
});

test('admin dashboard shell renders navigation and summary content', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/dashboard`);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: /Dashboard/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Owners/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Settings/i })).toBeVisible();
    await expect(page.locator('main')).toContainText(/Total Users|Total Properties|Revenue Estimate/i);
});

test('admin command routes render their management views', async ({ page }) => {
    const routes = [
        { path: '/owners', nav: /Owners/i, text: /Owner Verification|Pending|Verified|Rejected|Search by name or email/i },
        { path: '/customers', nav: /Customers/i, text: /Customers/i },
        { path: '/properties', nav: /Properties/i, text: /Property Moderation/i },
        { path: '/property-rooms', nav: /Rooms/i, text: /Property & Rooms Management/i },
        { path: '/bookings', nav: /Bookings/i, text: /All Bookings|Admin Review|Customer/i },
        { path: '/rent', nav: /Rent/i, text: /Rent Collections/i }
    ];

    for (const route of routes) {
        await test.step(`admin route ${route.path} loads`, async () => {
            await gotoAppRoute(page, `${BASE_URLS.admin}${route.path}`);
            await expect(page).toHaveURL(new RegExp(`${route.path.replace('/', '\\/')}$`));
            await expect(page.getByRole('link', { name: route.nav })).toBeVisible();
            await expect(page.locator('main')).toContainText(route.text);
        });
    }
});

test('admin finance and operations routes render their management views', async ({ page }) => {
    const routes = [
        { path: '/settlements', text: /Advance Settlements/i },
        { path: '/refunds', text: /Refund Monitoring/i },
        { path: '/offers', text: /Offers & Promotions/i },
        { path: '/tickets', text: /Support Management/i },
        { path: '/reports', text: /Reports Management/i },
        { path: '/analytics', text: /System Analytics/i },
        { path: '/settings', text: /System Settings/i }
    ];

    for (const route of routes) {
        await test.step(`admin route ${route.path} loads`, async () => {
            await gotoAppRoute(page, `${BASE_URLS.admin}${route.path}`);
            await expect(page.getByText(route.text).first()).toBeVisible();
        });
    }
});

test('admin payment outcome pages render for signed-in users', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/payment/confirmed?context=rent&booking_id=e2e-booking`);
    await expect.poll(async () => {
        const url = page.url();
        const body = ((await page.locator('body').textContent()) || '').trim();
        return `${url}\n${body}`;
    }, { timeout: 10000 }).toMatch(/Payment Successful|Booking payment is confirmed|Redirecting to bookings|\/bookings/i);

    await gotoAppRoute(page, `${BASE_URLS.admin}/payment/error?context=refund&booking_id=e2e-booking`);
    await expect.poll(async () => {
        const body = ((await page.locator('body').textContent()) || '').trim();
        return body;
    }, { timeout: 10000 }).toMatch(/Refund Issued|Refund request has been processed|Go to Bookings/i);
});
