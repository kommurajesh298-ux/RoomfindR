import { expect, test } from '@playwright/test';
import { ensureAdminLoggedIn, ensureLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS, loadE2eEnv } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { createTestIdentity } from '../../data/test-users';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

let admin: SupabaseAdminHelper;
const customer = createTestIdentity('admin-refund', 'customer');
const owner = createTestIdentity('admin-refund', 'owner');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveRefundStatus = (refund: Record<string, unknown> | null) => {
    const normalized = String(refund?.status || '').trim().toUpperCase();
    const raw = String(refund?.refund_status || '').trim().toUpperCase();
    return ['ONHOLD', 'PROCESSING', 'SUCCESS', 'FAILED'].find((status) =>
        status === normalized || status === raw
    ) || 'PENDING';
};

const getCustomerStatusPattern = (status: string) => {
    switch (status) {
        case 'ONHOLD':
            return /Refund On Hold|Gateway On Hold|Cashfree has placed this refund on hold/i;
        case 'PROCESSING':
            return /Refund Processing|Bank Processing/i;
        case 'SUCCESS':
            return /Refunded|Money Refunded/i;
        case 'FAILED':
            return /Refund Failed/i;
        default:
            return /Refund Review|waiting for admin review/i;
    }
};

const getOwnerStatusPattern = (status: string) => {
    switch (status) {
        case 'ONHOLD':
            return /ON HOLD|Refund On Hold/i;
        case 'PROCESSING':
            return /PROCESSING|Refund Processing/i;
        case 'SUCCESS':
            return /REFUNDED|Refund Success/i;
        case 'FAILED':
            return /FAILED|Refund Failed/i;
        default:
            return /PENDING APPROVAL|Refund Review/i;
    }
};

const getAdminStatusPattern = (status: string) => {
    switch (status) {
        case 'ONHOLD':
            return /ON HOLD/i;
        case 'PROCESSING':
            return /PROCESSING/i;
        case 'SUCCESS':
            return /SUCCESS/i;
        case 'FAILED':
            return /FAILED/i;
        default:
            return /PENDING APPROVAL/i;
    }
};

const getCustomerTabForStatus = (status: string) => {
    const normalized = String(status || '').trim().toLowerCase().replace(/_/g, '-');
    return ['cancelled', 'checked-out', 'cancelled-by-customer', 'vacated', 'completed']
        .includes(normalized)
        ? 'history'
        : 'active';
};

