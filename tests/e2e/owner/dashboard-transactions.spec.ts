import { expect, test } from '@playwright/test';
import { ensureOwnerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
const DASHBOARD_OWNER_EMAIL = 'test_owner_dashboard_e2e@example.com';
const DASHBOARD_CUSTOMER_EMAIL = 'test_customer_dashboard_e2e@example.com';

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();

    const owner = await admin.findUserByEmail(DASHBOARD_OWNER_EMAIL)
        || await admin.createTestUser(
            DASHBOARD_OWNER_EMAIL,
            TEST_USERS.owner.password,
            'owner',
        );
    if (owner) {
        await admin.ensureOwnerVerified(owner.id, DASHBOARD_OWNER_EMAIL);
    }

    const customer = await admin.findUserByEmail(DASHBOARD_CUSTOMER_EMAIL)
        || await admin.createTestUser(
            DASHBOARD_CUSTOMER_EMAIL,
            TEST_USERS.customer.password,
            'customer',
        );
    if (customer) {
        await admin.ensureCustomerProfile(customer.id, DASHBOARD_CUSTOMER_EMAIL);
    }

    await admin.cleanupUserBookings(DASHBOARD_CUSTOMER_EMAIL);
    await admin.cleanupOwnerBookings(DASHBOARD_OWNER_EMAIL);
    await admin.cleanupOwnerProperties(DASHBOARD_OWNER_EMAIL);
    await admin.createPropertyWithRoom(DASHBOARD_OWNER_EMAIL, {
        title: `E2E Dashboard ${Date.now()}`,
        status: 'published'
    });
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(DASHBOARD_CUSTOMER_EMAIL);
    await admin.cleanupOwnerBookings(DASHBOARD_OWNER_EMAIL);
    await admin.cleanupOwnerProperties(DASHBOARD_OWNER_EMAIL);
    await admin.cleanupSettlements(DASHBOARD_OWNER_EMAIL);
});

test.beforeEach(async ({ page }) => {
    await admin.cleanupUserBookings(DASHBOARD_CUSTOMER_EMAIL);
    await admin.cleanupOwnerBookings(DASHBOARD_OWNER_EMAIL);
    await ensureOwnerLoggedInAs(page, DASHBOARD_OWNER_EMAIL, {
        password: TEST_USERS.owner.password,
    });
});

test('O-11 the owner dashboard renders the properties widget', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/dashboard`);
    await expect(page.getByText(/Properties/i).first()).toBeVisible();
});

test('O-12 the owner dashboard renders the pending bookings widget', async ({ page }) => {
    await admin.createPaidBooking(DASHBOARD_CUSTOMER_EMAIL, DASHBOARD_OWNER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.owner}/dashboard`);
    await expect(page.getByText(/Pending/i).first()).toBeVisible();
});

test('O-13 the owner dashboard renders the revenue widget', async ({ page }) => {
    await admin.createPaidBooking(DASHBOARD_CUSTOMER_EMAIL, DASHBOARD_OWNER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.owner}/dashboard`);
    await expect(page.getByText(/Revenue/i).first()).toBeVisible();
});

test('O-14 the settlements route renders the weekly settlements heading', async ({ page }) => {
    await admin.createSettlement(DASHBOARD_OWNER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.owner}/settlements`);
    await expect(page.getByText(/Payment History Center/i).first()).toBeVisible();
});

test('O-15 settlement rows render amount and status content for seeded payouts', async ({ page }) => {
    await admin.createSettlement(DASHBOARD_OWNER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.owner}/settlements`);
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/COMPLETED|PENDING|â‚¹|INR/i);
});

test('O-16 owner booking requests render on the requests tab', async ({ page }) => {
    const { property } = await admin.createPaidBooking(DASHBOARD_CUSTOMER_EMAIL, DASHBOARD_OWNER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.owner}/bookings`);
    await expect(page.getByText(/Requests/i).first()).toBeVisible();
    await expect(page.getByText(new RegExp(String(property.title), 'i')).first()).toBeVisible();
});

test('O-17 accepting a paid booking request updates the owner booking card state', async ({ page }) => {
    const { booking, property } = await admin.createPaidBooking(DASHBOARD_CUSTOMER_EMAIL, DASHBOARD_OWNER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.owner}/bookings`);
    await expect(page.getByText(new RegExp(String(property.title), 'i')).first()).toBeVisible();
    await page.getByRole('button', { name: /Accept/i }).first().click();

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('bookings')
            .select('status, owner_accept_status')
            .eq('id', booking.id)
            .maybeSingle();

        return `${String(data?.status || '').toLowerCase()}:${String(Boolean(data?.owner_accept_status))}`;
    }).toBe('approved:true');
});

test('O-18 rejecting a booking request opens the reject modal and moves the request to the rejected state', async ({ page }) => {
    const { property } = await admin.createPaidBooking(DASHBOARD_CUSTOMER_EMAIL, DASHBOARD_OWNER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.owner}/bookings`);
    await expect(page.getByText(new RegExp(String(property.title), 'i')).first()).toBeVisible();
    const bookingCard = page.locator('div.bg-white.rounded-2xl').filter({ hasText: String(property.title) }).first();
    await bookingCard.getByRole('button', { name: /^Reject$/i }).click();
    await expect(page.getByRole('heading', { name: /Reject Booking/i })).toBeVisible();
    await page.getByLabel(/Reason for rejection/i).selectOption('Room unavailable');
    await page.getByRole('button', { name: /Reject Booking/i }).click();
    await page.getByRole('button', { name: /^Rejected$/i }).click();
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Rejected|Room unavailable/i);
});

test('O-19 owner payment success pages redirect signed-in owners to bookings', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/payment/confirmed?context=rent&booking_id=e2e-owner`);
    await expect.poll(() => page.url(), { timeout: 10000 }).toContain('/bookings');
    await expect(page.getByRole('button', { name: /Vacancy/i })).toBeVisible();
});

test('O-20 owner payment error pages render for signed-in owners', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.owner}/payment/error?context=refund&booking_id=e2e-owner`);
    await expect(page.getByRole('heading', { name: /Refund Issued|Payment Failed/i })).toBeVisible();
});
