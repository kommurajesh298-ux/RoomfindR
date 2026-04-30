import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { loginHelper } from '../../helpers/loginHelper';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS, createUniqueEmail } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
const CASHFREE_CUSTOMER_EMAIL = createUniqueEmail('test-customer-cashfree', 'customer');

const signPaymentStatusToken = (input: {
    bookingId?: string;
    orderId?: string;
    app: 'customer' | 'owner' | 'admin';
    paymentType?: 'booking' | 'monthly';
    month?: string;
    expiresInSeconds?: number;
}) => {
    const secret = String(
        process.env.PAYMENT_STATUS_TOKEN_SECRET
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
        || ''
    ).trim();

    if (!secret) {
        throw new Error('Missing payment status token secret for E2E test.');
    }

    const payload = {
        bookingId: input.bookingId,
        orderId: input.orderId,
        app: input.app,
        paymentType: input.paymentType || 'booking',
        month: input.month,
        exp: Math.floor(Date.now() / 1000) + Math.max(input.expiresInSeconds || 900, 60),
    };

    const payloadSegment = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureSegment = createHmac('sha256', secret)
        .update(payloadSegment)
        .digest('base64url');

    return `${payloadSegment}.${signatureSegment}`;
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(CASHFREE_CUSTOMER_EMAIL);
    await admin.deleteTestUser(CASHFREE_CUSTOMER_EMAIL);
});

test.beforeEach(async ({ page }) => {
    await admin.cleanupUserBookings(CASHFREE_CUSTOMER_EMAIL);
    await ensureCustomerLoggedInAs(page, CASHFREE_CUSTOMER_EMAIL, {
        password: TEST_USERS.customer.password,
    }).catch(() => undefined);
    await loginHelper(page, {
        role: 'customer',
        email: CASHFREE_CUSTOMER_EMAIL,
        password: TEST_USERS.customer.password,
        baseUrl: BASE_URLS.customer,
        postLoginPath: '/',
        mode: 'ui',
    });
});

test('P-01 booking payment pages render the booking summary and total due', async ({ page }) => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment?bookingId=${booking.id}`);
    await expect(page.getByText(/Booking Summary/i)).toBeVisible();
    await expect(page.getByText(/Total Payable|Total Due/i)).toBeVisible();
    await expect.poll(async () => (await page.locator('body').textContent()) || '').toMatch(/INR [1-9]|₹[1-9]/i);
});

test('P-02 payment method selectors render before Cashfree checkout loads', async ({ page }) => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment?bookingId=${booking.id}`);
    await expect(page.getByRole('button', { name: /QR Code|Scan & Pay/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Card/i })).toBeVisible();
});

test('P-02A desktop payment pages show QR guidance instead of blocking UPI support errors', async ({ page }) => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment?bookingId=${booking.id}`);
    await expect(page.getByRole('button', { name: /Generate QR/i })).toBeVisible();
    await expect(page.getByText(/QR activates after Pay Now|Inline UPI QR/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /PhonePe|Paytm|Google Pay/i })).toHaveCount(0);
    await expect(page.getByText(/UPI Apps/i)).toHaveCount(0);
    await expect(page.getByText(/supported mobile browsers/i)).toHaveCount(0);
});

test('P-02B desktop QR payments start backend tracking immediately after QR generation', async ({ page }) => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment?bookingId=${booking.id}`);

    const generateQrButton = page.getByRole('button', { name: /Generate QR/i });
    await expect(generateQrButton).toBeEnabled({ timeout: 20000 });
    await generateQrButton.click();

    const refreshQrButton = page.getByRole('button', { name: /Refresh QR/i });
    await expect(refreshQrButton).toBeVisible({ timeout: 20000 });
    await expect(refreshQrButton).toBeEnabled({ timeout: 20000 });
    await expect(page.getByText(/QR activates after Pay Now/i)).toHaveCount(0);
});

