import { expect, type Page } from '@playwright/test';
import { gotoAppRoute } from '../helpers/app-shell';
import { BASE_URLS } from '../helpers/e2e-config';
import { createBookingHelper } from '../helpers/createBookingHelper';
import { getAdminHelper } from './apiHelper';

const ownerBookingCard = (page: Page, propertyTitle: string) =>
    page.locator('[data-testid="owner-booking-card"], div.bg-white.rounded-2xl').filter({ hasText: propertyTitle }).first();

const openOwnerBookingsTab = async (page: Page, tabLabel: RegExp) => {
    const tabButton = page.getByRole('button', { name: tabLabel }).first();
    await tabButton.waitFor({ state: 'visible', timeout: 30000 });
    await tabButton.click({ force: true });
};

export const createSystemBookingHelper = () => {
    const admin = getAdminHelper();
    const booking = createBookingHelper(admin);

    return {
        ...booking,

        async acceptOwnerBooking(page: Page, propertyTitle: string, bookingId: string) {
            await gotoAppRoute(page, `${BASE_URLS.owner}/bookings`);
            await openOwnerBookingsTab(page, /Requests/i);
            await expect(page.getByText(new RegExp(String(propertyTitle), 'i')).first()).toBeVisible({ timeout: 30000 });
            const waitForAcceptedState = () => expect.poll(async () => {
                const data = await admin.getBookingById(bookingId);
                return `${String(data?.status || '').toLowerCase()}:${String(Boolean(data?.owner_accept_status))}`;
            }, { timeout: 15000 }).toBe('approved:true');

            for (let attempt = 0; attempt < 2; attempt += 1) {
                const acceptButton = ownerBookingCard(page, propertyTitle).getByRole('button', { name: /Accept|Approve Paid/i }).first();
                await acceptButton.waitFor({ state: 'visible', timeout: 30000 });
                await acceptButton.click({ force: true });

                try {
                    await waitForAcceptedState();
                    return;
                } catch (error) {
                    if (attempt === 1) {
                        throw error;
                    }
                    await page.reload();
                    await openOwnerBookingsTab(page, /Requests/i);
                    await expect(page.getByText(new RegExp(String(propertyTitle), 'i')).first()).toBeVisible({ timeout: 30000 });
                }
            }
        },

        async rejectOwnerBooking(page: Page, propertyTitle: string, bookingId: string, reason = 'Room unavailable') {
            await gotoAppRoute(page, `${BASE_URLS.owner}/bookings`);
            await openOwnerBookingsTab(page, /Requests/i);
            await expect(page.getByText(new RegExp(String(propertyTitle), 'i')).first()).toBeVisible({ timeout: 30000 });
            await ownerBookingCard(page, propertyTitle).getByRole('button', { name: /^Reject$/i }).click();
            await page.getByLabel(/Reason for rejection/i).selectOption(reason);
            await page.getByRole('button', { name: /Reject Booking/i }).click();

            await expect.poll(async () => {
                const data = await admin.getBookingById(bookingId);
                return String(data?.status || '').toLowerCase();
            }, { timeout: 30000 }).toMatch(/rejected|refunded|cancelled/);
        },

        async waitForBookingStatus(bookingId: string, matcher: RegExp, timeoutMs = 30000) {
            await expect.poll(async () => {
                const data = await admin.getBookingById(bookingId);
                return String(data?.status || '').toLowerCase();
            }, { timeout: timeoutMs }).toMatch(matcher);
        },
    };
};
