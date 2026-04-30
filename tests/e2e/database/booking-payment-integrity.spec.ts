import { expect, test } from '@playwright/test';
import { SupabaseAdminHelper } from '../../helpers/supabase-admin';
import { TEST_USERS } from '../../helpers/test-data';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

let admin: SupabaseAdminHelper;
const runId = Date.now();
const ownerEmail = `integrity-owner-${runId}@example.com`;
const customerOneEmail = `integrity-customer-1-${runId}@example.com`;
const customerTwoEmail = `integrity-customer-2-${runId}@example.com`;

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

const buildBookingRpcPayload = (input: {
    propertyId: string;
    roomId: string;
    ownerId: string;
    customerId: string;
    customerEmail: string;
    bookingKey: string;
    roomNumber: string;
    monthlyRent: number;
    advancePaid: number;
}) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 14);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);

    return {
        p_property_id: input.propertyId,
        p_room_id: input.roomId,
        p_customer_id: input.customerId,
        p_owner_id: input.ownerId,
        p_start_date: startDate.toISOString().split('T')[0],
        p_end_date: endDate.toISOString().split('T')[0],
        p_monthly_rent: input.monthlyRent,
        p_advance_paid: input.advancePaid,
        p_customer_name: input.customerEmail.split('@')[0],
        p_customer_phone: '9999999999',
        p_customer_email: input.customerEmail,
        p_room_number: input.roomNumber,
        p_payment_type: 'advance',
        p_transaction_id: null,
        p_amount_paid: 0,
        p_duration_months: 1,
        p_amount_due: input.advancePaid,
        p_booking_key: input.bookingKey,
        p_override: false,
        p_stay_type: 'monthly',
        p_selected_months: 1,
        p_selected_days: null,
        p_total_rent: input.monthlyRent,
        p_valid_till: null,
        p_booking_status: 'pending',
        p_portal_access: false,
        p_continue_status: 'pending',
    };
};

test.beforeAll(async () => {
    admin = new SupabaseAdminHelper();

    const owner = await admin.createTestUser(ownerEmail, TEST_USERS.owner.password, 'owner');
    const customerOne = await admin.createTestUser(customerOneEmail, TEST_USERS.customer.password, 'customer');
    const customerTwo = await admin.createTestUser(customerTwoEmail, TEST_USERS.customer.password, 'customer');

    if (!owner?.id || !customerOne?.id || !customerTwo?.id) {
        throw new Error('Failed to seed booking/payment integrity users.');
    }

    await admin.ensureOwnerVerified(owner.id, ownerEmail);
    await admin.ensureCustomerProfile(customerOne.id, customerOneEmail);
    await admin.ensureCustomerProfile(customerTwo.id, customerTwoEmail);
});

test.afterAll(async () => {
    await admin.cleanupUserBookings(customerOneEmail);
    await admin.cleanupUserBookings(customerTwoEmail);
    await admin.cleanupOwnerBookings(ownerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
    await cleanupUserArtifacts(customerOneEmail, 'customer');
    await cleanupUserArtifacts(customerTwoEmail, 'customer');
    await cleanupUserArtifacts(ownerEmail, 'owner');
});

test.beforeEach(async () => {
    await admin.cleanupUserBookings(customerOneEmail);
    await admin.cleanupUserBookings(customerTwoEmail);
    await admin.cleanupOwnerBookings(ownerEmail);
    await admin.cleanupOwnerProperties(ownerEmail);
});

test('D-13 create_booking_v4 reuses the same booking id for repeated idempotency keys', async () => {
    const owner = await admin.findUserByEmail(ownerEmail);
    const customer = await admin.findUserByEmail(customerOneEmail);
    if (!owner?.id || !customer?.id) {
        throw new Error('Missing seeded owner/customer for D-13.');
    }

    const { property, room } = await admin.createPropertyWithRoom(ownerEmail, {
        title: `Integrity Idempotency ${Date.now()}`,
        roomCapacity: 1,
    });

    const payload = buildBookingRpcPayload({
        propertyId: String(property.id),
        roomId: String(room.id),
        ownerId: owner.id,
        customerId: customer.id,
        customerEmail: customerOneEmail,
        bookingKey: `idem-${Date.now()}`,
        roomNumber: String(room.room_number || 'E2E-1'),
        monthlyRent: Number(property.monthly_rent || 5000),
        advancePaid: Number(property.advance_deposit || property.monthly_rent || 5000),
    });

    const first = await admin.supabase.rpc('create_booking_v4', payload);
    const second = await admin.supabase.rpc('create_booking_v4', payload);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data?.booking_id).toBeTruthy();
    expect(second.data?.booking_id).toBe(first.data?.booking_id);
    expect(second.data?.idempotent).toBe(true);

    const { data: bookings, error: bookingLookupError } = await admin.supabase
        .from('bookings')
        .select('id')
        .eq('room_id', room.id)
        .eq('customer_id', customer.id);

    expect(bookingLookupError).toBeNull();
    expect(bookings).toHaveLength(1);
  });

