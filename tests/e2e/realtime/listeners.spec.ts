import { expect, test } from '@playwright/test';
import { ensureAdminLoggedIn, ensureCustomerLoggedIn, ensureOwnerLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { expectToStayVisible } from '../../utils/wait';

test('customer realtime listeners stay mounted on bookings', async ({ page }) => {
    await ensureCustomerLoggedIn(page);
    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    const bookingsSurface = page.locator('.rfm-bookings-page');
    await expect(bookingsSurface).toBeVisible();
    await expect(bookingsSurface).toContainText(/Active|History|No Bookings Yet|Explore Now/i);
    await expectToStayVisible(bookingsSurface, { timeout: 2500, message: 'Customer bookings listener should stay mounted.' });
});

test('owner realtime listeners stay mounted on dashboard', async ({ page }) => {
    await ensureOwnerLoggedIn(page);
    await gotoAppRoute(page, `${BASE_URLS.owner}/dashboard`);
    const heading = page.getByText(/Dashboard/i).first();
    await expect(heading).toBeVisible();
    await expectToStayVisible(heading, { timeout: 2500, message: 'Owner dashboard listener should stay mounted.' });
});

test('admin realtime listeners stay mounted on dashboard', async ({ page }) => {
    await ensureAdminLoggedIn(page);
    await gotoAppRoute(page, `${BASE_URLS.admin}/dashboard`);
    const heading = page.getByText(/Admin Dashboard/i);
    await expect(heading).toBeVisible();
    await expectToStayVisible(heading, { timeout: 2500, message: 'Admin dashboard listener should stay mounted.' });
});
