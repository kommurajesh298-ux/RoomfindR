import { BASE_URLS } from './e2e-config';
import { SupabaseAdminHelper } from './supabase-admin';
import { resolveSupabaseEnv } from './supabase-auth';

export const createPaymentHelper = (admin: SupabaseAdminHelper) => ({
    async markBookingPaid(bookingId: string, customerId: string, amount = 5000) {
        const payment = await admin.createPendingPayment(bookingId, customerId, amount);
        await admin.markPaymentCompleted(String(payment.id), bookingId);
        return payment;
    },

    async markBookingFailed(bookingId: string, customerId: string, amount = 5000) {
        const payment = await admin.createPendingPayment(bookingId, customerId, amount);
        await admin.markPaymentFailed(String(payment.id), bookingId);
        return payment;
    },

    async refundBooking(bookingId: string, refundAmount?: number) {
        await admin.markBookingRefunded(bookingId, refundAmount);
        return admin.waitForRefund(bookingId);
    },

    async triggerOwnerSettlement(bookingId: string) {
        const env = resolveSupabaseEnv(BASE_URLS.owner);
        const resolveExistingSettlement = async () => {
            const booking = await admin.getBookingById(bookingId).catch(() => null);
            const ownerId = String(booking?.owner_id || '').trim();

            if (!ownerId) {
                return null;
            }

            const { data: settlement } = await admin.supabase
                .from('settlements')
                .select('status, provider_transfer_id')
                .eq('booking_id', bookingId)
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            return settlement || null;
        };

        const response = await fetch(`${env.supabaseUrl}/functions/v1/cashfree-settlement`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.serviceKey}`,
                apikey: env.serviceKey,
                'x-supabase-auth': `Bearer ${env.serviceKey}`,
            },
            body: JSON.stringify({ bookingId }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({})) as { message?: string; error?: { message?: string } | string };
            let settlement = await resolveExistingSettlement();

            if (!settlement) {
                await new Promise((resolve) => setTimeout(resolve, 2500));
                settlement = await resolveExistingSettlement();
            }

            if (settlement?.status) {
                const normalizedStatus = String(settlement.status).toUpperCase();
                const providerTransferId = String(settlement.provider_transfer_id || '').trim();
                if (normalizedStatus === 'PROCESSING' || normalizedStatus === 'COMPLETED') {
                    if (providerTransferId || normalizedStatus === 'PROCESSING') {
                        return;
                    }
                }
            }

            const message = typeof payload.error === 'string'
                ? payload.error
                : payload.error?.message || payload.message || 'Settlement trigger failed';
            throw new Error(message);
        }
    },
});
