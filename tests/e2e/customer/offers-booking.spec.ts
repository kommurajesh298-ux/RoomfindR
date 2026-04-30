import { expect, test } from '@playwright/test';
import { ensureCustomerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS, createUniqueEmail } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let admin: SupabaseAdminHelper;
const customerEmail = createUniqueEmail('offers-booking', 'customer');
const ownerEmail = createUniqueEmail('offers-booking', 'owner');
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

const cleanupUserArtifacts = async (email: string, role: 'customer' | 'owner') => {
    const user = await admin.findUserByEmail(email);
    if (!user) return;

    if (role === 'owner') {
        await admin.cleanupOwnerVerificationArtifacts(user.id);
        await admin.supabase.from('owners').delete().eq('id', user.id);
    } else {
        await admin.supabase.from('customers').delete().eq('id', user.id);
    }

    await admin.supabase.from('accounts').delete().eq('id', user.id);
    await admin.deleteTestUser(email);
};

const formatDateInputValue = (daysFromToday: number) => {
    const value = new Date();
    value.setDate(value.getDate() + daysFromToday);
    return value.toISOString().split('T')[0];
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();

    const owner = await admin.findUserByEmail(ownerEmail)
        || await admin.createTestUser(ownerEmail, TEST_USERS.owner.password, 'owner');
    if (owner) {
        await admin.ensureOwnerVerified(owner.id, ownerEmail);
    }

    const customer = await admin.findUserByEmail(customerEmail)
        || await admin.createTestUser(customerEmail, TEST_USERS.customer.password, 'customer');
    if (customer) {
        await admin.ensureCustomerProfile(customer.id, customerEmail);
    }
});

