import { expect, test } from '@playwright/test';
import { ensureLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let admin: SupabaseAdminHelper;
let propertyId = '';
let propertyTitle = '';
let customerId = '';
let ownerId = '';
const customerEmail = `chat-customer-${Date.now()}@example.com`;
const ownerEmail = `chat-owner-${Date.now()}@example.com`;

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

const cleanupChatRows = async () => {
    const { data: chats } = await admin.supabase
        .from('chats')
        .select('id')
        .eq('property_id', propertyId);
    const chatIds = (chats || []).map((chat) => String(chat.id));
    if (chatIds.length > 0) {
        await admin.supabase.from('messages').delete().in('chat_id', chatIds);
        await admin.supabase.from('chats').delete().in('id', chatIds);
    }
};

const seedCommunityChat = async (options?: { lastMessage?: string; unreadCount?: number; initialMessage?: string }) => {
    if (!customerId) {
        throw new Error('Customer id was not initialized for chat seeding.');
    }

    const lastMessage = options?.lastMessage || `E2E chat ${Date.now()}`;
    const unreadCount = options?.unreadCount ?? 0;
    const { data: existing } = await admin.supabase
        .from('chats')
        .select('id')
        .eq('property_id', propertyId)
        .contains('participants', [customerId])
        .limit(1)
        .maybeSingle();

    const basePayload = {
        property_id: propertyId,
        participants: ownerId ? [customerId, ownerId] : [customerId],
        last_message: lastMessage,
        last_message_time: new Date().toISOString(),
        unread_counts: unreadCount > 0 ? { [customerId]: unreadCount } : {},
        title: propertyTitle
    };

    const chatId = existing?.id
        ? String(existing.id)
        : String((await admin.supabase.from('chats').insert(basePayload).select('id').single()).data?.id);

    if (existing?.id) {
        await admin.supabase.from('chats').update(basePayload).eq('id', chatId);
    }

    if (options?.initialMessage) {
        await admin.supabase.from('messages').insert({
            chat_id: chatId,
            sender_id: ownerId,
            content: options.initialMessage,
            message_type: 'text',
            is_read: false
        });
    }

    return chatId;
};

const seedResidentBooking = async () => {
    if (!customerId || !ownerId || !propertyId) {
        throw new Error('Resident booking seed is missing customer, owner, or property ids.');
    }

    const today = new Date();
    const checkout = new Date(today);
    checkout.setDate(checkout.getDate() + 30);
    const seeded = await admin.createPaidBooking(customerEmail, ownerEmail);

    const { error: bookingError } = await admin.supabase
        .from('bookings')
        .update({
            status: 'checked-in',
            payment_status: 'paid',
            admin_approved: false,
            start_date: today.toISOString().split('T')[0],
            end_date: checkout.toISOString().split('T')[0],
        })
        .eq('id', seeded.booking.id);

    if (bookingError) {
        throw new Error(`Failed to update resident booking: ${bookingError.message}`);
    }

    return seeded.booking;
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    const owner = await admin.createTestUser(ownerEmail, TEST_USERS.owner.password, 'owner');
    const customer = await admin.createTestUser(customerEmail, TEST_USERS.customer.password, 'customer');
    if (!owner?.id || !customer?.id) {
        throw new Error('Failed to initialize customer and owner test accounts for chat tests.');
    }
    await admin.ensureOwnerVerified(owner.id, ownerEmail);
    await admin.ensureCustomerProfile(customer.id, customerEmail);
    await admin.cleanupUserBookings(customerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
    const { property } = await admin.createPropertyWithRoom(ownerEmail, {
        title: `E2E Chat ${Date.now()}`,
        status: 'published'
    });
    propertyId = String(property.id);
    propertyTitle = String(property.title);
    customerId = customer.id;
    ownerId = owner.id;
});

test.afterAll(async () => {
    await cleanupChatRows();
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
    await cleanupChatRows();
    await admin.cleanupUserBookings(customerEmail);
    await ensureLoggedIn(page, {
        role: 'customer',
        email: customerEmail,
        baseUrl: BASE_URLS.customer,
        postLoginPath: '/chat'
    });
});

test('C-21 the customer chat route renders the Messages shell', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.customer}/chat`);
    await expect(page.getByRole('heading', { name: /Messages/i }).first()).toBeVisible();
});

test('C-22 the customer chat route renders the conversation sidebar', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.customer}/chat`);
    await expect(page.getByText(/Your Conversations/i).first()).toBeVisible();
});

test('C-23 seeded chats appear in the chat sidebar and can be opened', async ({ page }) => {
    await seedResidentBooking();
    const chatId = await seedCommunityChat({ lastMessage: 'Community conversation ready' });

    await gotoAppRoute(page, `${BASE_URLS.customer}/chat/${chatId}`);
    await dismissRatingPopupIfPresent(page);
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
});

test('C-24 opening a seeded chat renders the conversation skeleton and composer', async ({ page }) => {
    await seedResidentBooking();
    const chatId = await seedCommunityChat({ lastMessage: 'Composer ready' });

    await gotoAppRoute(page, `${BASE_URLS.customer}/chat/${chatId}`);
    await dismissRatingPopupIfPresent(page);
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    await expect(page.getByText(new RegExp(propertyTitle, 'i')).first()).toBeVisible();
});

test('C-25 customers can send a message from an opened seeded conversation', async ({ page }) => {
    await seedResidentBooking();
    const chatId = await seedCommunityChat({ lastMessage: 'Send a reply' });

    await gotoAppRoute(page, `${BASE_URLS.customer}/chat/${chatId}`);
    await dismissRatingPopupIfPresent(page);

    const messageText = `Playwright customer message ${Date.now()}`;
    await page.getByPlaceholder('Type a message...').fill(messageText);
    await page.locator('form').filter({ has: page.getByPlaceholder('Type a message...') }).getByRole('button').last().click();
    await expect(page.getByText(messageText).first()).toBeVisible();
});

test('C-26 seeded owner messages render inside the conversation timeline', async ({ page }) => {
    const seededMessage = `Owner seeded message ${Date.now()}`;
    await seedResidentBooking();
    const chatId = await seedCommunityChat({ lastMessage: seededMessage, initialMessage: seededMessage });

    await gotoAppRoute(page, `${BASE_URLS.customer}/chat/${chatId}`);
    await dismissRatingPopupIfPresent(page);
    await expect(page.getByText(seededMessage).first()).toBeVisible();
});

test('C-27 unread chat badges render when the chat row is seeded with unread counts', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedCommunityChat({ lastMessage: 'Unread badge check', unreadCount: 3 });

    await gotoAppRoute(page, `${BASE_URLS.customer}/`);
    await expect(page.locator('.rfm-bottom-nav').getByText('3').first()).toBeVisible();
});
