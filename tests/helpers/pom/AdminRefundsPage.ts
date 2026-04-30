import { expect, type Page } from '@playwright/test';
import { gotoAppRoute } from '../app-shell';
import { BASE_URLS } from '../e2e-config';

export class AdminRefundsPage {
    constructor(private readonly page: Page) {}

    async open() {
        await gotoAppRoute(this.page, `${BASE_URLS.admin}/refunds`);
    }

    async approveRefund(bookingCode: string) {
        const row = this.page.locator('tr').filter({ hasText: bookingCode }).first();
        await expect(row).toBeVisible();
        await row.getByRole('button', { name: /^Review$/i }).click();
        await this.page.getByRole('button', { name: /Approve Refund/i }).click();
    }
}
