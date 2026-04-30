import { expect, test } from '@playwright/test';
import { ensureOwnerLoggedInAs } from '../helpers/auth-session';
import { createTestIdentity } from '../data/test-users';
import { createSystemBookingHelper } from '../utils/bookingHelper';
import { cleanupIdentity, ensureTestIdentity, getAdminHelper } from '../utils/apiHelper';
import { createSystemPaymentHelper } from '../utils/paymentHelper';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

const customer = createTestIdentity('system-settlement', 'customer');
const owner = createTestIdentity('system-settlement', 'owner');

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

test('SETSYS-01 accepted paid bookings create owner settlements with payout references', async ({ page }) => {
    const admin = getAdminHelper();
    const bookingHelper = createSystemBookingHelper();
    const paymentHelper = createSystemPaymentHelper();
    await admin.cleanupUserBookings(customer.email);
    await admin.cleanupOwnerBookings(owner.email);
    await admin.cleanupSettlements(owner.email);
    await ensureOwnerLoggedInAs(page, owner.email, { password: owner.password });

    const seeded = await admin.createPaidBooking(customer.email, owner.email);
    await bookingHelper.acceptOwnerBooking(page, String(seeded.property.title), String(seeded.booking.id));

    let settlement = (await admin.getSettlementsForOwner(owner.email)).find((entry) => entry.booking_id === seeded.booking.id) || null;
    if (!settlement) {
        await paymentHelper.triggerSettlement(String(seeded.booking.id));
    }

    await expect.poll(async () => {
        const settlements = await admin.getSettlementsForOwner(owner.email);
        settlement = settlements.find((entry) => entry.booking_id === seeded.booking.id) || null;
        if (!settlement) return '';
        return `${String(settlement.status || '').toUpperCase()}:${String(settlement.provider_transfer_id || '').trim()}`;
    }, {
        timeout: 180000,
    }).toMatch(/^(PROCESSING|COMPLETED):.+$/);
});
