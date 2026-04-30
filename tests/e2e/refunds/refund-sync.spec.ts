import { test, expect } from '../../fixtures/roomfindr.fixture';
import { createTestIdentity } from '../../data/test-users';
import { loginHelper } from '../../helpers/loginHelper';

test.setTimeout(240000);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeRefundStatus = (refund: Record<string, unknown> | null) => {
    const normalized = String(refund?.status || '').trim().toUpperCase();
    const raw = String(refund?.refund_status || '').trim().toUpperCase();
    return ['ONHOLD', 'PROCESSING', 'SUCCESS', 'FAILED'].find((status) =>
        status === normalized || status === raw,
    ) || 'PENDING';
};

test('REF-01 booking rejection and refund approval stay synchronized across customer owner and admin apps', async ({
    browser,
    adminHelper,
    cleanupRegistry,
    cleanupTestData,
}) => {
    const customer = createTestIdentity('refund-flow', 'customer');
    const owner = createTestIdentity('refund-flow', 'owner');

    const customerUser = await adminHelper.createTestUser(customer.email, customer.password, 'customer');
    if (customerUser?.id) {
        await adminHelper.ensureCustomerProfile(customerUser.id, customer.email);
    }

    const ownerUser = await adminHelper.createTestUser(owner.email, owner.password, 'owner');
    if (ownerUser?.id) {
        await adminHelper.ensureOwnerProfile(ownerUser.id, owner.email);
        await adminHelper.ensureOwnerVerified(ownerUser.id, owner.email);
    }

    cleanupRegistry.add(`cleanup ${customer.email}`, async () => {
        await cleanupTestData({
            users: [{ email: customer.email, role: 'customer', deleteAuthUser: true }],
        });
    });
    cleanupRegistry.add(`cleanup ${owner.email}`, async () => {
        await cleanupTestData({
            users: [{
                email: owner.email,
                role: 'owner',
                cleanupBookings: true,
                cleanupProperties: true,
                cleanupSettlements: true,
                deleteAuthUser: true,
            }],
        });
    });

    const seeded = await adminHelper.createPaidBooking(customer.email, owner.email);
    const bookingId = String(seeded.booking.id);
    const propertyTitle = String(seeded.property.title);
    const bookingCode = `BKR-${bookingId.slice(0, 8).toUpperCase()}`;

    const ownerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const adminContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const customerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const ownerPage = await ownerContext.newPage();
    const adminPage = await adminContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
        await loginHelper(ownerPage, { role: 'owner', email: owner.email });
        await ownerPage.goto('http://127.0.0.1:5174/bookings');
        await expect(ownerPage.getByText(new RegExp(escapeRegExp(propertyTitle), 'i')).first()).toBeVisible();
        const ownerCard = ownerPage.locator('div.bg-white.rounded-2xl').filter({ hasText: propertyTitle }).first();
        await ownerCard.getByRole('button', { name: /^Reject$/i }).click();
        await ownerPage.getByLabel(/Reason for rejection/i).selectOption('Room unavailable');
        await ownerPage.getByRole('button', { name: /Reject Booking/i }).click();

        await expect.poll(async () => {
            const refund = await adminHelper.getRefundForBooking(bookingId);
            return String(refund?.refund_status || refund?.status || 'NONE').toUpperCase();
        }, { timeout: 30000 }).toBe('PENDING');

        await loginHelper(adminPage, { role: 'admin' });
        await adminPage.goto('http://127.0.0.1:5175/refunds');
        const refundRow = adminPage.locator('tr').filter({ hasText: bookingCode }).first();
        await expect(refundRow).toBeVisible();
        await refundRow.getByRole('button', { name: /^Review$/i }).click();
        await adminPage.getByRole('button', { name: /Approve Refund/i }).click();

        await expect.poll(async () => {
            const refund = await adminHelper.getRefundForBooking(bookingId);
            return normalizeRefundStatus(refund);
        }, { timeout: 90000 }).not.toBe('PENDING');

        const finalStatus = normalizeRefundStatus(await adminHelper.getRefundForBooking(bookingId));

        await loginHelper(customerPage, { role: 'customer', email: customer.email });
        await customerPage.goto(`http://127.0.0.1:5173/bookings?highlight=${bookingId}`);
        await expect(customerPage.getByText(new RegExp(escapeRegExp(propertyTitle), 'i')).first()).toBeVisible();
        await expect(customerPage.locator('body')).toContainText(/Refund|Refunded|On Hold|Processing/i);

        await ownerPage.goto('http://127.0.0.1:5174/settlements');
        await ownerPage.getByRole('button', { name: /refund history/i }).click();
        await expect(ownerPage.getByText(/Refund Ledger/i)).toBeVisible();
        await expect(ownerPage.getByText(new RegExp(escapeRegExp(propertyTitle), 'i')).first()).toBeVisible();

        await adminPage.goto('http://127.0.0.1:5175/refunds');
        await expect(adminPage.locator('tr').filter({ hasText: bookingCode }).first()).toContainText(finalStatus);
    } finally {
        await ownerContext.close().catch(() => undefined);
        await adminContext.close().catch(() => undefined);
        await customerContext.close().catch(() => undefined);
    }
});
