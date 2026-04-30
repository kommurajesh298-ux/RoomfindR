import { expect, test } from '@playwright/test';
import { ensureOwnerLoggedInAs } from '../helpers/auth-session';
import { createTestIdentity } from '../data/test-users';
import { createSystemBookingHelper } from '../utils/bookingHelper';
import { cleanupIdentity, ensureTestIdentity, getAdminHelper } from '../utils/apiHelper';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

const customer = createTestIdentity('system-booking-reject', 'customer');
const owner = createTestIdentity('system-booking-reject', 'owner');

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

test('BOOKSYS-REJ-01 paid bookings move into rejection flow and create a refund review row', async ({ page }) => {
    const admin = getAdminHelper();
    const bookingHelper = createSystemBookingHelper();
    await admin.cleanupUserBookings(customer.email);
    await admin.cleanupOwnerBookings(owner.email);
    await ensureOwnerLoggedInAs(page, owner.email, { password: owner.password });

    const seeded = await admin.createPaidBooking(customer.email, owner.email);
    await bookingHelper.rejectOwnerBooking(page, String(seeded.property.title), String(seeded.booking.id));

    await expect.poll(async () => {
        const refund = await admin.getRefundForBooking(String(seeded.booking.id));
        return String(refund?.refund_status || refund?.status || '').toUpperCase();
    }, {
        timeout: 30000,
    }).toBe('PENDING');
});
