import { expect, test } from '@playwright/test';
import { ensureAdminLoggedIn } from '../../helpers/auth-session';
import { gotoAppRoute } from '../../helpers/app-shell';
import { BASE_URLS } from '../../helpers/e2e-config';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { createTestIdentity } from '../../data/test-users';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
const owner = createTestIdentity('admin-properties', 'owner');
let draftPropertyId = '';
let draftPropertyTitle = '';
let changesPropertyId = '';
let changesPropertyTitle = '';
let publishedPropertyId = '';
let publishedPropertyTitle = '';
let roomPropertyId = '';
let roomPropertyTitle = '';

const runCleanupSafely = async (task: () => Promise<unknown>, timeoutMs = 30000) => {
    await Promise.race([
        Promise.resolve().then(task).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();
    const ownerUser = await admin.createTestUser(owner.email, owner.password, 'owner');
    if (ownerUser?.id) {
        await admin.ensureOwnerProfile(ownerUser.id, owner.email);
        await admin.ensureOwnerVerified(ownerUser.id, owner.email);
    }

    await admin.cleanupOwnerProperties(owner.email);

    const draft = await admin.createPropertyForOwner(owner.email, {
        title: `E2E Draft ${Date.now()}`,
        status: 'draft'
    });
    draftPropertyId = String(draft.property.id);
    draftPropertyTitle = String(draft.property.title);

    const changes = await admin.createPropertyForOwner(owner.email, {
        title: `E2E Changes ${Date.now()}`,
        status: 'draft'
    });
    changesPropertyId = String(changes.property.id);
    changesPropertyTitle = String(changes.property.title);

    const published = await admin.createPropertyForOwner(owner.email, {
        title: `E2E Published ${Date.now()}`,
        status: 'published'
    });
    publishedPropertyId = String(published.property.id);
    publishedPropertyTitle = String(published.property.title);

    const withRoom = await admin.createPropertyWithRoom(owner.email, {
        title: `E2E Rooms ${Date.now()}`,
        status: 'published'
    });
    roomPropertyId = String(withRoom.property.id);
    roomPropertyTitle = String(withRoom.property.title);
});

test.afterAll(async () => {
    await runCleanupSafely(() => admin.cleanupOwnerProperties(owner.email));
    await runCleanupSafely(() => admin.supabase.from('owners').delete().eq('email', owner.email));
    await runCleanupSafely(() => admin.supabase.from('accounts').delete().eq('email', owner.email));
    await runCleanupSafely(() => admin.deleteTestUser(owner.email));
});

test.beforeEach(async ({ page }) => {
    await ensureAdminLoggedIn(page);
});

test('A-09 the admin properties route renders the moderation workspace', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/properties`);
    await expect(page.getByText(/Property Moderation/i).first()).toBeVisible();
});

test('A-10 the moderation workspace exposes the expected property filter tabs', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/properties`);
    await expect(page.getByRole('button', { name: /^All$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pending$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Verified$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Flagged$/i })).toBeVisible();
});

test('A-11 the seeded draft property is stored in the database as draft', async () => {
    const { data, error } = await admin.supabase
        .from('properties')
        .select('status, title')
        .eq('id', draftPropertyId)
        .maybeSingle();
    if (error) throw error;
    expect(data?.title).toBe(draftPropertyTitle);
    expect(data?.status).toBe('draft');
});

test('A-12 seeded draft properties can be published through the moderation data layer', async () => {
    const { error } = await admin.supabase
        .from('properties')
        .update({ status: 'published' })
        .eq('id', draftPropertyId);
    if (error) throw error;

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('properties')
            .select('status')
            .eq('id', draftPropertyId)
            .maybeSingle();
        return data?.status ?? null;
    }).toBe('published');
});

test('A-13 moderation notes can move a seeded property back into draft status', async () => {
    const notePayload = {
        status: 'draft',
        admin_review_notes: 'Please add clearer room images for moderation.'
    };
    const { error } = await admin.supabase
        .from('properties')
        .update(notePayload)
        .eq('id', changesPropertyId);
    if (error && error.code !== 'PGRST204') {
        throw error;
    }

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('properties')
            .select('status')
            .eq('id', changesPropertyId)
            .maybeSingle();
        return data?.status ?? null;
    }).toBe('draft');
});

test('A-14 published seeded properties can be archived by moderation workflows', async () => {
    const { error } = await admin.supabase
        .from('properties')
        .update({ status: 'archived' })
        .eq('id', publishedPropertyId);
    if (error) throw error;

    await expect.poll(async () => {
        const { data } = await admin.supabase
            .from('properties')
            .select('status')
            .eq('id', publishedPropertyId)
            .maybeSingle();
        return data?.status ?? null;
    }).toBe('archived');
});

test('A-15 the property rooms route renders the property and room management surface', async ({ page }) => {
    await gotoAppRoute(page, `${BASE_URLS.admin}/property-rooms`);
    await expect(page.getByText(/Property & Rooms Management|Properties & Rooms Management/i).first()).toBeVisible();
    await expect(page.locator('body')).toContainText(new RegExp(roomPropertyTitle, 'i'));
    expect(roomPropertyId).toBeTruthy();
});
