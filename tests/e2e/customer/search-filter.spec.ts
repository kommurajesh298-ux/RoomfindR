import { expect, test, type Page } from '@playwright/test';
import { gotoAppRoute, primeAppStorage } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

const blankStorageState = { cookies: [], origins: [] };

test.use({ storageState: blankStorageState });
test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;

const openCustomerRoute = async (page: Page, path: string) => {
    await primeAppStorage(page, 'customer');
    await gotoAppRoute(page, `${BASE_URLS.customer}${path}`);
};

const expectListingSurface = async (page: Page) => {
    await expect(page.locator('.rfm-listing-section').first()).toBeVisible();
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
    await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `E2E Search Girls ${Date.now()}`,
        status: 'published',
        monthlyRent: 6500,
        tags: ['Girls']
    });
    await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `E2E Search Boys ${Date.now()}`,
        status: 'published',
        monthlyRent: 6200,
        tags: ['Boys']
    });
    await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `E2E Search Hostel ${Date.now()}`,
        status: 'published',
        monthlyRent: 5800,
        tags: ['Hostel']
    });
});

test.afterAll(async () => {
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
});

test('C-01 search query text renders in the customer results header', async ({ page }) => {
    await openCustomerRoute(page, '/?search=Koramangala');
    await expect(page.getByText('Results for "Koramangala"')).toBeVisible();
});

for (const [caseId, query] of [
    ['C-02', '/?tags=girls'],
    ['C-03', '/?tags=boys'],
    ['C-04', '/?tags=hostel'],
    ['C-05', '/?minPrice=3000&maxPrice=8000'],
    ['C-06', '/?sortBy=price-low']
] as const) {
    test(`${caseId} customer browse filters render the listing surface for ${query}`, async ({ page }) => {
        await openCustomerRoute(page, query);
        await expectListingSurface(page);
        await expect(page.getByText(/No properties found/i)).toBeHidden();
    });
}

test('C-07 the home hero filter button opens the filter panel', async ({ page }) => {
    await openCustomerRoute(page, '/');
    await page.getByRole('button', { name: /Open filters/i }).first().click();
    await expect(page.getByRole('heading', { name: /Filters/i })).toBeVisible();
});

test('C-08 applying filters from the filter panel updates the customer URL params', async ({ page }) => {
    await openCustomerRoute(page, '/');
    await page.getByRole('button', { name: /Open filters/i }).first().click();
    await expect(page.getByRole('heading', { name: /Filters/i })).toBeVisible();

    await page.getByRole('button', { name: /Girls PG/i }).click();
    await page.locator('#min-price').fill('3500');
    await page.locator('#max-price').fill('9500');
    await page.getByRole('button', { name: /Show Results/i }).click();

    await expect.poll(() => page.url()).toContain('minPrice=3500');
    await expect.poll(() => page.url()).toContain('maxPrice=9500');
    await expect.poll(() => page.url()).toMatch(/tags=.*Girls/i);
});

test('C-09 the explore route is reachable publicly', async ({ page }) => {
    await openCustomerRoute(page, '/explore');
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Explore|No properties found|Available PGs|Eligible Properties|No properties match this offer/i);
});

test('C-10 a no-match search shows the empty state', async ({ page }) => {
    await openCustomerRoute(page, '/?search=xyzNotExistingPropertyABC123');
    await expect(page.getByText(/No properties found/i)).toBeVisible();
});
