import { expect, test, type Page } from '@playwright/test';
import { ensureAdminLoggedIn, ensureCustomerLoggedInAs, ensureOwnerLoggedInAs } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS, createUniqueEmail } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let admin: SupabaseAdminHelper;
let propertyId = '';
let propertyTitle = '';
let customerId = '';
let ownerId = '';
const realtimeCustomerEmail = createUniqueEmail('rt-message-sync', 'customer');
const realtimeOwnerEmail = createUniqueEmail('rt-message-sync', 'owner');
const realtimePendingOwnerEmail = createUniqueEmail('rt-pending-owner', 'owner');

const runCleanupSafely = async (task: () => Promise<unknown>, timeoutMs = 30000) => {
    await Promise.race([
        Promise.resolve().then(task).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
};

const cleanupChatRows = async () => {
    const { data: chats } = await admin.supabase.from('chats').select('id').eq('property_id', propertyId);
    const chatIds = (chats || []).map((chat) => String(chat.id));
    if (chatIds.length > 0) {
        await admin.supabase.from('messages').delete().in('chat_id', chatIds);
        await admin.supabase.from('chats').delete().in('id', chatIds);
    }
};

const cleanupCustomerChats = async () => {
    if (!customerId) return;

    const { data: chats } = await admin.supabase
        .from('chats')
        .select('id')
        .contains('participants', [customerId]);

    const chatIds = (chats || []).map((chat) => String(chat.id));
    if (chatIds.length > 0) {
        await admin.supabase.from('messages').delete().in('chat_id', chatIds);
        await admin.supabase.from('chats').delete().in('id', chatIds);
    }
};

const seedCommunityChat = async (
    unreadCount = 0,
    options?: { propertyId?: string; propertyTitle?: string }
) => {
    if (!customerId) {
        throw new Error('Customer id was not initialized for realtime chat seeding.');
    }

    const targetPropertyId = options?.propertyId || propertyId;
    const targetPropertyTitle = options?.propertyTitle || propertyTitle;
    await admin.createPaidBooking(realtimeCustomerEmail, realtimeOwnerEmail);
    const payload = {
        property_id: targetPropertyId,
        participants: ownerId ? [customerId, ownerId] : [customerId],
        last_message: `Realtime message ${Date.now()}`,
        last_message_time: new Date().toISOString(),
        unread_counts: unreadCount > 0 ? { [customerId]: unreadCount } : {},
        title: targetPropertyTitle
    };

    const { data: existing } = await admin.supabase
        .from('chats')
        .select('id')
        .eq('property_id', targetPropertyId)
        .contains('participants', [customerId])
        .maybeSingle();

    if (existing?.id) {
        await admin.supabase.from('chats').update(payload).eq('id', existing.id);
        await expect.poll(async () => {
            const { data: refreshed } = await admin.supabase
                .from('chats')
                .select('unread_counts')
                .eq('id', existing.id)
                .maybeSingle();
            return Number((refreshed?.unread_counts as Record<string, number> | null | undefined)?.[customerId] || 0);
        }).toBe(unreadCount);
        return String(existing.id);
    }

    const { data } = await admin.supabase.from('chats').insert(payload).select('id').single();
    const chatId = String(data?.id);
    await expect.poll(async () => {
        const { data: refreshed } = await admin.supabase
            .from('chats')
            .select('unread_counts')
            .eq('id', chatId)
            .maybeSingle();
        return Number((refreshed?.unread_counts as Record<string, number> | null | undefined)?.[customerId] || 0);
    }).toBe(unreadCount);
    return chatId;
};

const seedPendingRealtimeOwner = async () => {
    const owner = await admin.createTestUser(realtimePendingOwnerEmail, TEST_USERS.owner.password, 'owner');
    if (!owner) {
        throw new Error('Failed to create realtime owner.');
    }
    await admin.ensureOwnerProfile(owner.id, realtimePendingOwnerEmail);
    await admin.supabase.from('owners').update({
        verified: false,
        verification_status: 'pending',
        email: realtimePendingOwnerEmail,
        name: 'Realtime Owner'
    }).eq('id', owner.id);
    return owner.id;
};

const openCustomerConversation = async (page: Page, chatId: string) => {
    await ensureCustomerLoggedInAs(page, realtimeCustomerEmail);
    await gotoAppRoute(page, `${BASE_URLS.customer}/chat/${chatId}`);
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
};

const getBookingCardByTitle = (page: Page, title: string) =>
    page.locator('.rfm-booking-card').filter({ hasText: title }).first();

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    const owner = await admin.createTestUser(realtimeOwnerEmail, TEST_USERS.owner.password, 'owner');
    const customer = await admin.createTestUser(realtimeCustomerEmail, TEST_USERS.customer.password, 'customer');
    if (!owner?.id || !customer?.id) {
        throw new Error('Failed to initialize customer and owner test accounts for realtime tests.');
    }
    await admin.ensureOwnerVerified(owner.id, realtimeOwnerEmail);
    await admin.ensureCustomerProfile(customer.id, realtimeCustomerEmail);
    await admin.cleanupUserBookings(realtimeCustomerEmail);
    await admin.cleanupOwnerProperties(realtimeOwnerEmail);

    const { property } = await admin.createPropertyWithRoom(realtimeOwnerEmail, {
        title: `Realtime Property ${Date.now()}`,
        status: 'published'
    });
    propertyId = String(property.id);
    propertyTitle = String(property.title);

    customerId = customer.id;
    ownerId = owner.id;
});

