import type { Property } from './property.types';
import type { Owner } from './owner.types';

export interface Offer {
    offerId: string;
    code: string;
    type: 'percentage' | 'flat';
    value: number;
    appliesTo: string[];
    maxDiscount: number;
    minBookingAmount: number;
    expiry: string;
    usageLimit: number;
    usedCount: number;
    active: boolean;
}


export interface Booking {
    bookingId: string;
    propertyId: string;
    roomId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    ownerId: string;
    propertyTitle: string;
    roomNumber: string;
    startDate: string;
    endDate: string;
    checkInDate?: string | null;
    durationMonths: number;
    monthlyRent: number;
    paymentStatus: 'pending' | 'paid' | 'failed' | 'payment_pending' | 'refunded';
    paymentType: 'advance' | 'full' | 'monthly';
    amountPaid: number;
    advancePaid: number;
    amountDue?: number;
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
    createdAt: string;
    status: 'requested'
    | 'pending'
    | 'payment_pending'
    | 'accepted'
    | 'approved'
    | 'confirmed'
    | 'rejected'
    | 'cancelled'
    | 'checked-in'
    | 'checked_in'
    | 'checked-out'
    | 'checked_out'
    | 'completed'
    | 'CANCELLED_BY_CUSTOMER'
    | 'vacate_requested'
    | 'vacated'
    | 'refunded'
    | 'PAID';
    stayStatus?: 'ongoing' | 'vacated' | 'vacate_requested';
    vacateDate?: string | null;
    notifications: Array<{
        ts: string;
        message: string;
        read: boolean;
    }>;
    offerApplied?: boolean;
    offerId?: string;
    offerCode?: string;
    discountAmount?: number;
    finalAmount?: number;
}

export interface MonthlyPayment {
    paymentId: string;
    bookingId: string;
    month: string; // Format: "2024-01" for January 2024
    amount: number;
    paidAt: string;
    status: 'paid' | 'pending' | 'failed';
    transactionId?: string;
}

export interface BookingWithDetails extends Booking {
    propertyDetails?: Property;
    ownerDetails?: Owner;
    customerDetails?: {
        displayName?: string;
        phoneNumber?: string;
        photoUrl?: string;
    };
    rooms?: {
        room_number: string;
        room_type: string;
        images: string[];
    };
    monthlyPayments?: MonthlyPayment[];
}

export interface CancellationPolicy {
    canCancel: boolean;
    isFree: boolean;
    penaltyAmount: number;
    reason: string;
}
