import { supabase } from './supabase-config';

export interface AdminPropertyRating {
    id: string;
    propertyId: string;
    bookingId: string | null;
    reviewerName: string;
    rating: number;
    review: string;
    createdAt: string;
}

type RatingRow = {
    id: string;
    property_id: string;
    booking_id?: string | null;
    rating: number;
    review?: string | null;
    created_at: string;
    bookings?: {
        customer_name?: string | null;
    } | null;
};

const mapRating = (row: RatingRow): AdminPropertyRating => ({
    id: row.id,
    propertyId: row.property_id,
    bookingId: row.booking_id || null,
    reviewerName: String(row.bookings?.customer_name || 'Guest User').trim() || 'Guest User',
    rating: Number(row.rating || 0) || 0,
    review: String(row.review || '').trim(),
    createdAt: row.created_at,
});

export const ratingService = {
    async getPropertyRatings(propertyId: string): Promise<AdminPropertyRating[]> {
        const { data, error } = await supabase
            .from('ratings')
            .select('id, property_id, booking_id, rating, review, created_at, bookings(customer_name)')
            .eq('property_id', propertyId)
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        return (data || []).map((row) => mapRating(row as RatingRow));
    },

    async deleteRating(ratingId: string): Promise<void> {
        const { error } = await supabase
            .from('ratings')
            .delete()
            .eq('id', ratingId);

        if (error) {
            throw error;
        }
    },
};
