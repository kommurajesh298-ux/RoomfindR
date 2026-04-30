import { expect, devices, type Browser } from '@playwright/test';
import { gotoAppRoute } from '../helpers/app-shell';
import { ensureCustomerLoggedInAs } from '../helpers/auth-session';
import { BASE_URLS } from '../helpers/e2e-config';
import { createPaymentHelper } from '../helpers/paymentHelper';
import { getAdminHelper, signPaymentStatusToken } from './apiHelper';

export const MOBILE_UPI_APPS = ['PhonePe', 'GPay', 'Paytm'] as const;

const buildReturnApps = () => ({
    customer: 'roomfinder://app',
    owner: 'com.roomfindr.owner://app',
});

export const createSystemPaymentHelper = () => {
    const admin = getAdminHelper();
    const payment = createPaymentHelper(admin);
    const getLatestPayment = async (bookingId: string, customerId: string, amount: number) => {
        const payments = await admin.getPaymentsForBooking(bookingId);
        return payments[0] || admin.createPendingPayment(bookingId, customerId, amount);
    };

    return {
        buildReturnApps() {
            return buildReturnApps();
        },

        async waitForPaymentRow(bookingId: string, timeoutMs = 25000) {
            const endTime = Date.now() + timeoutMs;
            while (Date.now() < endTime) {
                const payments = await admin.getPaymentsForBooking(bookingId);
                const paymentRow = payments[0];
                if (paymentRow) {
                    return paymentRow;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
            }

            throw new Error(`Timed out waiting for a payment row for booking ${bookingId}`);
        },

        async markLatestPaymentPaid(bookingId: string, customerId: string, amount = 5000) {
            const latest = await getLatestPayment(bookingId, customerId, amount);
            await admin.markPaymentCompleted(String(latest.id), bookingId);
            return latest;
        },

        async markLatestPaymentFailed(bookingId: string, customerId: string, amount = 5000) {
            const latest = await getLatestPayment(bookingId, customerId, amount);
            await admin.markPaymentFailed(String(latest.id), bookingId);
            return latest;
        },

        async triggerSettlement(bookingId: string) {
            await payment.triggerOwnerSettlement(bookingId);
        },

        createStatusToken(bookingId: string, paymentType: 'booking' | 'monthly' = 'booking', month?: string) {
            return signPaymentStatusToken({
                bookingId,
                app: 'customer',
                paymentType,
                month,
            });
        },
    };
};

export const openMobilePaymentPage = async (browser: Browser, input: {
    bookingId: string;
    customerEmail: string;
    password: string;
}) => {
    const context = await browser.newContext({
        ...devices['Pixel 5'],
        storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await ensureCustomerLoggedInAs(page, input.customerEmail, { password: input.password });
    await gotoAppRoute(page, `${BASE_URLS.customer}/payment?bookingId=${input.bookingId}`);
    return { context, page };
};