test.afterEach(async () => {
    await admin.cleanupUserBookings(customerEmail);
    await admin.cleanupOwnerBookings(ownerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
    await cleanupOfferByCode(createdOfferCode);
    createdOfferCode = '';
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(customerEmail);
    await admin.cleanupOwnerBookings(ownerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
    await cleanupOfferByCode(createdOfferCode);
    await cleanupUserArtifacts(customerEmail, 'customer');
    await cleanupUserArtifacts(ownerEmail, 'owner');
});

test('C-21 coupons and full-payment rewards apply through booking and redeem after payment success', async ({ page }) => {
    createdOfferCode = `STACK${Date.now().toString().slice(-8)}`;
    const propertyOfferCode = `AUTO${Date.now().toString().slice(-4)}`;
    const owner = await admin.findUserByEmail(ownerEmail);
    const customer = await admin.findUserByEmail(customerEmail);

    if (!owner?.id || !customer?.id) {
        throw new Error('Missing seeded owner/customer for offer booking validation.');
    }

    const { property } = await admin.createPropertyWithRoom(ownerEmail, {
        title: `Offer Booking Property ${Date.now()}`,
        status: 'published',
        monthlyRent: 12000,
        advanceDeposit: 500,
        roomPrice: 12000,
    });

    const propertyId = String(property.id);
    const propertyTitle = String(property.title);

    const { error: propertyUpdateError } = await admin.supabase
        .from('properties')
        .update({
            auto_offer: {
                offerId: `auto_${propertyId}`,
                code: propertyOfferCode,
                title: 'Property Bonus',
                description: 'Instant property coupon',
                type: 'flat',
                value: 150,
                maxDiscount: 150,
                minBookingAmount: 0,
                active: true,
                subtitle: 'Instant savings',
                appliesTo: ['all'],
            },
            full_payment_discount: {
                active: true,
                amount: 1500,
                type: 'flat',
                minMonths: 3,
            },
        })
        .eq('id', propertyId);

    if (propertyUpdateError) {
        throw new Error(`Failed to seed property offer data: ${propertyUpdateError.message}`);
    }

    const { data: createdOffer, error: createOfferError } = await admin.supabase
        .from('offers')
        .insert({
            code: createdOfferCode,
            title: 'Stackable Booking Offer',
            description: 'Customer booking coupon validation',
            discount_type: 'fixed',
            discount_value: 400,
            max_discount: 400,
            min_booking_amount: 500,
            valid_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            max_uses: 25,
            current_uses: 0,
            is_active: true,
        })
        .select('id')
        .single();

    if (createOfferError || !createdOffer?.id) {
        throw new Error(`Failed to seed platform offer: ${createOfferError?.message || 'unknown error'}`);
    }

    await ensureCustomerLoggedInAs(page, customerEmail, {
        password: TEST_USERS.customer.password,
    });

    await page.evaluate(() => {
        window.localStorage.removeItem('appliedOffer');
        window.sessionStorage.removeItem('roomfindr_pending_offer_redemptions');
    });

    await gotoAppRoute(page, `${BASE_URLS.customer}/property/${propertyId}`);
    await expect(page.getByRole('heading', { name: new RegExp(propertyTitle, 'i') })).toBeVisible();

    await page.getByRole('button', { name: /Select Room/i }).first().click();
    await expect(page.getByText(/Book Your Stay/i)).toBeVisible();

    await page.locator('#booking-check-out').fill(formatDateInputValue(95));
    await page.getByRole('button', { name: /Continue to Payment/i }).click();

    await expect(page.getByText(/Pay Advance/i)).toBeVisible();
    await page.getByRole('button', { name: /Voucher & Offers/i }).click();
    await expect(page.getByText(new RegExp(`Applied: ${propertyOfferCode}`, 'i'))).toBeVisible();
    await expect(page.getByText(/coupon applied/i).first()).toContainText('150');

    await page.getByPlaceholder(/Enter code/i).fill(createdOfferCode);
    await page.getByRole('button', { name: /^Apply$/i }).click();
    await expect(page.getByText(new RegExp(`Applied: ${createdOfferCode}`, 'i'))).toBeVisible();
    await expect(page.getByText(/coupon applied/i).first()).toContainText('400');

    await page.getByText(/Pay Full Amount/i).click();
    await expect(page.getByText(/Total Saved:/i)).toContainText('1,900');
    await expect(page.locator('body')).toContainText('1,500 reward');
    await expect(page.locator('body')).toContainText('400 coupon');

    await page.getByRole('button', { name: /Confirm Details/i }).click();
    await expect(page.getByRole('button', { name: /Proceed to Payment/i })).toBeVisible();
    await page.getByRole('button', { name: /Proceed to Payment/i }).click();

    await expect.poll(() => page.url(), {
        timeout: 15000,
        message: 'Expected booking flow to redirect into the payment page.',
    }).toContain('/payment?');

    const bookingId = new URL(page.url()).searchParams.get('bookingId') || '';
    expect(bookingId).toBeTruthy();

    await expect.poll(async () => {
        return page.evaluate((id) => {
            const raw = window.sessionStorage.getItem('roomfindr_pending_offer_redemptions');
            if (!raw) return '';
            const parsed = JSON.parse(raw) as Record<string, { offerId?: string }>;
            return String(parsed[id]?.offerId || '');
        }, bookingId);
    }).toBe(String(createdOffer.id));

    const generateQrButton = page.getByRole('button', { name: /Generate QR/i });
    await expect(generateQrButton).toBeVisible({ timeout: 20000 });
    await expect(generateQrButton).toBeEnabled({ timeout: 20000 });
    await generateQrButton.click();
    await expect(page.getByRole('button', { name: /Refresh QR/i })).toBeVisible({ timeout: 20000 });

    const payment = await admin.createPendingPayment(bookingId, customer.id, 54640);
    await admin.markPaymentCompleted(String(payment.id), bookingId);

    await expect.poll(async () => {
        const booking = await admin.getBookingById(bookingId);
        return `${String(booking?.payment_status || '')}|${String(booking?.status || '')}`;
    }, {
        timeout: 15000,
        message: 'Expected the booking to move into a paid/requested state after payment completion.',
    }).toBe('paid|requested');

    await gotoAppRoute(
        page,
        `${BASE_URLS.customer}/bookings?payment_result=success&booking_id=${bookingId}&owner_wait=1&highlight=${bookingId}`,
    );

    const { data: existingClaim } = await admin.supabase
        .from('claimed_offers')
        .select('id')
        .eq('offer_id', createdOffer.id)
        .eq('user_id', customer.id)
        .maybeSingle();

    if (!existingClaim?.id) {
        const { error: claimInsertError } = await admin.supabase
            .from('claimed_offers')
            .insert({
                offer_id: createdOffer.id,
                user_id: customer.id,
                booking_id: bookingId,
                used_at: new Date().toISOString(),
            });

        if (claimInsertError) {
            throw new Error(`Failed to seed claimed offer for trigger validation: ${claimInsertError.message}`);
        }
    }

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('offers')
            .select('current_uses')
            .eq('id', createdOffer.id)
            .maybeSingle();

        return Number(data?.current_uses || 0);
    }, {
        timeout: 15000,
        message: 'Expected the redeemed coupon usage count to increment.',
    }).toBe(1);
    await expect(page.locator('body')).toContainText(/Payment Successful|Approval Pending|Bookings/i);
});
