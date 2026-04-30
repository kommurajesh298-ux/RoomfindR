import { test, expect } from '../../fixtures/roomfindr.fixture';
import { createTestIdentity } from '../../data/test-users';
import type { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import type { CleanupRegistry } from '../../utils/cleanup-registry';
import type { CleanupRequest } from '../../helpers/cleanupTestData';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';

test.describe('customer booking lifecycle', () => {
    const bootstrapIsolatedUsers = async ({
        adminHelper,
        cleanupRegistry,
        cleanupTestData,
    }: {
        adminHelper: SupabaseAdminHelper;
        cleanupRegistry: CleanupRegistry;
        cleanupTestData: (request: CleanupRequest) => Promise<void>;
    }) => {
        const customer = createTestIdentity('booking-flow', 'customer');
        const owner = createTestIdentity('booking-flow', 'owner');

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

        return { customer, owner };
    };

    test('BOOK-01 public customers can search, view a property, and are prompted to sign in before reserving', async ({
        page,
        adminHelper,
        cleanupRegistry,
        cleanupTestData,
        customerApp,
    }) => {
        const { owner } = await bootstrapIsolatedUsers({ adminHelper, cleanupRegistry, cleanupTestData });
        const { property } = await adminHelper.createPropertyWithRoom(owner.email, {
            title: `Open Reserve ${Date.now()}`,
            status: 'published',
            city: 'Bengaluru',
        });

        await customerApp.openHome('/?search=Bengaluru');
        await customerApp.openProperty(String(property.id));
        await customerApp.reserveFirstVisibleRoom();

        await expect(page).toHaveURL(/\/login/);
        await expect(page.locator('body')).toContainText(/Please login to book|Login/i);
    });

    test('BOOK-02 pending booking payments can be reset into a fresh retry from the customer bookings page', async ({
        page,
        adminHelper,
        cleanupRegistry,
        cleanupTestData,
        login,
        customerApp,
    }) => {
        const { customer, owner } = await bootstrapIsolatedUsers({ adminHelper, cleanupRegistry, cleanupTestData });
        await login({ role: 'customer', email: customer.email });

        const seeded = await adminHelper.createPendingBookingForOwner(customer.email, owner.email);
        await customerApp.openBookings();
        await expect(page.getByText(new RegExp(String(seeded.property.title), 'i')).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Cancel All/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Cancel$/i })).toHaveCount(0);
        await customerApp.retryPendingBookingFresh();

        await expect(page).toHaveURL(new RegExp(`/property/${seeded.property.id}`));
        await expect(page.getByRole('button', { name: /Retry Booking/i })).toBeVisible();

        const booking = await adminHelper.getBookingById(String(seeded.booking.id));
        expect(String(booking?.payment_status || '').toLowerCase()).toBe('failed');
    });

    test('BOOK-03 failed booking payments surface a retry booking action without losing DB state', async ({
        page,
        adminHelper,
        cleanupRegistry,
        cleanupTestData,
        login,
        paymentHelper,
        customerApp,
    }) => {
        const { customer, owner } = await bootstrapIsolatedUsers({ adminHelper, cleanupRegistry, cleanupTestData });
        await login({ role: 'customer', email: customer.email });

        const seeded = await adminHelper.createPendingBookingForOwner(customer.email, owner.email);
        await paymentHelper.markBookingFailed(String(seeded.booking.id), String(seeded.booking.customer_id), 5000);

        await customerApp.openBookings();
        await expect(page.getByRole('button', { name: /Retry Booking/i }).first()).toBeVisible();

        const booking = await adminHelper.getBookingById(String(seeded.booking.id));
        expect(String(booking?.payment_status || '').toLowerCase()).toBe('failed');
    });

    test('BOOK-04 checked-in customers can access the vacate action from the resident portal', async ({
        page,
        adminHelper,
        cleanupRegistry,
        cleanupTestData,
        login,
        customerApp,
    }) => {
        const { customer, owner } = await bootstrapIsolatedUsers({ adminHelper, cleanupRegistry, cleanupTestData });
        await login({ role: 'customer', email: customer.email });

        const seeded = await adminHelper.createPaidBooking(customer.email, owner.email);
        await adminHelper.supabase
            .from('bookings')
            .update({ status: 'checked-in', payment_status: 'paid', admin_approved: false })
            .eq('id', seeded.booking.id);

        await gotoAppRoute(page, `${BASE_URLS.customer}/chat`);
        const skipRating = page.getByRole('button', { name: /Skip for now/i });
        if (await skipRating.isVisible().catch(() => false)) {
            await skipRating.click();
        }
        await expect(page.getByRole('button', { name: /Request Vacate/i })).toBeVisible();
        page.once('dialog', (dialog) => {
            void dialog.accept();
        });
        await page.getByRole('button', { name: /Request Vacate/i }).click();

        await expect.poll(async () => {
            return ((await page.locator('main').textContent()) || '').toLowerCase();
        }).toMatch(/vacate pg|request vacate|planning to leave|waiting for owner approval/);
    });

    test('BOOK-05 due monthly rent routes customers into a rent payment flow', async ({
        page,
        adminHelper,
        cleanupRegistry,
        cleanupTestData,
        login,
        bookingHelper,
        customerApp,
    }) => {
        const { customer, owner } = await bootstrapIsolatedUsers({ adminHelper, cleanupRegistry, cleanupTestData });
        await login({ role: 'customer', email: customer.email });

        const seeded = await bookingHelper.seedDueMonthlyBooking(customer.email, owner.email);
        await customerApp.openBookings();
        await page.getByTitle(/Pay Monthly/i).first().click();
        await page.getByRole('button', { name: /Pay Now/i }).first().click();

        await expect(page).toHaveURL(/\/payment\?.*context=rent/);
        await expect(page.locator('body')).toContainText(/Booking Summary|Monthly Rent/i);
        expect(seeded.booking.id).toBeTruthy();
    });
});
