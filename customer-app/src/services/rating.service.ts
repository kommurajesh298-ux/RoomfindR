import { supabase } from './supabase-config';
import { deferRealtimeSubscription } from './realtime-subscription';
import type { RatingType } from '../types/rating.types';

export interface PropertyRatingSummary {
    avgRating: number;
    totalRatings: number;
}

export interface PropertyReview {
    id: string;
    bookingId: string | null;
    propertyId: string;
    userId: string | null;
    rating: number;
    review: string;
    createdAt: string;
    reviewerName: string;
    type: RatingType;
}

export interface UserPropertyRatingContext {
    bookingId: string | null;
    canRate: boolean;
    existingRating: PropertyReview | null;
    type: RatingType;
}

export interface UpsertPropertyRatingInput {
    bookingId: string;
    propertyId: string;
    userId: string;
    type: RatingType;
    rating: number;
    review?: string;
}

export interface UpsertPropertyRatingResult {
    summary: PropertyRatingSummary;
    review: PropertyReview;
}

type RatingRow = {
    id: string;
    booking_id?: string | null;
    property_id: string;
    user_id?: string | null;
    rating: number;
    review?: string | null;
    type?: string | null;
    created_at: string;
    bookings?: {
        customer_name?: string | null;
    } | null;
};

const ELIGIBLE_BOOKING_STATUSES: Record<RatingType, string[]> = {
    checkin: ['checked-in', 'checked_in', 'checked-out', 'checked_out', 'completed'],
    checkout: ['checked-out', 'checked_out', 'completed'],
};

const normalizeRatingType = (value: unknown): RatingType =>
    String(value || '').trim().toLowerCase() === 'checkin'
        ? 'checkin'
        : 'checkout';

const mapRatingSummary = (row?: Record<string, unknown> | null): PropertyRatingSummary => ({
    avgRating: Number(row?.avg_rating || 0) || 0,
    totalRatings: Number(row?.total_ratings || 0) || 0,
});

const mapReview = (row: RatingRow): PropertyReview => ({
    id: row.id,
    bookingId: row.booking_id || null,
    propertyId: row.property_id,
    userId: row.user_id || null,
    rating: Number(row.rating || 0) || 0,
    review: String(row.review || '').trim(),
    createdAt: row.created_at,
    reviewerName: String(row.bookings?.customer_name || 'Guest User').trim() || 'Guest User',
    type: normalizeRatingType(row.type),
});

export const ratingService = {
    async getPropertyRatingSummary(propertyId: string): Promise<PropertyRatingSummary> {
        const { data, error } = await supabase
            .from('properties')
            .select('avg_rating, total_ratings')
            .eq('id', propertyId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return mapRatingSummary(data);
    },

    async getPropertyReviews(propertyId: string, limit = 20): Promise<PropertyReview[]> {
        const { data, error } = await supabase
            .from('ratings')
            .select('id, booking_id, property_id, user_id, rating, review, type, created_at, bookings(customer_name)')
            .eq('property_id', propertyId)
            .not('booking_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw error;
        }

        return (data || [])
            .map((row) => mapReview(row as RatingRow))
            .filter((review) => review.type === 'checkout' || review.review.length > 0);
    },

    subscribeToPropertyReviews(propertyId: string, callback: (reviews: PropertyReview[]) => void, limit = 20) {
        const fetchReviews = async () => {
            try {
                const reviews = await ratingService.getPropertyReviews(propertyId, limit);
                callback(reviews);
            } catch (error) {
                console.error('Error fetching property reviews:', error);
                callback([]);
            }
        };

        void fetchReviews();

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase
                .channel(`property-ratings-${propertyId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'ratings',
                    filter: `property_id=eq.${propertyId}`,
                }, () => {
                    void fetchReviews();
                })
                .subscribe();

            return () => {
                void supabase.removeChannel(channel);
            };
        });

        return () => {
            unsubscribeRealtime();
        };
    },

    async getUserBookingRating(userId: string, bookingId: string, type: RatingType): Promise<PropertyReview | null> {
        const normalizedBookingId = String(bookingId || '').trim();
        if (!normalizedBookingId) {
            return null;
        }

        const { data, error } = await supabase
            .from('ratings')
            .select('id, booking_id, property_id, user_id, rating, review, type, created_at, bookings(customer_name)')
            .eq('user_id', userId)
            .eq('booking_id', normalizedBookingId)
            .eq('type', type)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return data ? mapReview(data as RatingRow) : null;
    },

    async getUserPropertyRatingContext(
        userId: string,
        propertyId: string,
        type: RatingType = 'checkout'
    ): Promise<UserPropertyRatingContext> {
        const [existingRatingResult, eligibleBookingResult] = await Promise.all([
            supabase
                .from('ratings')
                .select('id, booking_id, property_id, user_id, rating, review, type, created_at, bookings(customer_name)')
                .eq('user_id', userId)
                .eq('property_id', propertyId)
                .not('booking_id', 'is', null)
                .eq('type', type)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('bookings')
                .select('id')
                .eq('customer_id', userId)
                .eq('property_id', propertyId)
                .in('status', ELIGIBLE_BOOKING_STATUSES[type])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        if (existingRatingResult.error) {
            throw existingRatingResult.error;
        }

        if (eligibleBookingResult.error) {
            throw eligibleBookingResult.error;
        }

        const existingRating = existingRatingResult.data
            ? mapReview(existingRatingResult.data as RatingRow)
            : null;

        const bookingId = existingRating?.bookingId
            || String(eligibleBookingResult.data?.id || '').trim()
            || null;

        return {
            bookingId,
            canRate: Boolean(existingRating || bookingId),
            existingRating,
            type,
        };
    },

    async upsertPropertyRating(input: UpsertPropertyRatingInput): Promise<UpsertPropertyRatingResult> {
        const bookingId = String(input.bookingId || '').trim();
        const propertyId = String(input.propertyId || '').trim();
        const userId = String(input.userId || '').trim();

        if (!bookingId) {
            throw new Error('Booking ID is required to submit a rating.');
        }

        if (!propertyId || !userId) {
            throw new Error('Property ID and user ID are required to submit a rating.');
        }

        const reviewText = String(input.review || '').trim();
        const payload = {
            booking_id: bookingId,
            property_id: propertyId,
            user_id: userId,
            type: input.type,
            rating: Math.max(1, Math.min(5, Math.round(input.rating))),
            review: reviewText || null,
        };

        const { data, error } = await supabase
            .from('ratings')
            .upsert(payload, {
                onConflict: 'booking_id,type',
            })
            .select('id, booking_id, property_id, user_id, rating, review, type, created_at, bookings(customer_name)')
            .single();

        if (error) {
            throw error;
        }

        const summary = await ratingService.getPropertyRatingSummary(propertyId);

        return {
            summary,
            review: mapReview(data as RatingRow),
        };
    },
};
