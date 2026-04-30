import { supabase } from './supabase-config';
import { invokeProtectedEdgeFunction } from './protected-edge.service';

const ADMIN_BOOKINGS_PAGE_SIZE = 100;
const ADMIN_BOOKING_PAYMENT_PAGE_SIZE = 50;
const ADMIN_BOOKING_LIST_SELECT_RICH = `
    id,
    customer_id,
    owner_id,
    property_id,
    status,
    customer_name,
    customer_email,
    start_date,
    end_date,
    check_in_date,
    advance_paid,
    amount_paid,
    amount_due,
    monthly_rent,
    payment_type,
    commission_amount,
    room_gst,
    room_gst_rate,
    platform_fee,
    platform_gst,
    platform_gst_rate,
    total_amount,
    cgst_amount,
    sgst_amount,
    igst_amount,
    tcs_amount,
    gst_breakdown,
    place_of_supply_type,
    currency,
    payment_status,
    advance_payment_status,
    rent_payment_status,
    admin_approved,
    admin_reviewed_at,
    admin_reviewed_by,
    admin_review_notes,
    rejection_reason,
    created_at,
    updated_at,
    customers(name, email),
    owners(name, email),
    properties(title)
`;
const ADMIN_BOOKING_LIST_SELECT_LEGACY = `
    id,
    customer_id,
    owner_id,
    property_id,
    status,
    customer_name,
    customer_email,
    start_date,
    end_date,
    advance_paid,
    amount_paid,
    amount_due,
    monthly_rent,
    payment_type,
    commission_amount,
    payment_status,
    rejection_reason,
    created_at,
    updated_at,
    customers(name, email),
    owners(name, email),
    properties(title)
`;
const ADMIN_BOOKING_PAYMENT_SELECT = 'id, booking_id, amount, payment_type, payment_method, status, provider_order_id, provider_payment_id, created_at, updated_at, verified_at, failure_reason';
let adminBookingRichSelectAvailable: boolean | null = null;

interface ReviewBookingInput {
    status: string;
    notes?: string;
}

const isMissingBookingCompatibilityColumnError = (error: { code?: string; message?: string } | null | undefined) => {
    const message = String(error?.message || '');
    return (
        (error?.code === '42703' || error?.code === 'PGRST204')
        && /(?:column .*?|could not find the '.*?' column of 'bookings'.*?)(check_in_date|advance_payment_status|rent_payment_status|admin_approved|admin_reviewed_at|admin_reviewed_by|admin_review_notes|room_gst|room_gst_rate|platform_fee|platform_gst|platform_gst_rate|total_amount|cgst_amount|sgst_amount|igst_amount|tcs_amount|gst_breakdown|place_of_supply_type|currency)/i.test(message)
    );
};

const prepareRefundForReviewedBooking = async (
    bookingId: string,
    status: string,
    notes: string,
) => {
    await invokeProtectedEdgeFunction<{
        success?: boolean;
        skipped?: boolean;
        error?: string;
    }>(
        'cashfree-refund',
        {
            action: 'prepare',
            bookingId,
            reason: notes || `Booking ${status} during admin review`,
            refundReason: status === 'cancelled' ? 'booking_cancelled' : 'booking_rejected',
            initiatedBy: 'admin'
        },
        'Refund request preparation failed'
    );
};

type RawBookingRow = {
    id?: string;
    status?: string;
    customer_id?: string;
    owner_id?: string;
    property_id?: string;
    customers?: { name?: string; display_name?: string; email?: string };
    owners?: { name?: string; email?: string };
    properties?: { title?: string };
    customer_name?: string;
    property_title?: string;
    owner_name?: string;
    start_date?: string;
    startDate?: string;
    end_date?: string;
    endDate?: string;
    advance_paid?: number;
    amountPaid?: number;
    amount_paid?: number;
    amount_due?: number;
    monthly_rent?: number;
    payment_type?: string;
    commission_amount?: number;
    room_gst?: number;
    room_gst_rate?: number;
    platform_fee?: number;
    platform_gst?: number;
    platform_gst_rate?: number;
    total_amount?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    tcs_amount?: number;
    gst_breakdown?: Record<string, unknown>;
    place_of_supply_type?: string;
    currency?: string;
    check_in_date?: string | null;
    payment_status?: string;
    advance_payment_status?: string;
    rent_payment_status?: string;
    admin_approved?: boolean;
    admin_reviewed_at?: string;
    admin_reviewed_by?: string;
    admin_review_notes?: string;
    rejection_reason?: string;
    created_at?: string;
    createdAt?: string;
    updated_at?: string;
    updatedAt?: string;
    [key: string]: unknown;
};

