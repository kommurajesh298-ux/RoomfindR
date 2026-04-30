import { expect, test } from '@playwright/test';
import { ensureLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';
import { expectToStayVisible } from '../../utils/wait';

let admin: SupabaseAdminHelper;
let propertyId = '';
let ownerId = '';
let customerId = '';
const customerEmail = `portal-customer-${Date.now()}@example.com`;
const ownerEmail = `portal-owner-${Date.now()}@example.com`;

const dismissRatingPopupIfPresent = async (page: import('@playwright/test').Page) => {
    const skipButton = page.getByRole('button', { name: /Skip for now/i });
    const popupHeading = page.getByRole('heading', { name: /Welcome Home!/i });

    if (!(await popupHeading.isVisible().catch(() => false))) {
        await popupHeading.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
    }

    if (await skipButton.isVisible().catch(() => false)) {
        await skipButton.click({ force: true });
        await popupHeading.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    }
};

const seedCheckedInBooking = async () => {
    if (!propertyId || !ownerId || !customerId) {
        throw new Error('Portal booking seed is missing customer, owner, or property ids.');
    }

    const today = new Date();
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 1);
    const nextPaymentDate = new Date();
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    const seeded = await admin.createPaidBooking(customerEmail, ownerEmail);

    await admin.supabase
        .from('bookings')
        .update({
            status: 'checked-in',
            payment_status: 'paid',
            admin_approved: false,
            start_date: today.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
            next_payment_date: nextPaymentDate.toISOString()
        })
        .eq('id', seeded.booking.id);
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    const owner = await admin.createTestUser(ownerEmail, TEST_USERS.owner.password, 'owner');
    const customer = await admin.createTestUser(customerEmail, TEST_USERS.customer.password, 'customer');
    if (!owner?.id || !customer?.id) {
        throw new Error('Failed to initialize customer and owner test accounts for portal tests.');
    }
    await admin.ensureOwnerVerified(owner.id, ownerEmail);
    await admin.ensureCustomerProfile(customer.id, customerEmail);
    ownerId = owner.id;
    customerId = customer.id;

    await admin.cleanupUserBookings(customerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
    const { property } = await admin.createPropertyWithRoom(ownerEmail, {
        title: `Portal Property ${Date.now()}`,
        status: 'published'
    });
    propertyId = String(property.id);
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(customerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
    await admin.supabase.from('customers').delete().eq('id', customerId);
    await admin.cleanupOwnerVerificationArtifacts(ownerId);
    await admin.supabase.from('owners').delete().eq('id', ownerId);
    await admin.supabase.from('accounts').delete().in('id', [customerId, ownerId]);
    await admin.deleteTestUser(customerEmail);
    await admin.deleteTestUser(ownerEmail);
});

test.beforeEach(async ({ page }) => {
    await admin.cleanupUserBookings(customerEmail);
    await ensureLoggedIn(page, {
        role: 'customer',
        email: customerEmail,
        baseUrl: BASE_URLS.customer,
        postLoginPath: '/'
    });
    await page.setViewportSize({ width: 390, height: 844 });
});

test('C-28 resident portal tabs scroll vertically while keeping the top filters visible', async ({ page }) => {
    await seedCheckedInBooking();

    await gotoAppRoute(page, `${BASE_URLS.customer}/chat`);
    await dismissRatingPopupIfPresent(page);
    await page.getByRole('button', { name: /^My PG$/i }).click();
    await expect(page.getByText(/Active Stay/i)).toBeVisible();

    const initialScrollTop = await page.evaluate(() => document.scrollingElement?.scrollTop || window.scrollY);
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'auto' }));
    await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop || window.scrollY)).toBeGreaterThan(initialScrollTop);

    const afterScrollTop = await page.evaluate(() => document.scrollingElement?.scrollTop || window.scrollY);
    expect(afterScrollTop).toBeGreaterThan(initialScrollTop);

    await expectToStayVisible(page.getByRole('button', { name: /^My PG$/i }));
    await expect(page.getByRole('heading', { name: /^Residents \(\d+\)$/i })).toBeVisible();
});

test('C-29 resident portal community tab opens the community chat screen', async ({ page }) => {
    await seedCheckedInBooking();
    await page.setViewportSize({ width: 375, height: 592 });
    let browserDialogSeen = false;
    page.on('dialog', async (dialog) => {
        browserDialogSeen = true;
        await dialog.dismiss();
    });

    await gotoAppRoute(page, `${BASE_URLS.customer}/chat`);
    await dismissRatingPopupIfPresent(page);
    await page.getByRole('button', { name: /^Community$/i }).click();

    const composerInput = page.getByPlaceholder('Type a message...');
    const messageScroller = page.getByTestId('community-messages-scroll');
    await expect(composerInput).toBeVisible();
    for (let i = 0; i < 6; i += 1) {
        await composerInput.fill(`community message ${i} ${Date.now()}`);
        await page.locator('form').filter({ has: composerInput }).getByRole('button').last().click();
    }

    const initialWindowScroll = await page.evaluate(() => document.scrollingElement?.scrollTop || window.scrollY);
    const initialMessageScroll = await messageScroller.evaluate((node) => node.scrollTop);

    await messageScroller.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
    });
    await expect.poll(() => messageScroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(initialMessageScroll);

    const finalWindowScroll = await page.evaluate(() => document.scrollingElement?.scrollTop || window.scrollY);
    const finalMessageScroll = await messageScroller.evaluate((node) => node.scrollTop);

    expect(finalWindowScroll).toBe(initialWindowScroll);
    expect(finalMessageScroll).toBeGreaterThan(initialMessageScroll);
    await expect(composerInput).toBeVisible();
    await expect(page.getByRole('button', { name: /^Community$/i })).toBeVisible();

    await page.getByRole('button', { name: /chat options/i }).click();
    await page.getByRole('button', { name: /^Delete Chat$/i }).click();
    await expect(page.getByRole('heading', { name: /Remove this conversation\?/i })).toBeVisible();
    expect(browserDialogSeen).toBe(false);
    await page.getByRole('button', { name: /^Cancel$/i }).click();
    await expect(page.getByRole('heading', { name: /Remove this conversation\?/i })).not.toBeVisible();
});

test('C-30 resident portal room food notices and payments tabs switch correctly on mobile', async ({ page }) => {
    await seedCheckedInBooking();
    await page.setViewportSize({ width: 375, height: 592 });

    await gotoAppRoute(page, `${BASE_URLS.customer}/chat`);
    await dismissRatingPopupIfPresent(page);

    await page.getByRole('button', { name: /^Room$/i }).click();
    await expect(page.getByText(/^Suite /i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /In-Room Features/i })).toBeVisible();

    await page.getByRole('button', { name: /^Food$/i }).click();
    await expect(page.getByRole('heading', { name: /Weekly Menu/i })).toBeVisible();

    await page.getByRole('button', { name: /^Notices$/i }).click();
    await expect(page.getByText(/Property Notices/i)).toBeVisible();

    await page.getByRole('button', { name: /^Payments$/i }).click();
    await expect.poll(async () => {
        const mainText = (await page.locator('main').textContent()) || '';
        const spinnerVisible = await page.locator('main .animate-spin').first().isVisible().catch(() => false);
        return spinnerVisible ? 'loading' : mainText;
    }, { timeout: 30000 }).toMatch(
        /loading|Current Payment|Payment History|Rent\/Month|No verified rent payments yet/i
    );
});
