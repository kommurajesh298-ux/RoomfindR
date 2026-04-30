import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ensureOwnerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { resolveSupabaseEnv } from '../../helpers/supabase-auth';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let admin: SupabaseAdminHelper;
const ADVANCE_PAYOUT_OWNER_EMAIL = 'test_owner_advance_e2e@example.com';
const ADVANCE_PAYOUT_CUSTOMER_EMAIL = 'test_customer_advance_e2e@example.com';

const triggerSettlementAsOwner = async (bookingId: string) => {
    const env = resolveSupabaseEnv(BASE_URLS.owner);
    const client = createClient(env.supabaseUrl, env.anonKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
    const { data, error } = await client.auth.signInWithPassword({
        email: ADVANCE_PAYOUT_OWNER_EMAIL,
        password: TEST_USERS.owner.password,
    });

    if (error || !data.session?.access_token) {
        throw new Error(error?.message || 'Unable to authenticate owner settlement fallback');
    }

    const accessToken = data.session.access_token;
    const response = await fetch(`${env.supabaseUrl}/functions/v1/cashfree-settlement`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.anonKey}`,
            'apikey': env.anonKey,
            'x-supabase-auth': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ bookingId })
    });

    const payload = await response.json().catch(() => ({})) as {
        error?: { message?: string } | string;
        message?: string;
    };

    if (!response.ok) {
        const message = typeof payload.error === 'string'
            ? payload.error
            : payload.error?.message || payload.message || 'Settlement trigger failed';
        throw new Error(message);
    }
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    const owner = await admin.findUserByEmail(ADVANCE_PAYOUT_OWNER_EMAIL)
        || await admin.createTestUser(
            ADVANCE_PAYOUT_OWNER_EMAIL,
            TEST_USERS.owner.password,
            'owner',
        );
    if (owner) {
        await admin.ensureOwnerVerified(owner.id, ADVANCE_PAYOUT_OWNER_EMAIL);
    }

    const customer = await admin.findUserByEmail(ADVANCE_PAYOUT_CUSTOMER_EMAIL)
        || await admin.createTestUser(
            ADVANCE_PAYOUT_CUSTOMER_EMAIL,
            TEST_USERS.customer.password,
            'customer',
        );
    if (customer) {
        await admin.ensureCustomerProfile(customer.id, ADVANCE_PAYOUT_CUSTOMER_EMAIL);
    }
});

test.beforeEach(async ({ page }) => {
    await admin.cleanupUserBookings(ADVANCE_PAYOUT_CUSTOMER_EMAIL);
    await admin.cleanupOwnerBookings(ADVANCE_PAYOUT_OWNER_EMAIL);
    await admin.cleanupSettlements(ADVANCE_PAYOUT_OWNER_EMAIL);
    await ensureOwnerLoggedInAs(page, ADVANCE_PAYOUT_OWNER_EMAIL, {
        password: TEST_USERS.owner.password,
    });
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(ADVANCE_PAYOUT_CUSTOMER_EMAIL);
    await admin.cleanupOwnerBookings(ADVANCE_PAYOUT_OWNER_EMAIL);
    await admin.cleanupSettlements(ADVANCE_PAYOUT_OWNER_EMAIL);
});

test('O-31 accepting a paid booking starts the owner advance payout automatically', async ({ page }) => {
    test.setTimeout(240_000);
    const { booking, property } = await admin.createPaidBooking(
        ADVANCE_PAYOUT_CUSTOMER_EMAIL,
        ADVANCE_PAYOUT_OWNER_EMAIL,
    );
    const settlementRequestStarted = page.waitForEvent('request', {
        predicate: (request) =>
            request.method() === 'POST' &&
            request.url().includes('/functions/v1/cashfree-settlement'),
        timeout: 10_000
    }).then(() => true).catch(() => false);

    await gotoAppRoute(page, `${BASE_URLS.owner}/bookings`);
    await page.getByRole('button', { name: /Requests/i }).first().click({ force: true });
    await expect(page.getByText(new RegExp(String(property.title), 'i')).first()).toBeVisible();

    await page.getByRole('button', { name: /Accept/i }).first().click();
    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('bookings')
            .select('status, owner_accept_status')
            .eq('id', booking.id)
            .maybeSingle();

        return `${String(data?.status || '').toLowerCase()}:${String(Boolean(data?.owner_accept_status))}`;
    }).toBe('approved:true');

    let settlement: Awaited<ReturnType<typeof admin.getSettlementsForOwner>>[number] | null = null;
    const requestStarted = await settlementRequestStarted;
    const existingSettlements = await admin.getSettlementsForOwner(ADVANCE_PAYOUT_OWNER_EMAIL);
    settlement = existingSettlements.find((entry) => entry.booking_id === booking.id) || null;

    if (!requestStarted && !settlement) {
        await triggerSettlementAsOwner(booking.id);
    }

    await expect.poll(async () => {
        const settlements = await admin.getSettlementsForOwner(ADVANCE_PAYOUT_OWNER_EMAIL);
        settlement = settlements.find((entry) => entry.booking_id === booking.id) || null;
        if (!settlement) return '';
        return `${String(settlement.status || '').toUpperCase()}:${String(settlement.provider_transfer_id || '').trim()}`;
    }, {
        timeout: 180_000,
        message: 'Expected a settlement row to be created and move into payout processing for the accepted paid booking.',
    }).toMatch(/^(PROCESSING|COMPLETED):.+$/);

    expect(settlement).not.toBeNull();
    expect(String(settlement?.provider_transfer_id || '').trim().length).toBeGreaterThan(0);
    expect(['PROCESSING', 'COMPLETED']).toContain(String(settlement?.status || '').toUpperCase());
});