const normalizeBooking = (booking: RawBookingRow) => ({
    ...booking,
    customerId: booking.customer_id,
    ownerId: booking.owner_id,
    propertyId: booking.property_id,
    customerName: booking.customers?.name
        || booking.customers?.display_name
        || booking.customer_name
        || String(booking.customer_email || '').split('@')[0]
        || 'Unknown',
    ownerName: booking.owners?.name || booking.owner_name || 'Unknown',
    propertyName: booking.properties?.title || booking.property_title || 'Unknown',
    startDate: booking.start_date || booking.startDate,
    endDate: booking.end_date || booking.endDate,
    checkInDate: booking.check_in_date || null,
    amountPaid: Number(booking.amount_paid ?? booking.advance_paid ?? booking.amountPaid ?? 0),
    advancePaid: Number(booking.advance_paid ?? 0),
    paymentStatus: booking.payment_status || 'pending',
    paymentType: (booking.payment_type as 'advance' | 'full' | 'monthly') || 'advance',
    advancePaymentStatus: booking.advance_payment_status || 'pending',
    rentPaymentStatus: booking.rent_payment_status || 'pending',
    amountDue: Number(booking.amount_due ?? 0),
    monthlyRent: Number(booking.monthly_rent ?? 0),
    durationMonths: 0,
    commissionAmount: Number(booking.commission_amount ?? 0),
    roomGst: Number(booking.room_gst ?? 0),
    roomGstRate: Number(booking.room_gst_rate ?? 0),
    platformFee: Number(booking.platform_fee ?? 0),
    platformGst: Number(booking.platform_gst ?? 0),
    platformGstRate: Number(booking.platform_gst_rate ?? 0),
    totalAmount: Number(booking.total_amount ?? 0),
    cgstAmount: Number(booking.cgst_amount ?? 0),
    sgstAmount: Number(booking.sgst_amount ?? 0),
    igstAmount: Number(booking.igst_amount ?? 0),
    tcsAmount: Number(booking.tcs_amount ?? 0),
    gstBreakdown: booking.gst_breakdown,
    placeOfSupplyType: (booking.place_of_supply_type as 'cgst_sgst' | 'igst' | 'unknown') || 'unknown',
    currency: String(booking.currency || 'INR'),
    adminApproved: Boolean(booking.admin_approved),
    adminReviewedAt: booking.admin_reviewed_at,
    adminReviewedBy: booking.admin_reviewed_by,
    adminReviewNotes: booking.admin_review_notes,
    rejectionReason: booking.rejection_reason,
    createdAt: booking.created_at || booking.createdAt,
    updatedAt: booking.updated_at || booking.updatedAt
});

