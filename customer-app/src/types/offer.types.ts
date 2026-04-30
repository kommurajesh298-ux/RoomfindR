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

    // Optional legacy/UI-compatibility fields
    offerId?: string;
    type?: 'percentage' | 'flat';
    value?: number;
    active?: boolean;
    expiry?: string;
    minBookingAmount?: number;
    maxDiscount?: number;
    usageLimit?: number;
    usedCount?: number;
    appliesTo?: string[];
    subtitle?: string;
}
