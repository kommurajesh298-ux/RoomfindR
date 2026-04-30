import { expect, test, type Page } from '@playwright/test';
import { ensureLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
let propertyId = '';
let propertyTitle = '';
const OFFERS_OWNER_EMAIL = 'test_owner_offers_e2e@example.com';

const openOffersTab = async (page: Page) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties/${propertyId}`);
    const offersTab = page.locator('button').filter({ hasText: /^Offers$/i }).first();
    await expect(offersTab).toBeVisible({ timeout: 30000 });
    await offersTab.click();
    await expect(page.getByText(/Promotional Offers/i)).toBeVisible();
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    const owner = await admin.findUserByEmail(OFFERS_OWNER_EMAIL)
        || await admin.createTestUser(
            OFFERS_OWNER_EMAIL,
            'password123',
            'owner',
        );
    if (owner) {
        await admin.ensureOwnerVerified(owner.id, OFFERS_OWNER_EMAIL);
    }
    await admin.cleanupOwnerProperties(OFFERS_OWNER_EMAIL);
    const { property } = await admin.createPropertyWithRoom(OFFERS_OWNER_EMAIL, {
        title: `E2E Offer Property ${Date.now()}`,
        status: 'published',
        monthlyRent: 8500
    });
    propertyId = String(property.id);
    propertyTitle = String(property.title);
});

test.afterAll(async () => {
    await admin.cleanupOwnerProperties(OFFERS_OWNER_EMAIL);
});

test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page, {
        role: 'owner',
        email: OFFERS_OWNER_EMAIL,
        baseUrl: BASE_URLS.owner,
    });
});

test('O-27 the property offers section renders from the property manager', async ({ page }) => {
    await openOffersTab(page);
    await expect(page.getByText(/Promotional Offers/i)).toBeVisible();
});

test('O-28 the property offers tab shows the offer configuration form', async ({ page }) => {
    await openOffersTab(page);
    await expect(page.getByLabel(/Coupon Code/i)).toBeVisible();
    await expect(page.getByLabel(/Discount Value/i)).toBeVisible();
});

test('O-29 owners can save an offer and see it reflected on the property manager', async ({ page }) => {
    await openOffersTab(page);
    await page.getByLabel(/Coupon Code/i).fill('SAVE500');
    await page.getByLabel(/Discount Value/i).fill('500');
    await page.getByRole('button', { name: /Save Offer Settings/i }).click();
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/SAVE500|Offer saved/i);
});

test('O-30 saved offers surface on the public customer property page', async ({ page }) => {
    await openOffersTab(page);
    await page.getByLabel(/Coupon Code/i).fill('SAVE500');
    await page.getByLabel(/Discount Value/i).fill('500');
    await page.getByRole('button', { name: /Save Offer Settings/i }).click();

    await gotoAppRoute(page, `${BASE_URLS.customer}/property/${propertyId}`);
    await expect.poll(async () => (await page.locator('body').textContent()) || '', { timeout: 15000 }).toMatch(/Available Offers|SAVE500|OFF/i);
    await expect(page.getByRole('heading', { name: new RegExp(propertyTitle, 'i') })).toBeVisible();
});
