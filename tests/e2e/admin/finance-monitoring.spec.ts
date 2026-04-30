import { expect, test } from '@playwright/test';
import { ensureAdminLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { createTestIdentity } from '../../data/test-users';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
const customer = createTestIdentity('admin-finance', 'customer');
const owner = createTestIdentity('admin-finance', 'owner');

const runCleanupSafely = async (task: () => Promise<unknown>, timeoutMs = 30000) => {
    await Promise.race([
        Promise.resolve().then(task).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
};

const seedReviewQueueBooking = async () => {
    const seeded = await admin.createPendingBookingForOwner(customer.email, owner.email);
    await admin.supabase
        .from('bookings')
        .update({ status: 'requested', payment_status: 'paid', admin_approved: false })
        .eq('id', seeded.booking.id);
    return seeded;
};

test.beforeAll(async () => {
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
});

test.afterAll(async () => {
    await runCleanupSafely(() => admin.cleanupUserBookings(customer.email));
    await runCleanupSafely(() => admin.cleanupOwnerBookings(owner.email));
    await runCleanupSafely(() => admin.cleanupOwnerProperties(owner.email));
    await runCleanupSafely(() => admin.supabase.from('customers').delete().eq('email', customer.email));
    await runCleanupSafely(() => admin.supabase.from('owners').delete().eq('email', owner.email));
    await runCleanupSafely(() => admin.supabase.from('accounts').delete().eq('email', customer.email));
    await runCleanupSafely(() => admin.supabase.from('accounts').delete().eq('email', owner.email));
    await runCleanupSafely(() => admin.deleteTestUser(customer.email));
    await runCleanupSafely(() => admin.deleteTestUser(owner.email));
});

test.beforeEach(async ({ page }) => {
    await admin.cleanupUserBookings(customer.email);
    await admin.cleanupOwnerBookings(owner.email);
    await admin.cleanupOwnerProperties(owner.email);
    await ensureAdminLoggedIn(page);
});

test('A-16 the admin bookings route renders the review queue with seeded booking rows', async ({ page }) => {
    const seeded = await seedReviewQueueBooking();
    await gotoAppRoute(page, `${BASE_URLS.admin}/bookings`);
    await expect(page.getByText(/All Bookings|Admin Review|Customer/i).first()).toBeVisible();
    await expect(page.locator('tr').filter({ hasText: String(seeded.property.title) }).first()).toBeVisible();
});

test('A-17 clicking review opens the booking approval modal', async ({ page }) => {
    const seeded = await seedReviewQueueBooking();
    await gotoAppRoute(page, `${BASE_URLS.admin}/bookings`);
    const reviewRow = page.locator('tr').filter({ hasText: String(seeded.property.title) }).first();
    await expect(reviewRow).toBeVisible();
    await reviewRow.getByRole('button', { name: /Verify/i }).click();
    await expect(page.getByRole('heading', { name: /Review booking payment/i })).toBeVisible();
    await expect(page.locator('body')).toContainText(/Complete admin verification/i);
});
