import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedInAs } from '../helpers/auth-session';
import { gotoAppRoute } from '../helpers/app-shell';
import { BASE_URLS } from '../helpers/e2e-config';
import { createTestIdentity } from '../data/test-users';
import { cleanupIdentity, ensureTestIdentity, getAdminHelper } from '../utils/apiHelper';
import { createSystemPaymentHelper } from '../utils/paymentHelper';

test.describe.configure({ mode: 'serial' });

const customer = createTestIdentity('system-qr', 'customer');

test.beforeAll(async () => {
    await cleanupIdentity(customer).catch(() => undefined);
    await ensureTestIdentity(customer);
});

test.afterAll(async () => {
    await cleanupIdentity(customer);
});

test.beforeEach(async ({ page }) => {
    const admin = getAdminHelper();
    await admin.cleanupUserBookings(customer.email);
    await ensureCustomerLoggedInAs(page, customer.email, { password: customer.password });
});

test('PAYSYS-QR-01 QR checkout creates a payment session and completes through backend verification', async ({ page }) => {
    const admin = getAdminHelper();
    const payments = createSystemPaymentHelper();
    const booking = await admin.createPendingBooking(customer.email);

    await gotoAppRoute(page, `${BASE_URLS.customer}/payment?bookingId=${booking.id}`);
    await page.getByRole('button', { name: /Generate QR/i }).click();
    const refreshQrButton = page.getByRole('button', { name: /Refresh QR/i });
    await expect(refreshQrButton).toBeVisible({ timeout: 20000 });
    await expect(refreshQrButton).toBeEnabled({ timeout: 20000 });

    const paymentRow = await payments.waitForPaymentRow(String(booking.id));
    expect(String(paymentRow.booking_id)).toBe(String(booking.id));

    await payments.markLatestPaymentPaid(String(booking.id), String(booking.customer_id));
    const statusToken = payments.createStatusToken(String(booking.id));

    await gotoAppRoute(
        page,
        `${BASE_URLS.customer}/payment-status?booking_id=${booking.id}&app=customer&status_token=${encodeURIComponent(statusToken)}`,
    );

    await expect.poll(() => page.url(), { timeout: 15000 }).toContain('/bookings');
    await expect(page.getByRole('button', { name: /Active/i })).toBeVisible();
    await expect.poll(
        async () => (await admin.getBookingById(String(booking.id)))?.payment_status || null,
        { timeout: 15000, intervals: [500, 1000, 2000] }
    ).toBe('paid');
});
