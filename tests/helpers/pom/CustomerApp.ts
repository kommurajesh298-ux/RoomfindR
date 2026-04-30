import { expect, type Page } from '@playwright/test';
import { gotoAppRoute } from '../app-shell';
import { BASE_URLS } from '../e2e-config';

export class CustomerApp {
    constructor(private readonly page: Page) {}

    private async findVisibleAction(locator: ReturnType<Page['getByRole']>) {
        const count = await locator.count().catch(() => 0);
        for (let index = count - 1; index >= 0; index -= 1) {
            const candidate = locator.nth(index);
            if (await candidate.isVisible().catch(() => false)) {
                return candidate;
            }
        }
        return null;
    }

    private async dismissBlockingOverlays() {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const locationHeading = this.page.getByRole('heading', { name: /Select Location/i }).first();
            if (await locationHeading.isVisible().catch(() => false)) {
                const bangaloreButton = await this.findVisibleAction(
                    this.page.getByRole('button', { name: /Bengaluru/i })
                );
                if (bangaloreButton) {
                    await bangaloreButton.click({ force: true });
                    continue;
                }

                const closeButton = this.page.locator('[aria-label="Close"], button').filter({
                    has: this.page.locator('svg')
                }).first();
                if (await closeButton.isVisible().catch(() => false)) {
                    await closeButton.click({ force: true });
                    continue;
                }
            }

            const skipRating = this.page.getByRole('button', { name: /Skip for now/i });
            if (await skipRating.isVisible().catch(() => false)) {
                await skipRating.click();
                continue;
            }

            const ownerApproval = this.page.getByRole('button', { name: /Okay, Got It/i });
            if (await ownerApproval.isVisible().catch(() => false)) {
                await ownerApproval.click();
                continue;
            }

            break;
        }
    }

    async openHome(path = '/') {
        await gotoAppRoute(this.page, `${BASE_URLS.customer}${path}`);
    }

    async openBookings(query = '') {
        await gotoAppRoute(this.page, `${BASE_URLS.customer}/bookings${query}`);
        await this.dismissBlockingOverlays();
    }

    async openProperty(propertyId: string) {
        await gotoAppRoute(this.page, `${BASE_URLS.customer}/property/${propertyId}`);
    }

    async search(term: string) {
        await this.openHome(`/?search=${encodeURIComponent(term)}`);
        await expect(this.page.getByText(new RegExp(`Results for "${term}"`, 'i'))).toBeVisible();
    }

    async reserveFirstVisibleRoom() {
        await this.dismissBlockingOverlays();

        const primaryRoomCtas = this.page.getByRole('button', { name: /Select Room/i });
        const teaserCtas = [
            this.page.getByRole('button', { name: /Reserve a Room|Reserve Now/i }).first(),
            this.page.getByRole('button', { name: /Select/i }).first(),
        ];
        const clickPrimaryRoomCta = async () => {
            const primaryRoomCta = await this.findVisibleAction(primaryRoomCtas);
            if (!primaryRoomCta) {
                return false;
            }

            await this.dismissBlockingOverlays();
            await primaryRoomCta.scrollIntoViewIfNeeded().catch(() => undefined);
            await primaryRoomCta.click({ force: true });
            return true;
        };

        if (await clickPrimaryRoomCta()) {
            return;
        }

        for (const cta of teaserCtas) {
            if (!(await cta.isVisible().catch(() => false))) {
                continue;
            }

            await cta.click();
            await this.dismissBlockingOverlays();

            if (/\/login(?:[/?#]|$)/i.test(this.page.url())) {
                return;
            }

            const roomCtaAttached = await primaryRoomCtas.last().waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);
            if (roomCtaAttached) {
                if (await clickPrimaryRoomCta()) {
                    return;
                }
                return;
            }
        }

        await primaryRoomCtas.last().waitFor({ state: 'attached', timeout: 15000 });
        await clickPrimaryRoomCta();
    }

    async requestVacate() {
        await this.dismissBlockingOverlays();
        const bookingCard = this.page.locator('.rfm-booking-card').filter({
            has: this.page.getByRole('button', { name: /^Vacate$/i })
        }).first();
        this.page.once('dialog', (dialog) => {
            void dialog.accept();
        });
        await bookingCard.getByRole('button', { name: /^Vacate$/i }).click();
    }

    async retryPendingBookingFresh() {
        await this.dismissBlockingOverlays();
        const bookingCard = this.page.locator('.rfm-booking-card').filter({
            has: this.page.getByRole('button', { name: /Retry Booking/i })
        }).first();
        await bookingCard.getByRole('button', { name: /Retry Booking/i }).click();
    }
}
