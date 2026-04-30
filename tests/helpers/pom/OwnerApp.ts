import { expect, type Page } from '@playwright/test';
import { gotoAppRoute } from '../app-shell';
import { BASE_URLS } from '../e2e-config';

export class OwnerApp {
    constructor(private readonly page: Page) {}

    async openDashboard() {
        await gotoAppRoute(this.page, `${BASE_URLS.owner}/dashboard`);
    }

    async openBookings() {
        await gotoAppRoute(this.page, `${BASE_URLS.owner}/bookings`);
    }

    async openProperties() {
        await gotoAppRoute(this.page, `${BASE_URLS.owner}/properties`);
    }

    async acceptBooking(propertyTitle: string) {
        const card = this.page.locator('div.bg-white.rounded-2xl').filter({ hasText: propertyTitle }).first();
        await expect(card).toBeVisible();
        await card.getByRole('button', { name: /Accept/i }).click();
    }

    async rejectBooking(propertyTitle: string, reason = 'Room unavailable') {
        const card = this.page.locator('div.bg-white.rounded-2xl').filter({ hasText: propertyTitle }).first();
        await expect(card).toBeVisible();
        await card.getByRole('button', { name: /^Reject$/i }).click();
        await this.page.getByLabel(/Reason for rejection/i).selectOption(reason);
        await this.page.getByRole('button', { name: /Reject Booking/i }).click();
    }

    async deleteProperty(title: string) {
        const card = this.page.getByRole('heading', { name: title, exact: true })
            .locator('xpath=ancestor::div[contains(@class,"group")][1]');
        await expect(card).toBeVisible();
        await card.getByTitle(/Delete Property/i).click();
        await this.page.getByRole('button', { name: /^Delete$/i }).click();
    }
}
