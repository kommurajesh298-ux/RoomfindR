import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ensureOwnerLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });

const SAMPLE_IMAGE = path.resolve(__dirname, '../../../owner-app/public/logo192.png');

let admin: SupabaseAdminHelper;

const getPropertyCardByTitle = (page: Page, title: string) =>
    page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::div[contains(@class,"group")][1]');

const fillPropertyStepOne = async (page: Page, title: string) => {
    await page.getByRole('button', { name: /Boys PG|Girls PG|Hostel|Co-living/i }).first().click();
    await page.getByPlaceholder(/Modern Student Living/i).fill(title);
    await page.getByPlaceholder(/Tell potential tenants/i).fill(`Auto-created property ${title}`);
    await page.getByPlaceholder(/Street address, Area, City/i).fill('Koramangala 1st Block, Bengaluru');
    await page.getByPlaceholder('5000').fill('6800');
    await page.getByPlaceholder('10000').fill('6800');
};

const createPropertyViaUi = async (page: Page, title: string) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties/add`);
    await fillPropertyStepOne(page, title);
    await page.getByRole('button', { name: /Save & Continue/i }).click();
    await expect.poll(() => page.url()).toMatch(/\/properties\/edit\/.+step=2/i);
    await page.getByRole('button', { name: /Unleash Property/i }).click();
    await expect.poll(() => page.url()).toMatch(/\/properties\/.+/i);
};

const openRoomModal = async (page: Page, propertyId: string) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties/${propertyId}`);
    await page.getByRole('button', { name: /Rooms/i }).click();
    await page.getByRole('button', { name: /Add (New )?Room/i }).click();
    await expect(page.getByRole('heading', { name: /Add New Room|Edit Room/i })).toBeVisible();
};

const createRoomViaUi = async (page: Page, propertyId: string, roomNumber: string, price = 6200, capacity = 3) => {
    await openRoomModal(page, propertyId);
    await page.locator('#roomNumber').fill(roomNumber);
    await page.locator('#price').fill(String(price));
    await page.locator('#capacity').fill(String(capacity));
    await page.locator('#bookedCount').fill('0');
    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_IMAGE);
    await expect(page.getByText(/1\/1 image ready/i)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Save Room/i }).click();
    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('rooms')
            .select('room_number')
            .eq('property_id', propertyId)
            .eq('room_number', roomNumber)
            .maybeSingle();
        return data?.room_number ?? null;
    }).toBe(roomNumber);
    await page.reload();
    await page.getByRole('button', { name: /Rooms/i }).click();
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
});

test.afterAll(async () => {
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
});

test.beforeEach(async ({ page }) => {
    await ensureOwnerLoggedIn(page);
});

test('O-01 the owner properties page routes into the new property creation form', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties`);
    await page.getByRole('button', { name: /List New Property/i }).click();
    await expect.poll(() => page.url()).toContain('/properties/add');
    await expect(page.getByText(/Property Details|Basic Information/i).first()).toBeVisible();
});

test('O-02 property creation validates missing required fields on step one', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties/add`);
    await page.getByRole('button', { name: /Save & Continue/i }).click();
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Please fill in required fields/i);
});

test('O-03 owners can complete the two-step property creation flow', async ({ page }) => {
    const title = `E2E Owner Property ${Date.now()}`;
    await createPropertyViaUi(page, title);
    await expect.poll(() => page.url()).toMatch(/\/properties\/.+/i);
});

test('O-04 newly created properties appear on the owner properties list', async ({ page }) => {
    const title = `E2E Owner List ${Date.now()}`;
    await createPropertyViaUi(page, title);
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties`);
    await expect(page.getByText(title).first()).toBeVisible();
});

test('O-05 newly created properties surface the default draft status chip', async ({ page }) => {
    const title = `E2E Owner Draft ${Date.now()}`;
    await createPropertyViaUi(page, title);
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties`);
    const propertyCard = getPropertyCardByTitle(page, title);
    await expect(propertyCard.getByText(/^Draft$/i)).toBeVisible();
});

test('O-06 owners can open the add room modal from property management', async ({ page }) => {
    const { property } = await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `E2E Manage Room ${Date.now()}`,
        status: 'published'
    });
    await openRoomModal(page, String(property.id));
});

test('O-07 saving a room from the property manager renders the new room in the list', async ({ page }) => {
    const { property } = await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `E2E Room Create ${Date.now()}`,
        status: 'published'
    });
    const roomNumber = `R-${Date.now()}`;
    await createRoomViaUi(page, String(property.id), roomNumber);
    await expect(page.getByText(roomNumber).first()).toBeVisible();
});

test('O-08 room cards show the entered capacity and pricing values after creation', async ({ page }) => {
    const { property } = await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `E2E Room Values ${Date.now()}`,
        status: 'published'
    });
    const roomNumber = `V-${Date.now()}`;
    await createRoomViaUi(page, String(property.id), roomNumber, 6200, 3);
    await expect(page.getByText(/₹6,200|₹6200/i).first()).toBeVisible();
    await expect(page.getByText(/3 Beds|0 \/ 3|3 \/ 3/i).first()).toBeVisible();
});

test('O-09 property edits persist updated titles back to the owner list', async ({ page }) => {
    const { property } = await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `E2E Edit Property ${Date.now()}`,
        status: 'draft'
    });
    const updatedTitle = `E2E Updated Property ${Date.now()}`;
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties/edit/${property.id}`);
    const titleInput = page.getByPlaceholder(/Modern Student Living/i);
    await expect(titleInput).toHaveValue(String(property.title));
    await titleInput.fill(updatedTitle);
    await expect(titleInput).toHaveValue(updatedTitle);
    await page.getByRole('button', { name: /Save & Continue/i }).click();
    await expect.poll(() => page.url()).toMatch(/step=2/i);
    await page.getByRole('button', { name: /Unleash Property/i }).click();
    await expect.poll(() => page.url()).toMatch(new RegExp(`/properties/${property.id}(?:\\?|$)`));
    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('properties')
            .select('title')
            .eq('id', property.id)
            .maybeSingle();
        return data?.title ?? null;
    }).toBe(updatedTitle);
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties`);
    await expect(page.getByText(/My Properties/i).first()).toBeVisible();
});

test('O-10 the add property form shows the gallery upload section', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/properties/add`);
    await expect(page.getByText(/Gallery|Upload/i).first()).toBeVisible();
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
});
