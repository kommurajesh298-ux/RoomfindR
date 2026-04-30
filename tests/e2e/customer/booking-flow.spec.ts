import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute, primeAppStorage } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

const blankStorageState = { cookies: [], origins: [] };

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;

const seedPublishedProperty = async () => {
    const { property } = await admin.createPropertyWithRoom(TEST_USERS.owner.email, {
        title: `E2E Booking ${Date.now()}`,
        status: 'published',
        monthlyRent: 7200,
        roomPrice: 7200
    });

    return String(property.id);
};

const seedCheckedInBooking = async () => {
    const { booking, property } = await admin.createPaidBooking(TEST_USERS.customer.email, TEST_USERS.owner.email);
    await admin.supabase
        .from('bookings')
        .update({ status: 'checked-in', payment_status: 'paid' })
        .eq('id', booking.id);
    return { bookingId: String(booking.id), propertyTitle: String(property.title) };
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    await admin.cleanupUserBookings(TEST_USERS.customer.email);
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(TEST_USERS.customer.email);
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
});

test.describe('authenticated booking flows', () => {
    test.beforeEach(async ({ page }) => {
        await admin.cleanupUserBookings(TEST_USERS.customer.email);
        await ensureCustomerLoggedIn(page);
    });

    test('C-11 the property page renders the reserve CTA for signed-in customers', async ({ page }) => {
        const propertyId = await seedPublishedProperty();
        await gotoAppRoute(page, `${BASE_URLS.customer}/property/${propertyId}`);
        await expect(page.getByRole('button', { name: /Reserve a Room|Reserve Now|Join Waitlist|Sold Out/i }).first()).toBeVisible();
    });

    test('C-12 reserving a room opens the booking confirmation surface', async ({ page }) => {
        const propertyId = await seedPublishedProperty();
        await gotoAppRoute(page, `${BASE_URLS.customer}/property/${propertyId}`);
        await page.getByRole('button', { name: /Reserve a Room|Reserve Now/i }).first().click();
        await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/Continue to Payment|Book Your Stay|Confirm/i);
    });

    test('C-14 a pending booking opens the booking payment summary screen', async ({ page }) => {
        const booking = await admin.createPendingBooking(TEST_USERS.customer.email);
        await gotoAppRoute(page, `${BASE_URLS.customer}/payment?bookingId=${booking.id}`);
        await expect(page.getByText(/Booking Summary/i)).toBeVisible();
        await expect(page.getByText(/Price Breakdown/i)).toBeVisible();
        await expect(page.getByText(/Room Charges|Advance Booking|Monthly Rent/i)).toBeVisible();
    });

    test('C-15 pending booking rows remain in payment_pending status in the database', async () => {
        await admin.createPendingBooking(TEST_USERS.customer.email);
        const booking = await admin.getLatestBookingForEmail(TEST_USERS.customer.email);
        expect(booking?.status).toBe('payment_pending');
    });

    test('C-16 checked-in bookings render on the customer bookings page', async ({ page }) => {
        const seeded = await seedCheckedInBooking();
        await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
        await expect(page.locator('.rfm-booking-card').first()).toBeVisible();
        await expect(page.getByText(new RegExp(seeded.propertyTitle, 'i')).first()).toBeVisible();
    });

    test('C-17 booking cards render a visible normalized status chip', async ({ page }) => {
        await seedCheckedInBooking();
        await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
        await expect(page.locator('.rfm-booking-card').first()).toContainText(/checked in|checked-in|approved|requested/i);
    });

    test('C-18 checked-in bookings show the vacate action', async ({ page }) => {
        await seedCheckedInBooking();
        await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
        await expect(page.getByRole('button', { name: /Vacate/i }).first()).toBeVisible();
    });

    test('C-19 payment success for booking context redirects signed-in customers to bookings', async ({ page }) => {
        await gotoAppRoute(page, `${BASE_URLS.customer}/payment/confirmed?context=booking&booking_id=e2e-fake`);
        await expect.poll(() => page.url(), { timeout: 10000 }).toContain('/bookings');
        await expect(page.getByRole('button', { name: /Active/i })).toBeVisible();
    });

    test('C-20 payment failures render the booking error surface', async ({ page }) => {
        await gotoAppRoute(page, `${BASE_URLS.customer}/payment/error?context=booking`);
        await expect(page.getByRole('heading', { name: /Refund Issued|Payment Failed/i })).toBeVisible();
    });
});

test.describe('unauthenticated booking guard', () => {
    test.use({ storageState: blankStorageState });

    test.beforeEach(async () => {
        await admin.cleanupUserBookings(TEST_USERS.customer.email);
    });

    test('C-13 reserve actions redirect unauthenticated users to login', async ({ page }) => {
        const propertyId = await seedPublishedProperty();
        await primeAppStorage(page, 'customer');
        await gotoAppRoute(page, `${BASE_URLS.customer}/property/${propertyId}`);
        await page.getByRole('button', { name: /Reserve a Room|Reserve Now/i }).first().click();
        await expect.poll(() => page.url(), { timeout: 10000 }).toContain('/login');
    });
});
