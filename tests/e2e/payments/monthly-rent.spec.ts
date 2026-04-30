import { expect, test, type Page } from '@playwright/test';
import { ensureCustomerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
const MONTHLY_RENT_CUSTOMER_EMAIL = 'test_customer_monthly_e2e@example.com';

const dismissRatingPopupIfPresent = async (page: Page) => {
    const skipButton = page.getByRole('button', { name: /Skip for now/i });
    if (await skipButton.isVisible().catch(() => false)) {
        await skipButton.click();
    }
};

const insertMonthlyPaymentForBooking = async (bookingId: string, customerId: string) => {
    let insertError: { message: string } | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const { error } = await admin.supabase.from('payments').insert({
            booking_id: bookingId,
            customer_id: customerId,
            amount: 6800,
            status: 'completed',
            payment_method: 'upi',
            payment_type: 'monthly',
            payment_date: new Date().toISOString()
        });

        if (!error) {
            insertError = null;
            break;
        }

        insertError = error as { message: string };
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }

    expect(insertError).toBeNull();
};

const waitForMonthlyPayment = async (bookingId: string) => {
    await expect.poll(
        async () => {
            const payments = await admin.getPaymentsForBooking(bookingId);
            return payments.some((payment) => payment.payment_type === 'monthly');
        },
        {
            timeout: 15000,
            intervals: [250, 500, 1000]
        }
    ).toBe(true);
};

const seedLongStayBooking = async () => {
    const { booking, property } = await admin.createPaidBooking(MONTHLY_RENT_CUSTOMER_EMAIL, TEST_USERS.owner.email);
    const nextPaymentDate = new Date();
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);

    await admin.supabase
        .from('bookings')
        .update({
            status: 'checked-in',
            payment_status: 'paid',
            admin_approved: false,
            end_date: endDate.toISOString().split('T')[0],
            next_payment_date: nextPaymentDate.toISOString()
        })
        .eq('id', booking.id);

    return {
        bookingId: String(booking.id),
        customerId: String(booking.customer_id),
        propertyTitle: String(property.title),
        monthlyRent: Number(booking.monthly_rent || property.monthly_rent || 0),
    };
};

const seedDueMonthlyBooking = async () => {
    const seeded = await seedLongStayBooking();
    const today = new Date();
    const cycleStart = new Date(today);
    cycleStart.setMonth(cycleStart.getMonth() - 1);
    const cycleEnd = new Date(today);
    cycleEnd.setMonth(cycleEnd.getMonth() + 2);

    await admin.supabase
        .from('bookings')
        .update({
            start_date: cycleStart.toISOString().split('T')[0],
            end_date: cycleEnd.toISOString().split('T')[0],
            current_cycle_start_date: cycleStart.toISOString().split('T')[0],
            next_due_date: today.toISOString().split('T')[0],
            rent_payment_status: 'pending',
            admin_approved: false,
        })
        .eq('id', seeded.bookingId);

    return seeded;
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(MONTHLY_RENT_CUSTOMER_EMAIL);
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
});

test.beforeEach(async ({ page }) => {
    await admin.cleanupUserBookings(MONTHLY_RENT_CUSTOMER_EMAIL);
    await ensureCustomerLoggedInAs(page, MONTHLY_RENT_CUSTOMER_EMAIL, {
        password: TEST_USERS.customer.password,
    });
});

test('P-11 long-stay bookings expose the monthly payment trigger on the bookings page', async ({ page }) => {
    await seedLongStayBooking();
    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    await dismissRatingPopupIfPresent(page);
    await expect(page.getByTitle(/Pay Monthly/i).first()).toBeVisible();
});

test('P-12 clicking the monthly payment trigger opens the monthly payments modal in-place', async ({ page }) => {
    await seedLongStayBooking();
    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    await dismissRatingPopupIfPresent(page);
    await page.getByTitle(/Pay Monthly/i).first().click();
    await expect(page.getByRole('heading', { name: /Monthly Payments/i })).toBeVisible();
    await expect(page).toHaveURL(/\/bookings/);
});

test('P-12A due monthly rent opens a fresh rent payment flow instead of showing an already-paid popup', async ({ page }) => {
    const seeded = await seedDueMonthlyBooking();
    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    await dismissRatingPopupIfPresent(page);
    await page.getByTitle(/Pay Monthly/i).first().click();
    await page.getByRole('button', { name: /Pay Now/i }).first().click();
    await expect(page).toHaveURL(/\/payment\?.*context=rent/);
    await expect(page.getByText(/Room Charges \(Monthly Rent\)/i)).toBeVisible();
    await expect(page.getByText(new RegExp(`INR\\s*${Number(seeded.monthlyRent || 0).toLocaleString('en-IN')}`, 'i')).first()).toBeVisible();
});

test('P-12B resident portal payments open first-cycle rent from the check-in timeline without synthetic paid history', async ({ page }) => {
    await seedLongStayBooking();
    await gotoAppRoute(page, `${BASE_URLS.customer}/chat?portalTab=payments`);
    await dismissRatingPopupIfPresent(page);

    await expect(page.getByText(/No verified rent payment has been received for this cycle yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Pay Rent INR/i })).toBeVisible();
    await expect(page.getByText(/No verified rent payments yet/i)).toBeVisible();
    await expect(page.getByText(/Awaiting Admin|Waiting for Admin Approval|Approval Pending/i)).toHaveCount(0);
    await expect(page.getByText(/Your current rent cycle is active until/i)).toHaveCount(0);
    await expect(page.getByText(/^March 2026$/)).toHaveCount(0);
});

test('P-13 monthly rent payment rows can be inserted and queried for a booking', async () => {
    const seeded = await seedLongStayBooking();
    await insertMonthlyPaymentForBooking(seeded.bookingId, seeded.customerId);
    await waitForMonthlyPayment(seeded.bookingId);
});

test('P-14 bookings can persist the next monthly rent due date in the database', async () => {
    const seeded = await seedLongStayBooking();
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 2);
    const { error } = await admin.supabase
        .from('bookings')
        .update({
            next_payment_date: nextDate.toISOString(),
            next_due_date: nextDate.toISOString().split('T')[0]
        })
        .eq('id', seeded.bookingId);

    expect(error).toBeNull();

    await expect.poll(async () => {
        const booking = await admin.getBookingById(seeded.bookingId);
        return Boolean(booking?.next_due_date || booking?.next_payment_date);
    }).toBe(true);
});

test('P-15 monthly rent rows remain linked back to the booking after direct insertion', async () => {
    const seeded = await seedLongStayBooking();
    await insertMonthlyPaymentForBooking(seeded.bookingId, seeded.customerId);
    await waitForMonthlyPayment(seeded.bookingId);
    await expect.poll(
        async () => {
            const payments = await admin.getPaymentsForBooking(seeded.bookingId);
            return payments.filter((payment) => payment.booking_id === seeded.bookingId).length;
        },
        {
            timeout: 15000,
            intervals: [250, 500, 1000]
        }
    ).toBeGreaterThan(0);
});
