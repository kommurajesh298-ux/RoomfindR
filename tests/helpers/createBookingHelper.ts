import { SupabaseAdminHelper } from './supabase-admin';
import { TEST_USERS } from '../data/test-users';

type PropertySeedOptions = {
    title?: string;
    status?: 'draft' | 'published' | 'archived';
    monthlyRent?: number;
    roomPrice?: number;
    city?: string;
    state?: string;
    ownerEmail?: string;
};

export const createBookingHelper = (admin: SupabaseAdminHelper) => ({
    async seedPublishedProperty(options: PropertySeedOptions = {}) {
        const { property, room } = await admin.createPropertyWithRoom(
            options.ownerEmail || TEST_USERS.owner.email,
            {
                title: options.title || `E2E Property ${Date.now()}`,
                status: options.status || 'published',
                monthlyRent: options.monthlyRent || 7200,
                roomPrice: options.roomPrice || options.monthlyRent || 7200,
                city: options.city || 'Bengaluru',
                state: options.state || 'Karnataka',
            },
        );

        return { property, room };
    },

    async seedPendingBooking(customerEmail = TEST_USERS.customer.email, ownerEmail = TEST_USERS.owner.email) {
        return admin.createPendingBookingForOwner(customerEmail, ownerEmail);
    },

    async seedPaidBooking(customerEmail = TEST_USERS.customer.email, ownerEmail = TEST_USERS.owner.email) {
        return admin.createPaidBooking(customerEmail, ownerEmail);
    },

    async seedCheckedInBooking(customerEmail = TEST_USERS.customer.email, ownerEmail = TEST_USERS.owner.email) {
        const seeded = await admin.createPaidBooking(customerEmail, ownerEmail);
        await admin.supabase
            .from('bookings')
            .update({
                status: 'checked-in',
                payment_status: 'paid',
                admin_approved: false,
            })
            .eq('id', seeded.booking.id);

        return seeded;
    },

    async seedLongStayBooking(customerEmail = TEST_USERS.customer.email, ownerEmail = TEST_USERS.owner.email) {
        const seeded = await admin.createPaidBooking(customerEmail, ownerEmail);
        const nextPaymentDate = new Date();
        nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 3);

        await admin.supabase
            .from('bookings')
            .update({
                status: 'checked-in',
                payment_status: 'paid',
                admin_approved: false,
                end_date: endDate.toISOString().split('T')[0],
                next_payment_date: nextPaymentDate.toISOString(),
            })
            .eq('id', seeded.booking.id);

        return seeded;
    },

    async seedDueMonthlyBooking(customerEmail = TEST_USERS.customer.email, ownerEmail = TEST_USERS.owner.email) {
        const seeded = await this.seedLongStayBooking(customerEmail, ownerEmail);
        const today = new Date();
        const cycleStart = new Date(today);
        cycleStart.setMonth(cycleStart.getMonth() - 1);
        const cycleEnd = new Date(today);
        cycleEnd.setMonth(cycleEnd.getMonth() + 2);

        await admin.supabase
            .from('bookings')
            .update({
                start_date: cycleStart.toISOString().split('T')[0],
                end_date: cycleEnd.toISOString().split('T')[0],
                current_cycle_start_date: cycleStart.toISOString().split('T')[0],
                next_due_date: today.toISOString().split('T')[0],
                rent_payment_status: 'pending',
                admin_approved: false,
            })
            .eq('id', seeded.booking.id);

        return seeded;
    },
});
