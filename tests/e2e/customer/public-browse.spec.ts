import { expect, test } from '@playwright/test';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';
import { gotoAppRoute, primeAppStorage } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';

let publicPropertyId = '';
let publicPropertyTitle = '';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    const admin = new SupabaseAdminHelper();
    const owner = await admin.createTestUser(TEST_USERS.owner.email, TEST_USERS.owner.password, 'owner');
    if (!owner) {
        throw new Error('Unable to create or load the owner test user.');
    }

    await admin.ensureOwnerProfile(owner.id, TEST_USERS.owner.email);
});

test.beforeEach(async ({ page }) => {
    await primeAppStorage(page, 'customer');
});

test('home page renders the browse shell', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.customer}/`);
    await expect(page.locator('input[placeholder*="Search"]:visible')).toBeVisible();
    await expect(page.getByText(/Available PGs & Hostels/i)).toBeVisible();
});

test('query parameters drive the customer search state', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.customer}/?search=Koramangala`);
    await expect(page).toHaveURL(/search=Koramangala/i);
    await expect(page.locator('body')).toContainText(/No properties found|Clear Filters|Results for/i);
});

test('a published property details route is reachable publicly', async ({ page }) => {
    const admin = new SupabaseAdminHelper();
    const { property } = await admin.createPropertyWithRoom(TEST_USERS.owner.email, {
        title: `E2E Public Listing ${Date.now()}`,
        city: 'Bengaluru',
        state: 'Karnataka',
        status: 'published'
    });

    publicPropertyId = String(property.id);
    publicPropertyTitle = String(property.title);

    await gotoAppRoute(page, `${BASE_URLS.customer}/property/${publicPropertyId}`);
    await expect(page.getByRole('heading', { name: publicPropertyTitle })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reserve a Room|Join Waitlist|Reserve Now|Sold Out/i })).toBeVisible();
});
