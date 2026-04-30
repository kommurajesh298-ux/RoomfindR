import { expect, test } from '@playwright/test';
import { createTestIdentity } from '../data/test-users';
import { cleanupIdentity, ensureTestIdentity, getAdminHelper } from '../utils/apiHelper';
import { createSystemPaymentHelper, MOBILE_UPI_APPS, openMobilePaymentPage } from '../utils/paymentHelper';

test.describe.configure({ mode: 'serial' });

const customer = createTestIdentity('system-upi', 'customer');

test.beforeAll(async () => {
    await cleanupIdentity(customer).catch(() => undefined);
    await ensureTestIdentity(customer);
});

test.afterAll(async () => {
    await cleanupIdentity(customer);
});

test('PAYSYS-UPI-01 mobile UPI options render with valid app return targets and backend confirmation clears pending state', async ({ browser }) => {
    const admin = getAdminHelper();
    const payments = createSystemPaymentHelper();
    await admin.cleanupUserBookings(customer.email);
    const booking = await admin.createPendingBooking(customer.email);

    const { context, page } = await openMobilePaymentPage(browser, {
        bookingId: String(booking.id),
        customerEmail: customer.email,
        password: customer.password,
    });

    try {
        await expect(page.getByText(/Booking Summary|Total Payable|Total Due/i).first()).toBeVisible();

        const returnApps = payments.buildReturnApps();
        expect(returnApps.customer).toBe('roomfinder://app');
        expect(returnApps.owner).toBe('com.roomfindr.owner://app');

        await payments.markLatestPaymentPaid(String(booking.id), String(booking.customer_id));
        const statusToken = payments.createStatusToken(String(booking.id));
        await page.goto(
            `http://127.0.0.1:5173/payment-status?booking_id=${booking.id}&app=customer&status_token=${encodeURIComponent(statusToken)}`,
            { waitUntil: 'domcontentloaded' },
        );

        await expect.poll(() => page.url(), { timeout: 15000 }).toContain('/bookings');
        const updatedBooking = await admin.getBookingById(String(booking.id));
        expect(updatedBooking?.payment_status).toBe('paid');
    } finally {
        await context.close().catch(() => undefined);
    }
});