const runCleanupSafely = async (task: () => Promise<unknown>, timeoutMs = 30000) => {
    await Promise.race([
        Promise.resolve().then(task).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
};

test.beforeAll(async () => {
    loadE2eEnv();
    admin = new SupabaseAdminHelper();
    const customerUser = await admin.createTestUser(customer.email, customer.password, 'customer');
    if (customerUser?.id) {
        await admin.ensureCustomerProfile(customerUser.id, customer.email);
    }

    const ownerUser = await admin.createTestUser(owner.email, owner.password, 'owner');
    if (ownerUser?.id) {
        await admin.ensureOwnerProfile(ownerUser.id, owner.email);
        await admin.ensureOwnerVerified(ownerUser.id, owner.email);
    }

    await admin.cleanupUserBookings(customer.email);
    await admin.cleanupOwnerBookings(owner.email);
    await admin.cleanupOwnerProperties(owner.email);
    await admin.cleanupSettlements(owner.email);
});

test.afterAll(async () => {
    await runCleanupSafely(() => admin.cleanupUserBookings(customer.email));
    await runCleanupSafely(() => admin.cleanupOwnerBookings(owner.email));
    await runCleanupSafely(() => admin.cleanupOwnerProperties(owner.email));
    await runCleanupSafely(() => admin.cleanupSettlements(owner.email));
    await runCleanupSafely(() => admin.supabase.from('customers').delete().eq('email', customer.email));
    await runCleanupSafely(() => admin.supabase.from('owners').delete().eq('email', owner.email));
    await runCleanupSafely(() => admin.supabase.from('accounts').delete().eq('email', customer.email));
    await runCleanupSafely(() => admin.supabase.from('accounts').delete().eq('email', owner.email));
    await runCleanupSafely(() => admin.deleteTestUser(customer.email));
    await runCleanupSafely(() => admin.deleteTestUser(owner.email));
});

test('A-26 paid booking rejection and refund approval stay consistent across customer owner and admin', async ({ browser }) => {
    await admin.cleanupUserBookings(customer.email);
    await admin.cleanupOwnerBookings(owner.email);
    await admin.cleanupOwnerProperties(owner.email);
    await admin.cleanupSettlements(owner.email);

    const { booking, property } = await admin.createPaidBooking(customer.email, owner.email);
    const bookingId = String(booking.id);
    const propertyTitle = String(property.title || `Booking ${bookingId}`);
    const bookingCode = `BKR-${bookingId.slice(0, 8).toUpperCase()}`;

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    try {
        await ensureLoggedIn(ownerPage, {
            role: 'owner',
            email: owner.email,
            baseUrl: BASE_URLS.owner
        });
        await gotoAppRoute(ownerPage, `${BASE_URLS.owner}/bookings`);
        await expect(ownerPage.getByText(new RegExp(escapeRegExp(propertyTitle), 'i')).first()).toBeVisible({
            timeout: 30000
        });

        const ownerBookingCard = ownerPage.locator('div.bg-white.rounded-2xl').filter({
            hasText: propertyTitle
        }).first();
        await ownerBookingCard.getByRole('button', { name: /^Reject$/i }).click();
        await expect(ownerPage.getByRole('heading', { name: /Reject Booking/i })).toBeVisible();
        await ownerPage.getByLabel(/Reason for rejection/i).selectOption('Room unavailable');
        await ownerPage.getByRole('button', { name: /Reject Booking/i }).click();

        await expect.poll(async () => {
            const refund = await admin.getRefundForBooking(bookingId);
            return refund ? String(refund.refund_status || refund.status || '').trim().toUpperCase() : 'NONE';
        }, {
            timeout: 30000,
            message: 'waiting for owner rejection to create a pending refund row'
        }).toBe('PENDING');

        await gotoAppRoute(ownerPage, `${BASE_URLS.owner}/bookings?tab=rejected`);
        await expect(ownerPage.getByText(new RegExp(escapeRegExp(propertyTitle), 'i')).first()).toBeVisible({
            timeout: 30000
        });
        await expect(ownerPage.locator('body')).toContainText(/Refund Review/i);

        await ensureAdminLoggedIn(adminPage);
        await gotoAppRoute(adminPage, `${BASE_URLS.admin}/refunds`);

        const pendingRefundRow = adminPage.locator('tr').filter({
            hasText: bookingCode
        }).first();
        await expect(pendingRefundRow).toBeVisible();
        await expect(pendingRefundRow.getByText(/PENDING APPROVAL/i)).toBeVisible();
        await pendingRefundRow.getByRole('button', { name: /^Review$/i }).click();
        await expect(adminPage.getByRole('heading', { name: /Approve booking refund/i })).toBeVisible();
        await adminPage.getByRole('button', { name: /Approve Refund/i }).click();

        await expect.poll(async () => {
            const refund = await admin.getRefundForBooking(bookingId);
            return resolveRefundStatus(refund);
        }, {
            timeout: 90000,
            message: 'waiting for admin approval to move the refund beyond pending review'
        }).not.toBe('PENDING');

        const refundAfterApproval = await admin.getRefundForBooking(bookingId);
        const finalRefundStatus = resolveRefundStatus(refundAfterApproval);
        const { data: bookingAfterApproval, error: bookingLookupError } = await admin.supabase
            .from('bookings')
            .select('status')
            .eq('id', bookingId)
            .maybeSingle();
        if (bookingLookupError) {
            throw bookingLookupError;
        }
        const customerTab = getCustomerTabForStatus(String(bookingAfterApproval?.status || ''));

        await adminPage.reload({ waitUntil: 'domcontentloaded' });
        const updatedRefundRow = adminPage.locator('tr').filter({
            hasText: bookingCode
        }).first();
        await expect(updatedRefundRow).toBeVisible();
        await expect(updatedRefundRow.getByText(getAdminStatusPattern(finalRefundStatus))).toBeVisible();

        await ensureLoggedIn(customerPage, {
            role: 'customer',
            email: customer.email,
            baseUrl: BASE_URLS.customer,
            postLoginPath: '/'
        });
        await gotoAppRoute(customerPage, `${BASE_URLS.customer}/bookings?highlight=${bookingId}&app=customer`);
        if (customerTab === 'history') {
            const historyTab = customerPage.getByRole('button', { name: /^History$/i });
            if (await historyTab.isVisible().catch(() => false)) {
                await historyTab.click();
            }
        }
        await expect(customerPage.getByText(new RegExp(escapeRegExp(propertyTitle), 'i')).first()).toBeVisible();
        await expect(customerPage.locator('body')).toContainText(getCustomerStatusPattern(finalRefundStatus), {
            timeout: 30000
        });

        await gotoAppRoute(ownerPage, `${BASE_URLS.owner}/settlements`);
        await ownerPage.getByRole('button', { name: /refund history/i }).click();
        await expect(ownerPage.getByText(/Refund Ledger/i)).toBeVisible();
        await expect(ownerPage.getByText(new RegExp(escapeRegExp(propertyTitle), 'i')).first()).toBeVisible();
        await expect(ownerPage.locator('body')).toContainText(getOwnerStatusPattern(finalRefundStatus), {
            timeout: 30000
        });
    } finally {
        await customerContext.close().catch(() => undefined);
        await adminContext.close().catch(() => undefined);
        await ownerContext.close().catch(() => undefined);
    }
});
