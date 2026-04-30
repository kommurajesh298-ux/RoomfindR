import { expect, test } from '@playwright/test';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseAdminHelper;
const runId = Date.now();
const customerEmail = `db-customer-${runId}@example.com`;
const ownerEmail = `db-owner-${runId}@example.com`;
const adminEmail = `db-admin-${runId}@example.com`;
const pendingOwnerEmail = `db-owner-pending-${runId}@example.com`;

const buildSeedPhone = (seed: string) => {
    let hash = 0;
    const source = seed.trim().toLowerCase();
    for (let i = 0; i < source.length; i += 1) {
        hash = (hash * 131 + source.charCodeAt(i)) % 1_000_000_000;
    }

    return `+919${String(hash).padStart(9, '0')}`;
};

const upsertAccount = async (id: string, email: string, role: 'customer' | 'owner' | 'admin') => {
    await admin.supabase.from('accounts').upsert({
        id,
        email,
        phone: buildSeedPhone(`${role}:${email}`),
        role,
        updated_at: new Date().toISOString()
    });
};

const cleanupUserArtifacts = async (email: string, role: 'customer' | 'owner' | 'admin') => {
    const user = await admin.findUserByEmail(email);
    if (!user) return;

    if (role === 'customer') {
        await admin.supabase.from('customers').delete().eq('id', user.id);
    } else if (role === 'owner') {
        await admin.cleanupOwnerVerificationArtifacts(user.id);
        await admin.supabase.from('owners').delete().eq('id', user.id);
    } else {
        await admin.supabase.from('admins').delete().eq('id', user.id);
    }

    await admin.supabase.from('accounts').delete().eq('id', user.id);
    await admin.deleteTestUser(email);
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();

    const customer = await admin.createTestUser(customerEmail, TEST_USERS.customer.password, 'customer');
    const owner = await admin.createTestUser(ownerEmail, TEST_USERS.owner.password, 'owner');
    const platformAdmin = await admin.createTestUser(adminEmail, TEST_USERS.admin.password, 'admin');

    if (!customer || !owner || !platformAdmin) {
        throw new Error('Failed to seed database validation users.');
    }

    await admin.ensureCustomerProfile(customer.id, customerEmail);
    await admin.ensureOwnerProfile(owner.id, ownerEmail);
    await upsertAccount(customer.id, customerEmail, 'customer');
    await upsertAccount(owner.id, ownerEmail, 'owner');
    await upsertAccount(platformAdmin.id, adminEmail, 'admin');
    await admin.supabase.from('admins').upsert({
        id: platformAdmin.id,
        name: 'DB Admin',
        email: adminEmail,
        updated_at: new Date().toISOString()
    });
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(customerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
    await admin.cleanupOwnerProperties(TEST_USERS.owner.email);
    await cleanupUserArtifacts(customerEmail, 'customer');
    await cleanupUserArtifacts(ownerEmail, 'owner');
    await cleanupUserArtifacts(adminEmail, 'admin');
    await cleanupUserArtifacts(pendingOwnerEmail, 'owner');
});

test.beforeEach(async () => {
    await admin.cleanupUserBookings(customerEmail);
});

test('D-01 customer auth users can be materialized into the accounts table', async () => {
    const { data } = await admin.supabase.from('accounts').select('*').eq('email', customerEmail).maybeSingle();
    expect(data?.email).toBe(customerEmail);
  });

test('D-02 customer profile rows exist in the customers table', async () => {
    const { data } = await admin.supabase.from('customers').select('*').eq('email', customerEmail).maybeSingle();
    expect(data?.email).toBe(customerEmail);
});

test('D-03 owner profile rows exist in the owners table', async () => {
    const { data } = await admin.supabase.from('owners').select('*').eq('email', ownerEmail).maybeSingle();
    expect(data?.email).toBe(ownerEmail);
});

test('D-04 admin profile rows exist in the admins table', async () => {
    const { data } = await admin.supabase.from('admins').select('*').eq('email', adminEmail).maybeSingle();
    expect(data?.email).toBe(adminEmail);
});

test('D-05 owner property seeds persist title and city fields in the properties table', async () => {
    const { property } = await admin.createPropertyForOwner(TEST_USERS.owner.email, {
        title: `DB Property ${Date.now()}`,
        city: 'Bengaluru'
    });
    const { data } = await admin.supabase.from('properties').select('title, city').eq('id', property.id).maybeSingle();
    expect(data?.title).toBe(property.title);
    expect(data?.city).toBe('Bengaluru');
});

test('D-06 properties seeded with rooms create matching rows in the rooms table', async () => {
    const { property, room } = await admin.createPropertyWithRoom(TEST_USERS.owner.email);
    const { data } = await admin.supabase.from('rooms').select('*').eq('property_id', property.id).eq('id', room.id).maybeSingle();
    expect(data?.property_id).toBe(property.id);
});

test('D-07 pending bookings persist as payment_pending records', async () => {
    const booking = await admin.createPendingBooking(customerEmail);
    const { data } = await admin.supabase.from('bookings').select('status').eq('id', booking.id).maybeSingle();
    expect(data?.status).toBe('payment_pending');
});

test('D-08 pending payment rows persist in the payments table', async () => {
    const booking = await admin.createPendingBooking(customerEmail);
    const payment = await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    const { data } = await admin.supabase.from('payments').select('status').eq('id', payment.id).maybeSingle();
    expect(data?.status).toBe('pending');
});

test('D-09 refund helper writes refund rows for a refunded booking', async () => {
    const booking = await admin.createPendingBooking(customerEmail);
    await admin.createPendingPayment(String(booking.id), String(booking.customer_id), 5000);
    await admin.markBookingRefunded(String(booking.id));
    const refund = await admin.getRefundForBooking(String(booking.id));
    expect(String(refund?.status).toUpperCase()).toBe('SUCCESS');
});

test('D-10 booking status changes persist when updated directly', async () => {
    const booking = await admin.createPendingBooking(customerEmail);
    await admin.supabase.from('bookings').update({ status: 'CANCELLED_BY_CUSTOMER' }).eq('id', booking.id);
    const updated = await admin.getBookingById(String(booking.id));
    expect(updated?.status).toBe('CANCELLED_BY_CUSTOMER');
});

test('D-11 booking admin approval flags persist when updated directly', async () => {
    const booking = await admin.createPendingBooking(customerEmail);
    await admin.supabase.from('bookings').update({ admin_approved: true }).eq('id', booking.id);
    const updated = await admin.getBookingById(String(booking.id));
    expect(updated?.admin_approved).toBe(true);
});

test('D-12 owner verification rows can be promoted from pending to approved in the database', async () => {
    const owner = await admin.createTestUser(pendingOwnerEmail, TEST_USERS.owner.password, 'owner');
    if (!owner) {
        throw new Error('Unable to create pending owner for D-12.');
    }
    await admin.ensureOwnerProfile(owner.id, pendingOwnerEmail);
    await upsertAccount(owner.id, pendingOwnerEmail, 'owner');
    await admin.supabase.from('owners').update({ verified: false, verification_status: 'pending' }).eq('id', owner.id);
    await admin.ensureOwnerVerified(owner.id, pendingOwnerEmail);
    const { data } = await admin.supabase.from('owners').select('verified, verification_status').eq('id', owner.id).maybeSingle();
    expect(data?.verified).toBe(true);
    expect(data?.verification_status).toBe('approved');
});
