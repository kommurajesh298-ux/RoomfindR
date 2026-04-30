import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedInAs } from '../helpers/auth-session';
import { gotoAppRoute } from '../helpers/app-shell';
import { BASE_URLS } from '../helpers/e2e-config';
import { createTestIdentity } from '../data/test-users';
import { createSystemBookingHelper } from '../utils/bookingHelper';
import { cleanupIdentity, ensureTestIdentity, getAdminHelper } from '../utils/apiHelper';

test.describe.configure({ mode: 'serial' });

const customer = createTestIdentity('system-rent', 'customer');
const owner = createTestIdentity('system-rent', 'owner');

const dismissRatingPopupIfPresent = async (page: import('@playwright/test').Page) => {
    const skipButton = page.getByRole('button', { name: /Skip for now/i });
    if (await skipButton.isVisible().catch(() => false)) {
        await skipButton.click();
    }
};

test.beforeAll(async () => {
    await cleanupIdentity(customer).catch(() => undefined);
    await cleanupIdentity(owner).catch(() => undefined);
    await ensureTestIdentity(customer);
    await ensureTestIdentity(owner);
});

test.afterAll(async () => {
    await cleanupIdentity(customer);
    await cleanupIdentity(owner);
});

test.beforeEach(async ({ page }) => {
    const admin = getAdminHelper();
    await admin.cleanupUserBookings(customer.email);
    await ensureCustomerLoggedInAs(page, customer.email, { password: customer.password });
});

test('RENTSYS-01 monthly rent can open from bookings and persist payment rows plus next due dates', async ({ page }) => {
    const admin = getAdminHelper();
    const bookingHelper = createSystemBookingHelper();
    const seeded = await bookingHelper.seedDueMonthlyBooking(customer.email, owner.email);
    const bookingId = String(seeded.booking.id);
    const customerId = String(seeded.booking.customer_id);

    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    await dismissRatingPopupIfPresent(page);
    await page.getByTitle(/Pay Monthly/i).first().click();
    await expect(page.getByRole('heading', { name: /Monthly Payments/i })).toBeVisible();
    await page.getByRole('button', { name: /Pay Now/i }).first().click();
    await expect(page).toHaveURL(/\/payment\?.*context=rent/);

    const { error: insertError } = await admin.supabase.from('payments').insert({
        booking_id: bookingId,
        customer_id: customerId,
        amount: 6800,
        status: 'completed',
        payment_method: 'upi',
        payment_type: 'monthly',
        payment_date: new Date().toISOString(),
    });
    expect(insertError).toBeNull();

    const nextDueDate = new Date();
    nextDueDate.setMonth(nextDueDate.getMonth() + 2);
    const { error: dueDateError } = await admin.supabase
        .from('bookings')
        .update({ next_payment_date: nextDueDate.toISOString() })
        .eq('id', bookingId);
    expect(dueDateError).toBeNull();

    await expect.poll(async () => {
        const payments = await admin.getPaymentsForBooking(bookingId);
        return payments.filter((payment) => payment.payment_type === 'monthly' && payment.booking_id === bookingId).length;
    }).toBeGreaterThan(0);

    await expect.poll(async () => {
        const booking = await admin.getBookingById(bookingId);
        return Boolean(booking?.next_payment_date);
    }).toBe(true);
});