test('D-14 room-capacity protection allows only one concurrent booking into a single-capacity room', async () => {
    const owner = await admin.findUserByEmail(ownerEmail);
    const customerOne = await admin.findUserByEmail(customerOneEmail);
    const customerTwo = await admin.findUserByEmail(customerTwoEmail);
    if (!owner?.id || !customerOne?.id || !customerTwo?.id) {
        throw new Error('Missing seeded users for D-14.');
    }

    const { property, room } = await admin.createPropertyWithRoom(ownerEmail, {
        title: `Integrity Capacity ${Date.now()}`,
        roomCapacity: 1,
    });

    const basePayload = {
        propertyId: String(property.id),
        roomId: String(room.id),
        ownerId: owner.id,
        roomNumber: String(room.room_number || 'E2E-1'),
        monthlyRent: Number(property.monthly_rent || 5000),
        advancePaid: Number(property.advance_deposit || property.monthly_rent || 5000),
    };

    const firstClient = new SupabaseAdminHelper();
    const secondClient = new SupabaseAdminHelper();

    const results = await Promise.allSettled([
        firstClient.supabase.rpc('create_booking_v4', buildBookingRpcPayload({
            ...basePayload,
            customerId: customerOne.id,
            customerEmail: customerOneEmail,
            bookingKey: `capacity-a-${Date.now()}`,
        })),
        secondClient.supabase.rpc('create_booking_v4', buildBookingRpcPayload({
            ...basePayload,
            customerId: customerTwo.id,
            customerEmail: customerTwoEmail,
            bookingKey: `capacity-b-${Date.now()}`,
        })),
    ]);

    const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ data: { booking_id?: string } | null; error: { message?: string } | null }> => result.status === 'fulfilled');
    const bookingIds = fulfilled
        .map((result) => result.value.data?.booking_id)
        .filter((value): value is string => Boolean(value));
    const errorMessages = fulfilled
        .map((result) => String(result.value.error?.message || ''))
        .filter(Boolean);

    expect(bookingIds).toHaveLength(1);
    expect(errorMessages.some((message) => /ROOM_FULL/i.test(message))).toBe(true);

    const { data: liveBookings, error: liveBookingError } = await admin.supabase
        .from('bookings')
        .select('id, customer_id')
        .eq('room_id', room.id);

    expect(liveBookingError).toBeNull();
    expect(liveBookings).toHaveLength(1);
  });

test('D-15 payment idempotency keys reject duplicate payment rows for the same retry token', async () => {
    const booking = await admin.createPendingBooking(customerOneEmail);
    const idempotencyKey = `payment-idem-${Date.now()}`;

    const firstInsert = await admin.supabase
        .from('payments')
        .insert({
            booking_id: booking.id,
            customer_id: booking.customer_id,
            amount: 5000,
            status: 'pending',
            payment_status: 'pending',
            payment_method: 'upi',
            payment_type: 'advance',
            idempotency_key: idempotencyKey,
        })
        .select('id')
        .single();

    const secondInsert = await admin.supabase
        .from('payments')
        .insert({
            booking_id: booking.id,
            customer_id: booking.customer_id,
            amount: 5000,
            status: 'pending',
            payment_status: 'pending',
            payment_method: 'upi',
            payment_type: 'advance',
            idempotency_key: idempotencyKey,
        })
        .select('id')
        .single();

    expect(firstInsert.error).toBeNull();
    expect(firstInsert.data?.id).toBeTruthy();
    expect(secondInsert.error).not.toBeNull();
    expect(String(secondInsert.error?.message || '')).toMatch(/duplicate|unique/i);

    const updatedBooking = await admin.getBookingById(String(booking.id));
    const paymentsForBooking = await admin.getPaymentsForBooking(String(booking.id));

    expect(updatedBooking?.payment_status).toBe('pending');
    expect(paymentsForBooking).toHaveLength(1);
  });
