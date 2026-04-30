import { expect, test } from '@playwright/test';
import { ensureAdminLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
let createdOfferCode = '';

const cleanupOfferByCode = async (code: string) => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return;

    const { data: offer } = await admin.supabase
        .from('offers')
        .select('id')
        .eq('code', normalizedCode)
        .maybeSingle();

    if (offer?.id) {
        await admin.supabase
            .from('claimed_offers')
            .delete()
            .eq('offer_id', offer.id);
    }

    await admin.supabase
        .from('offers')
        .delete()
        .eq('code', normalizedCode);
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
});

test.afterEach(async () => {
    await cleanupOfferByCode(createdOfferCode);
    createdOfferCode = '';
});

test.beforeEach(async ({ page }) => {
    await ensureAdminLoggedIn(page);
});

test('A-21 admins can create a platform coupon from the offers dashboard', async ({ page }) => {
    createdOfferCode = `ADM${Date.now().toString().slice(-8)}`;
    const expiryDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

    await gotoAppRoute(page, `${BASE_URLS.admin}/offers`);
    await expect(page.getByText(/Offers & Promotions/i)).toBeVisible();

    await page.getByRole('button', { name: /^Create Offer$/i }).first().click();

    const form = page.locator('form').last();
    await expect(form).toBeVisible();

    await form.locator('input[placeholder="SUMMER20"]').fill(createdOfferCode);
    await form.locator('input[placeholder="Summer Sale"]').fill('Admin Offer Smoke Test');
    await form.locator('input[placeholder="Get 20% off on your first booking"]').fill('Created from admin E2E validation');
    await form.locator('select').selectOption('flat');
    await form.locator('input[placeholder="20"]').fill('350');
    await form.locator('input[placeholder="500"]').fill('350');
    await form.locator('input[placeholder="0"]').fill('500');
    await form.locator('input[placeholder="100"]').fill('20');
    await form.locator('input[type="date"]').fill(expiryDate);
    await form.getByRole('button', { name: /^Create Offer$/i }).click();

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('offers')
            .select('code, discount_type, discount_value, min_booking_amount, is_active')
            .eq('code', createdOfferCode)
            .maybeSingle();

        if (!data) return '';
        return [
            data.code,
            data.discount_type,
            Number(data.discount_value || 0),
            Number(data.min_booking_amount || 0),
            Boolean(data.is_active),
        ].join('|');
    }, {
        timeout: 15000,
        message: 'Expected the admin-created platform offer to persist in Supabase.',
    }).toBe(`${createdOfferCode}|fixed|350|500|true`);

    await gotoAppRoute(page, `${BASE_URLS.admin}/offers`);
    await page.getByPlaceholder(/Search offers by code or title/i).fill(createdOfferCode);
    await expect.poll(async () => (await page.locator('main').textContent()) || '', {
        timeout: 15000,
        message: 'Expected the admin offers page to render the freshly created coupon after reload.',
    }).toContain(createdOfferCode);
    await expect(page.getByText(createdOfferCode).first()).toBeVisible();
    await expect(page.getByText(/Admin Offer Smoke Test/i)).toBeVisible();
    await expect(page.getByText(/₹350 Flat/i)).toBeVisible();
});
