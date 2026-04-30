import { expect, type Page } from '@playwright/test';
import { gotoAppRoute } from '../app-shell';
import { BASE_URLS } from '../e2e-config';

export class AdminOwnersPage {
    constructor(private readonly page: Page) {}

    async open() {
        await gotoAppRoute(this.page, `${BASE_URLS.admin}/owners`);
    }

    async approveOwner(email: string) {
        const card = this.page.getByText(email, { exact: true })
            .locator('xpath=ancestor::div[contains(@class,"bg-white")][1]');
        await expect(card).toBeVisible();
        await card.getByTitle(/Approve Owner/i).click();
        await this.page.getByRole('button', { name: /Approve Partner/i }).click();
    }

    async rejectOwner(email: string, reason = 'Duplicate account') {
        const card = this.page.getByText(email, { exact: true })
            .locator('xpath=ancestor::div[contains(@class,"bg-white")][1]');
        await expect(card).toBeVisible();
        await card.getByTitle(/Reject Owner/i).click();
        await this.page.getByLabel(/Select Reason/i).selectOption(reason);
        await this.page.getByRole('button', { name: /Confirm Rejection/i }).click();
    }
}