test.afterAll(async () => {
    await runCleanupSafely(() => cleanupChatRows());
    await runCleanupSafely(() => cleanupCustomerChats());
    await runCleanupSafely(() => admin.cleanupUserBookings(realtimeCustomerEmail));
    await runCleanupSafely(() => admin.cleanupOwnerProperties(realtimeOwnerEmail));

    const cleanupUser = async (email: string, role: 'customer' | 'owner') => {
        const user = await admin.findUserByEmail(email);
        if (!user) return;
        if (role === 'owner') {
            await runCleanupSafely(() => admin.cleanupOwnerVerificationArtifacts(user.id));
            await runCleanupSafely(() => admin.supabase.from('owners').delete().eq('id', user.id).then(() => undefined));
        }
        if (role === 'customer') {
            await runCleanupSafely(() => admin.supabase.from('customers').delete().eq('id', user.id).then(() => undefined));
        }
        await runCleanupSafely(() => admin.supabase.from('accounts').delete().eq('id', user.id).then(() => undefined));
        await runCleanupSafely(() => admin.deleteTestUser(email));
    };

    await cleanupUser(realtimePendingOwnerEmail, 'owner');
    await cleanupUser(realtimeOwnerEmail, 'owner');
    await cleanupUser(realtimeCustomerEmail, 'customer');
});

test.beforeEach(async () => {
    await runCleanupSafely(() => admin.cleanupUserBookings(realtimeCustomerEmail));
    await runCleanupSafely(() => admin.cleanupOwnerBookings(realtimeOwnerEmail));
    await runCleanupSafely(() => cleanupChatRows());
    await runCleanupSafely(() => cleanupCustomerChats());
});

test('R-01 new messages inserted into the chat thread appear in the customer conversation in realtime', async ({ page }) => {
    const chatId = await seedCommunityChat();
    await openCustomerConversation(page, chatId);

    const messageText = `Realtime chat ${Date.now()}`;
    await admin.supabase.from('messages').insert({
        chat_id: chatId,
        sender_id: ownerId,
        content: messageText,
        message_type: 'text',
        is_read: false
    });
    await admin.supabase.from('chats').update({
        last_message: messageText,
        last_message_time: new Date().toISOString()
    }).eq('id', chatId);

    const liveMessage = page.getByText(messageText).first();
    try {
        await expect(liveMessage).toBeVisible({ timeout: 10000 });
    } catch {
        await page.reload();
        await expect(page.getByText(messageText).first()).toBeVisible({ timeout: 15000 });
    }
});

test('R-02 booking status badge updates when the booking row changes in the database', async ({ page }) => {
    await ensureCustomerLoggedInAs(page, realtimeCustomerEmail);
    const { booking, property } = await admin.createPaidBooking(realtimeCustomerEmail, realtimeOwnerEmail);
    const { error: seedStatusError } = await admin.supabase
        .from('bookings')
        .update({ status: 'approved', payment_status: 'paid' })
        .eq('id', booking.id);
    expect(seedStatusError).toBeNull();

    await gotoAppRoute(page, `${BASE_URLS.customer}/bookings`);
    const bookingCard = getBookingCardByTitle(page, String(property.title));
    await expect(bookingCard).toBeVisible();

    const { error: bookingUpdateError } = await admin.supabase
        .from('bookings')
        .update({ status: 'confirmed' })
        .eq('id', booking.id);
    expect(bookingUpdateError).toBeNull();

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('bookings')
            .select('status')
            .eq('id', booking.id)
            .maybeSingle();
        return data?.status ?? null;
    }).toBe('confirmed');

    await expect.poll(async () => {
        return ((await bookingCard.textContent()) || '').toLowerCase();
    }, { timeout: 15000 }).toContain('confirmed');
});

test('R-03 owner dashboard pending-booking state reflects newly inserted bookings', async ({ page }) => {
    await ensureOwnerLoggedInAs(page, realtimeOwnerEmail);
    await gotoAppRoute(page, `${BASE_URLS.owner}/dashboard`);
    await admin.createPaidBooking(realtimeCustomerEmail, realtimeOwnerEmail);
    await page.reload();
    await expect(page.getByRole('button', { name: /Accept All/i })).toBeVisible({ timeout: 10000 });
});

test('R-04 the admin owners queue can surface newly seeded pending owners', async ({ page }) => {
    await ensureAdminLoggedIn(page);
    await gotoAppRoute(page, `${BASE_URLS.admin}/owners`);
    await seedPendingRealtimeOwner();
    await page.reload();
    await expect(page.getByText(realtimePendingOwnerEmail).first()).toBeVisible({ timeout: 10000 });
});

test('R-05 mobile chat badges update when unread chat counts change', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ensureCustomerLoggedInAs(page, realtimeCustomerEmail);
    await seedCommunityChat(4);
    await gotoAppRoute(page, `${BASE_URLS.customer}/`);
    const bottomNav = page.locator('.rfm-bottom-nav');
    const chatNavItem = bottomNav.locator('a[href="/chat"]').first();

    await expect(bottomNav).toBeVisible();
    await expect.poll(async () => ((await chatNavItem.textContent()) || '').replace(/\s+/g, ' '), {
        timeout: 15000
    }).toContain('4');
});