export const bookingService = {
    getAllBookings: (statusFilter: string | undefined, callback: (bookings: unknown[]) => void) => {
        const fetch = async () => {
            try {
                const buildQuery = (selectClause: string) => {
                    let query = supabase
                        .from('bookings')
                        .select(selectClause)
                        .order('created_at', { ascending: false })
                        .range(0, ADMIN_BOOKINGS_PAGE_SIZE - 1);
                    if (statusFilter) {
                        if (statusFilter.includes(',')) {
                            query = query.in('status', statusFilter.split(','));
                        } else {
                            query = query.eq('status', statusFilter);
                        }
                    }
                    return query;
                };

                let data: RawBookingRow[] | null = null;
                let error: { code?: string; message?: string } | null = null;

                const shouldUseLegacySelect = adminBookingRichSelectAvailable === false;

                if (!shouldUseLegacySelect) {
                    const result = await buildQuery(ADMIN_BOOKING_LIST_SELECT_RICH);
                    data = (result.data as unknown as RawBookingRow[] | null) ?? null;
                    error = result.error;

                    if (!error) {
                        adminBookingRichSelectAvailable = true;
                    }
                }

                if (shouldUseLegacySelect || (error && isMissingBookingCompatibilityColumnError(error))) {
                    adminBookingRichSelectAvailable = false;
                    const fallback = await buildQuery(ADMIN_BOOKING_LIST_SELECT_LEGACY);
                    data = (fallback.data as unknown as RawBookingRow[] | null) ?? null;
                    error = fallback.error;
                }

                if (error) throw error;

                callback((data || []).map((booking) => normalizeBooking(booking)));
            } catch (error) {
                console.error('[AdminBookingService] Failed to load booking list:', error);
                callback([]);
            }
        };
        fetch();
        const channel = supabase.channel('all-bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, fetch).subscribe();
        return () => { supabase.removeChannel(channel); };
    },
    reviewBookingDecision: async (id: string, input: ReviewBookingInput, adminId: string, adminEmail: string) => {
        const notes = String(input.notes || '').trim();

        const { data: current, error: currentError } = await supabase
            .from('bookings')
            .select('status, admin_approved')
            .eq('id', id)
            .single();

        if (currentError) throw currentError;

        const bookingUpdate: Record<string, unknown> = {
            status: input.status,
            admin_approved: true,
            admin_reviewed_at: new Date().toISOString(),
            admin_reviewed_by: adminId,
            admin_review_notes: notes || null,
        };

        if (input.status === 'rejected' || input.status === 'cancelled') {
            bookingUpdate.rejection_reason = notes || 'Rejected during admin review';
        } else {
            bookingUpdate.rejection_reason = null;
        }

        const { error: updateError } = await supabase
            .from('bookings')
            .update(bookingUpdate)
            .eq('id', id);

        if (updateError) throw updateError;

        if (input.status === 'rejected' || input.status === 'cancelled') {
            await prepareRefundForReviewedBooking(
                id,
                input.status,
                notes || 'Rejected during admin review'
            );
        }

        await supabase.from('audit_logs').insert({
            user_id: adminId,
            action: 'booking_admin_review',
            details: {
                bookingId: id,
                previousStatus: current?.status || null,
                nextStatus: input.status,
                adminApproved: true,
                notes: notes || null,
                adminEmail,
            }
        });
    },
    getBookingDetails: async (id: string) => {
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, customers(name, email), owners(name, email), properties(title)')
            .eq('id', id)
            .single();

        if (bookingError) throw bookingError;

        const { data: payments, error: paymentsError } = await supabase
            .from('payments')
            .select(ADMIN_BOOKING_PAYMENT_SELECT)
            .eq('booking_id', id)
            .order('created_at', { ascending: false })
            .range(0, ADMIN_BOOKING_PAYMENT_PAGE_SIZE - 1);

        if (paymentsError) throw paymentsError;

        return {
            ...normalizeBooking(booking as RawBookingRow),
            payments: payments || []
        };
    },
    getBookingPayments: async (bookingId: string) => {
        const { data, error } = await supabase
            .from('payments')
            .select(ADMIN_BOOKING_PAYMENT_SELECT)
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .range(0, ADMIN_BOOKING_PAYMENT_PAGE_SIZE - 1);
        if (error) throw error;
        return data;
    },
    subscribeToBookingPayments: (bookingId: string, callback: (payments: unknown[]) => void) => {
        const fetch = async () => {
            const data = await bookingService.getBookingPayments(bookingId);
            callback(data);
        };
        fetch();
        const channel = supabase.channel(`admin-booking-payments-${bookingId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'payments', filter: `booking_id=eq.${bookingId}`
        }, () => fetch()).subscribe();
        return () => { supabase.removeChannel(channel); };
    }
};

export const BookingService = bookingService;
