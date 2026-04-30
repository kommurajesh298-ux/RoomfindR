import type { Property } from './property.types';
import type { Owner } from './owner.types';
import type { RatingType } from './rating.types';
export type { Offer } from './offer.types';


export interface Booking {
    bookingId: string;
    propertyId: string;
    roomId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    ownerId: string;
    monthlyRent: number;
    propertyTitle: string;
    roomNumber: string;
    startDate: string;
    endDate: string;
    checkInDate?: string | null;
    durationMonths: number;
    paymentStatus: 'pending' | 'paid' | 'failed' | 'payment_pending' | 'refunded';
    rentPaymentStatus?: 'not_due' | 'pending' | 'paid' | 'failed' | 'refunded';
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
    paymentMethod?: string;
    paymentProvider?: string;
    createdAt: string;
    status: 'requested' | 'pending' | 'payment_pending' | 'payment_failed' | 'accepted' | 'approved' | 'confirmed' | 'rejected' | 'cancelled' | 'checked-in' | 'checked-out' | 'checked_in' | 'checked_out' | 'completed' | 'CANCELLED_BY_CUSTOMER' | 'vacate_requested' | 'PAID' | 'refunded';
    stayStatus?: 'ongoing' | 'vacated' | 'vacate_requested';
    vacateDate?: string | null;
    notifications: Array<{
        ts: string;
        message: string;
        read: boolean;
    }>;

    // Offer fields
    offerApplied?: boolean;
    offerId?: string;
    offerCode?: string;
    discountAmount?: number;
    finalAmount?: number;
    transactionId?: string;
    ratingSubmitted?: boolean;
    checkinRatingSubmitted?: boolean;
    checkoutRatingSubmitted?: boolean;
    pendingRatingType?: RatingType | null;
    nextPaymentDate?: string; // ISO date string
    currentCycleStartDate?: string | null;
    nextDueDate?: string | null;
    cycleDurationDays?: number;
    adminApproved?: boolean;
}

export interface MonthlyPayment {
    paymentId: string;
    bookingId: string;
    month: string; // Format: "2024-01" for January 2024
    amount: number;
    paidAt: string;
    status: 'paid' | 'pending' | 'failed' | 'completed' | 'active' | 'upcoming' | 'overdue';
    paymentProvider?: string;
    orderId?: string;
    metadata?: Record<string, unknown>;
    failureReason?: string;
    retryCount?: number;
}

export type RentCycleStatus = 'active' | 'due' | 'overdue' | 'closed';

export interface RentCycleState {
    bookingId: string;
    currentCycleStartDate: string | null;
    cycleEndDate: string | null;
    nextDueDate: string | null;
    effectiveCycleStartDate?: string | null;
    effectiveNextDueDate?: string | null;
    coveredThroughDate?: string | null;
    coveredThroughMonth?: string | null;
    currentCycleMonth?: string | null;
    isCurrentCycleSettled?: boolean;
    isPrepaidFullStay?: boolean;
    cycleDurationDays: number;
    serverDate: string | null;
    status: RentCycleStatus;
    canPayRent: boolean;
    message: string;
}

export interface Payment extends MonthlyPayment {
    commissionAmount?: number;
    netAmount?: number;
    refundStatus?: string;
    refundId?: string;
    paymentType?: 'booking' | 'monthly' | 'deposit';
}

export interface BookingWithDetails extends Booking {
    propertyDetails?: Property;
    ownerDetails?: Owner;
    monthlyPayments?: MonthlyPayment[];
    rooms?: {
        room_number: string;
        room_type: string;
        images: string[];
    };
    refundStatus?: 'PENDING' | 'PROCESSING' | 'ONHOLD' | 'SUCCESS' | 'FAILED' | 'PROCESSED';
    refundAmount?: number;
    refundReason?: string;
    refundProcessedAt?: string;
}

export interface Refund {
    id: string;
    paymentId: string;
    bookingId: string;
    refundAmount: number;
    reason: string;
    status: 'PENDING' | 'PROCESSING' | 'ONHOLD' | 'SUCCESS' | 'FAILED' | 'PROCESSED';
    providerRefundId?: string;
    processedAt?: string;
    createdAt: string;
}


export interface CancellationPolicy {
    canCancel: boolean;
    isFree: boolean;
    penaltyAmount: number;
    reason: string;
}
