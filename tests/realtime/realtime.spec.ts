import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedInAs, ensureOwnerLoggedInAs } from '../helpers/auth-session';
import { gotoAppRoute } from '../helpers/app-shell';
import { BASE_URLS } from '../helpers/e2e-config';
import { createTestIdentity } from '../data/test-users';
import { cleanupIdentity, ensureTestIdentity, getAdminHelper } from '../utils/apiHelper';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);

const customer = createTestIdentity('system-realtime', 'customer');
const owner = createTestIdentity('system-realtime', 'owner');

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

test('REALTIMESYS-01 booking status badge updates live on the customer surface after backend changes', async ({ page }) => {
    const admin = getAdminHelper();
    await admin.cleanupUserBookings(customer.email);
    await ensureCustomerLoggedInAs(page, customer.email, { password: customer.password });

    const seeded = await admin.createPaidBooking(customer.email, owner.email);
    await admin.supabase
        .from('bookings')
        .update({ status: 'approved', payment_status: 'paid' })
        .eq('id', seeded.booking.id);

    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    const bookingCard = page.locator('.rfm-booking-card').filter({ hasText: String(seeded.property.title) }).first();
    await expect(bookingCard).toBeVisible();

    await admin.supabase
        .from('bookings')
        .update({ status: 'confirmed' })
        .eq('id', seeded.booking.id);

    await expect.poll(async () => ((await bookingCard.textContent()) || '').toLowerCase(), {
        timeout: 15000,
    }).toContain('confirmed');
});

test('REALTIMESYS-02 newly inserted paid bookings surface on the owner dashboard without a manual re-login', async ({ page }) => {
    const admin = getAdminHelper();
    await admin.cleanupUserBookings(customer.email);
    await admin.cleanupOwnerBookings(owner.email);
    await ensureOwnerLoggedInAs(page, owner.email, { password: owner.password });
    await gotoAppRoute(page, `${BASE_URLS.owner}/dashboard`);

    await admin.createPaidBooking(customer.email, owner.email);

    await expect.poll(async () => ((await page.locator('body').textContent()) || '').toLowerCase(), {
        timeout: 15000,
    }).toMatch(/pending booking|accept all|booking request|new booking/);
});
