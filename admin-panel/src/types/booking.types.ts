// Removed legacy firebase imports

export interface PlatformBooking {
    id: string;
    propertyId: string;
    propertyName: string;
    customerId: string;
    customerName: string;
    ownerId: string;
    ownerName: string;
    startDate: string;
    endDate: string;
    status:
        | 'pending'
        | 'requested'
        | 'accepted'
        | 'approved'
        | 'confirmed'
        | 'rejected'
        | 'cancelled'
        | 'checked-in'
        | 'checked_in'
        | 'checked-out'
        | 'checked_out'
        | 'payment_pending'
        | 'refunded'
        | 'disputed';
    paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
    advancePaymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
    rentPaymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
    amountPaid: number;
    advancePaid?: number;
    amountDue?: number;
    monthlyRent?: number;
    paymentType?: 'advance' | 'full' | 'monthly';
    durationMonths?: number;
    commissionAmount?: number;
    roomGst?: number;
    roomGstRate?: number;
    platformFee?: number;
    platformGst?: number;
    platformGstRate?: number;
    totalAmount?: number;
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;
    tcsAmount?: number;
    gstBreakdown?: Record<string, unknown>;
    placeOfSupplyType?: 'cgst_sgst' | 'igst' | 'unknown';
    currency?: string;
    checkInDate?: string | null;
    adminApproved?: boolean;
    adminReviewedAt?: string;
    adminReviewedBy?: string;
    adminReviewNotes?: string;
    rejectionReason?: string;
    createdAt: string;
}

export interface BookingTimeline {
    timestamp: string;
    action: string;
    actor: string;
    details: string;
}

export interface Offer {
    id?: string;
    code: string;
    title: string;
    description: string;
    discount_type: 'percentage' | 'fixed';
    discount_value: number;
    max_discount: number;
    min_booking_amount: number;
    valid_until?: string;
    max_uses: number;
    current_uses: number;
    is_active: boolean;
    created_at?: string;
    // UI-only or optional fields
    subtitle?: string; // Legacy/UI
    expiry?: string;   // Legacy/UI
}
