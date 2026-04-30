import { expect, test } from '@playwright/test';
import { ensureAdminLoggedIn, ensureOwnerLoggedInAs } from '../helpers/auth-session';
import { gotoAppRoute } from '../helpers/app-shell';
import { BASE_URLS } from '../helpers/e2e-config';
import { createTestIdentity } from '../data/test-users';
import { createSystemBookingHelper } from '../utils/bookingHelper';
import { cleanupIdentity, ensureTestIdentity, getAdminHelper } from '../utils/apiHelper';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

const customer = createTestIdentity('system-refund', 'customer');
const owner = createTestIdentity('system-refund', 'owner');

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

test('REFSYS-01 owner rejection plus admin approval completes the refund lifecycle in backend truth', async ({ browser }) => {
    const admin = getAdminHelper();
    const bookingHelper = createSystemBookingHelper();
    await admin.cleanupUserBookings(customer.email);
    await admin.cleanupOwnerBookings(owner.email);
    await admin.cleanupOwnerProperties(owner.email);
    await admin.cleanupSettlements(owner.email);

    const seeded = await admin.createPaidBooking(customer.email, owner.email);
    const bookingId = String(seeded.booking.id);
    const bookingCode = `BKR-${bookingId.slice(0, 8).toUpperCase()}`;

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
        await ensureOwnerLoggedInAs(ownerPage, owner.email, { password: owner.password });
        await bookingHelper.rejectOwnerBooking(ownerPage, String(seeded.property.title), bookingId);

        await expect.poll(async () => {
            const refund = await admin.getRefundForBooking(bookingId);
            return String(refund?.refund_status || refund?.status || '').toUpperCase();
        }, { timeout: 30000 }).toBe('PENDING');

        await ensureAdminLoggedIn(adminPage);
        await gotoAppRoute(adminPage, `${BASE_URLS.admin}/refunds`);
        const refundRow = adminPage.locator('tr').filter({ hasText: bookingCode }).first();
        await expect(refundRow).toBeVisible();
        await refundRow.getByRole('button', { name: /^Review$/i }).click();
        await adminPage.getByRole('button', { name: /Approve Refund/i }).click();

        await expect.poll(async () => {
            const refund = await admin.getRefundForBooking(bookingId);
            return String(refund?.refund_status || refund?.status || '').toUpperCase();
        }, {
            timeout: 90000,
        }).not.toBe('PENDING');

        const refund = await admin.getRefundForBooking(bookingId);
        const finalRefundStatus = String(refund?.refund_status || refund?.status || '').toUpperCase();
        expect(['SUCCESS', 'PROCESSING', 'ONHOLD', 'FAILED']).toContain(finalRefundStatus);

        const booking = await admin.getBookingById(bookingId);
        expect(String(booking?.status || '').toLowerCase()).toMatch(/rejected|refunded|cancelled/);
    } finally {
        await adminContext.close().catch(() => undefined);
        await ownerContext.close().catch(() => undefined);
    }
});