test('P-03 booking payment success routes redirect customers to bookings', async ({ page }) => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment/confirmed?context=booking&booking_id=${booking.id}`);
    await expect.poll(() => page.url(), { timeout: 10000 }).toContain('/bookings');
    await expect(page.getByRole('button', { name: /Active/i })).toBeVisible();
});

test('P-03A public payment status callbacks stay accessible without a local session', async ({ page }) => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    const payment = await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    await admin.markPaymentCompleted(String(payment.id), String(booking.id));
    const statusToken = signPaymentStatusToken({
        bookingId: String(booking.id),
        app: 'customer',
        paymentType: 'booking',
    });

    await page.context().clearCookies();
    await page.goto('about:blank');
    await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
    }).catch(() => undefined);

    await gotoAppRoute(
        page,
        `${BASE_URLS.customer}/payment-status?booking_id=${booking.id}&app=customer&status_token=${encodeURIComponent(statusToken)}`,
    );

    await expect(page).not.toHaveURL(/\/login/);
    await expect.poll(() => page.url(), { timeout: 15000 }).toMatch(/\/payment-status|\/payment\/confirmed|\/bookings/);
    if (page.url().includes('/payment/confirmed')) {
        await expect(page.getByRole('heading', { name: /Payment Successful/i })).toBeVisible();
    } else if (page.url().includes('/bookings')) {
        await expect(page.getByRole('button', { name: /Active/i })).toBeVisible();
    } else {
        await expect(page.locator('body')).not.toContainText(/Please sign in|Unauthorized/i);
    }
});

test('P-04 booking payment failures render the payment error surface', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment/error?context=booking&booking_id=test`);
    await expect(page.getByRole('heading', { name: /Refund Issued|Payment Failed/i })).toBeVisible();
});

test('P-05 completed payments update the booking payment status in the database', async () => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    const payment = await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    await admin.markPaymentCompleted(String(payment.id), String(booking.id));
    const updated = await admin.getBookingById(String(booking.id));
    expect(updated?.payment_status).toBe('paid');
  });

test('P-06 pending bookings retain their pending payment state until completion', async () => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    const pending = await admin.getBookingById(String(booking.id));
    expect(pending?.payment_status).toBe('pending');
    expect(pending?.status).toBe('payment_pending');
});

test('P-06A failed booking payments transition bookings into payment_failed state', async () => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    const payment = await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    await admin.markPaymentFailed(String(payment.id), String(booking.id));
    const failedBooking = await admin.getBookingById(String(booking.id));
    expect(failedBooking?.payment_status).toBe('failed');
    expect(['payment_failed', 'payment_pending']).toContain(String(failedBooking?.status));
});

test('P-06B failed booking payments show Retry Booking without any resume-payment copy', async ({ page }) => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    const payment = await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    await admin.markPaymentFailed(String(payment.id), String(booking.id));
    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    await expect(page.getByRole('button', { name: /Retry Booking/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Resume Payment/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Complete Payment/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Cancel All/i })).toHaveCount(0);
});

test('P-07 pending payment rows are linked to their bookings in the payments table', async () => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    const payments = await admin.getPaymentsForBooking(String(booking.id));
    expect(payments.length).toBeGreaterThan(0);
});

test('P-08 refund helper rows are created for bookings marked as refunded', async () => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    await admin.markBookingRefunded(String(booking.id));
    const refund = await admin.getRefundForBooking(String(booking.id));
    expect(refund).not.toBeNull();
});

test('P-09 refund records expose a machine-readable refund status', async () => {
    const booking = await admin.createPendingBooking(CASHFREE_CUSTOMER_EMAIL);
    await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    await admin.markBookingRefunded(String(booking.id));
    const refund = await admin.getRefundForBooking(String(booking.id));
    expect(['PENDING', 'SUCCESS']).toContain(String(refund?.status).toUpperCase());
});

test('P-10 rent-context payment routes still render the payment screen', async ({ page }) => {
    const { booking } = await admin.createPaidBooking(CASHFREE_CUSTOMER_EMAIL, TEST_USERS.owner.email);
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment?context=rent&bookingId=${booking.id}`);
    await expect(page.getByText(/Booking Summary/i)).toBeVisible();
});
