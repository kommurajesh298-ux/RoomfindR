import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';

const dismissRatingPopupIfPresent = async (page: import('@playwright/test').Page) => {
    const skipButton = page.getByRole('button', { name: /Skip for now/i });
    if (await skipButton.isVisible().catch(() => false)) {
        await skipButton.click();
    }
};

test('mobile bottom navigation works for the customer app', async ({ page }) => {
    await ensureCustomerLoggedIn(page);
    await gotoAppRoute(page, `${BASE_URLS.customer}/`);
    await dismissRatingPopupIfPresent(page);

    const bottomNav = page.locator('.rfm-bottom-nav');
    await expect(bottomNav).toContainText('Home');
    await expect(bottomNav).toContainText('Bookings');
    await expect(bottomNav).toContainText(/Chat|PG Portal/i);
    await expect(bottomNav).toContainText('Profile');

    await bottomNav.locator('a').filter({ hasText: 'Bookings' }).click();
    await expect(page.getByRole('button', { name: /Active/i })).toBeVisible();
});
