import { supabase } from './supabase-config';
import { deferRealtimeSubscription } from './realtime-subscription';

export type RatingType = 'checkin' | 'checkout';
export type OwnerRatingsSort = 'latest' | 'highest' | 'lowest';

export interface OwnerRatingFilters {
    propertyId?: string;
    rating?: number;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: OwnerRatingsSort;
}

export interface OwnerRatingRecord {
    id: string;
    ownerId: string;
    propertyId: string;
    propertyTitle: string;
    bookingId: string | null;
    reviewerName: string;
    rating: number;
    reviewText: string;
    createdAt: string;
    type: RatingType;
}

export interface OwnerRatingsSummary {
    averageRating: number;
    totalReviews: number;
    ratedProperties: number;
    ratingTrendLast30Days: number | null;
}

export interface OwnerRatingsPageData {
    summary: OwnerRatingsSummary;
    reviews: OwnerRatingRecord[];
}

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

type OwnerPropertyRatingRow = {
    id: string;
    title?: string | null;
    avg_rating?: number | null;
    total_ratings?: number | null;
};

type OwnerRatingRow = {
    id: string;
    owner_id?: string | null;
    property_id: string;
    booking_id?: string | null;
    rating: number;
    review?: string | null;
    type?: string | null;
    created_at: string;
    properties?: {
        title?: string | null;
    } | null;
    bookings?: {
        customer_name?: string | null;
    } | null;
};

type OwnerRatingTrendRow = {
    rating: number;
    created_at: string;
};

const EMPTY_SUMMARY: OwnerRatingsSummary = {
    averageRating: 0,
    totalReviews: 0,
    ratedProperties: 0,
    ratingTrendLast30Days: null,
};

const EMPTY_PAGE_DATA: OwnerRatingsPageData = {
    summary: EMPTY_SUMMARY,
    reviews: [],
};

const createScheduledFetcher = (fetcher: () => Promise<void>, waitMs = 250): ScheduledFetcher => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let rerunRequested = false;

    const execute = async () => {
        if (inFlight) {
            rerunRequested = true;
            return;
        }

        inFlight = true;
        try {
            await fetcher();
        } finally {
            inFlight = false;
            if (rerunRequested) {
                rerunRequested = false;
                schedule();
            }
        }
    };

    const schedule = () => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            timeout = null;
            void execute();
        }, waitMs);
    };

    const flush = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
        void execute();
    };

    const cancel = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
        rerunRequested = false;
    };

    return { flush, schedule, cancel };
};

const normalizeRatingType = (value: unknown): RatingType =>
    String(value || '').trim().toLowerCase() === 'checkin'
        ? 'checkin'
        : 'checkout';

const normalizeFilters = (filters: OwnerRatingFilters = {}) => {
    const normalizedRating = Number(filters.rating);

    return {
        propertyId: String(filters.propertyId || '').trim() || undefined,
        rating: Number.isInteger(normalizedRating) && normalizedRating >= 1 && normalizedRating <= 5
            ? normalizedRating
            : undefined,
        dateFrom: String(filters.dateFrom || '').trim() || undefined,
        dateTo: String(filters.dateTo || '').trim() || undefined,
        sortBy: filters.sortBy || 'latest',
    };
};

const getStartOfDayIso = (value: string) => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getEndOfDayIso = (value: string) => {
    const date = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const mapOwnerRatingRecord = (row: OwnerRatingRow): OwnerRatingRecord => ({
    id: row.id,
    ownerId: String(row.owner_id || '').trim(),
    propertyId: row.property_id,
    propertyTitle: String(row.properties?.title || 'Property').trim() || 'Property',
    bookingId: row.booking_id || null,
    reviewerName: String(row.bookings?.customer_name || 'Guest User').trim() || 'Guest User',
    rating: Number(row.rating || 0) || 0,
    reviewText: String(row.review || '').trim(),
    createdAt: row.created_at,
    type: normalizeRatingType(row.type),
});

const buildOwnerRatingsQuery = (ownerId: string, filters: OwnerRatingFilters = {}, limit = 100) => {
    const normalizedFilters = normalizeFilters(filters);

    let query = supabase
        .from('ratings')
        .select('id, owner_id, property_id, booking_id, rating, review, type, created_at, properties(title), bookings(customer_name)')
        .eq('owner_id', ownerId);

    if (normalizedFilters.propertyId) {
        query = query.eq('property_id', normalizedFilters.propertyId);
    }

    if (normalizedFilters.rating) {
        query = query.eq('rating', normalizedFilters.rating);
    }

    if (normalizedFilters.dateFrom) {
        const startIso = getStartOfDayIso(normalizedFilters.dateFrom);
        if (startIso) {
            query = query.gte('created_at', startIso);
        }
    }

    if (normalizedFilters.dateTo) {
        const endIso = getEndOfDayIso(normalizedFilters.dateTo);
        if (endIso) {
            query = query.lte('created_at', endIso);
        }
    }

    if (normalizedFilters.sortBy === 'highest') {
        query = query.order('rating', { ascending: false }).order('created_at', { ascending: false });
    } else if (normalizedFilters.sortBy === 'lowest') {
        query = query.order('rating', { ascending: true }).order('created_at', { ascending: false });
    } else {
        query = query.order('created_at', { ascending: false });
    }

    return query.limit(limit);
};

const calculateTrend = (rows: OwnerRatingTrendRow[]) => {
    if (rows.length === 0) return null;

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const currentPeriodStart = now - THIRTY_DAYS_MS;
    const previousPeriodStart = now - (THIRTY_DAYS_MS * 2);

    const currentRatings = rows.filter((row) => {
        const createdAt = new Date(row.created_at).getTime();
        return createdAt >= currentPeriodStart && createdAt <= now;
    });

    const previousRatings = rows.filter((row) => {
        const createdAt = new Date(row.created_at).getTime();
        return createdAt >= previousPeriodStart && createdAt < currentPeriodStart;
    });

    if (currentRatings.length === 0) {
        return null;
    }

    const currentAverage = currentRatings.reduce((sum, row) => sum + (Number(row.rating || 0) || 0), 0) / currentRatings.length;
    if (previousRatings.length === 0) {
        return Number(currentAverage.toFixed(1));
    }

    const previousAverage = previousRatings.reduce((sum, row) => sum + (Number(row.rating || 0) || 0), 0) / previousRatings.length;
    return Number((currentAverage - previousAverage).toFixed(1));
};

export const ratingService = {
    async getOwnerRatingsSummary(ownerId: string): Promise<OwnerRatingsSummary> {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const [{ data: propertyRows, error: propertiesError }, { data: trendRows, error: trendError }] = await Promise.all([
            supabase
                .from('properties')
                .select('id, title, avg_rating, total_ratings')
                .eq('owner_id', ownerId),
            supabase
                .from('ratings')
                .select('rating, created_at')
                .eq('owner_id', ownerId)
                .gte('created_at', sixtyDaysAgo.toISOString()),
        ]);

        if (propertiesError) {
            throw propertiesError;
        }

        if (trendError) {
            throw trendError;
        }

        const properties = (propertyRows || []) as OwnerPropertyRatingRow[];
        const totalReviews = properties.reduce((sum, row) => sum + (Number(row.total_ratings || 0) || 0), 0);
        const weightedRatingSum = properties.reduce((sum, row) => {
            const average = Number(row.avg_rating || 0) || 0;
            const total = Number(row.total_ratings || 0) || 0;
            return sum + (average * total);
        }, 0);

        return {
            averageRating: totalReviews > 0 ? Number((weightedRatingSum / totalReviews).toFixed(1)) : 0,
            totalReviews,
            ratedProperties: properties.filter((row) => Number(row.total_ratings || 0) > 0).length,
            ratingTrendLast30Days: calculateTrend((trendRows || []) as OwnerRatingTrendRow[]),
        };
    },

    async getOwnerRatings(ownerId: string, filters: OwnerRatingFilters = {}, limit = 100): Promise<OwnerRatingRecord[]> {
        const { data, error } = await buildOwnerRatingsQuery(ownerId, filters, limit);

        if (error) {
            throw error;
        }

        return (data || []).map((row) => mapOwnerRatingRecord(row as OwnerRatingRow));
    },

    async getOwnerRatingsPageData(ownerId: string, filters: OwnerRatingFilters = {}, limit = 100): Promise<OwnerRatingsPageData> {
        const [summary, reviews] = await Promise.all([
            ratingService.getOwnerRatingsSummary(ownerId),
            ratingService.getOwnerRatings(ownerId, filters, limit),
        ]);

        return {
            summary,
            reviews,
        };
    },

    subscribeToOwnerRatingsPageData(
        ownerId: string,
        filters: OwnerRatingFilters,
        callback: (data: OwnerRatingsPageData) => void,
        limit = 100,
    ) {
        const fetchPageData = async () => {
            try {
                const data = await ratingService.getOwnerRatingsPageData(ownerId, filters, limit);
                callback(data);
            } catch (error) {
                console.error('Error fetching owner ratings page data:', error);
                callback(EMPTY_PAGE_DATA);
            }
        };

        const scheduledFetch = createScheduledFetcher(fetchPageData);
        scheduledFetch.flush();

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const propertyChannel = supabase
                .channel(`owner-ratings-properties-${ownerId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'properties',
                    filter: `owner_id=eq.${ownerId}`,
                }, () => scheduledFetch.schedule())
                .subscribe();

            const ratingChannel = supabase
                .channel(`owner-ratings-list-${ownerId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'ratings',
                    filter: `owner_id=eq.${ownerId}`,
                }, () => scheduledFetch.schedule())
                .subscribe();

            return () => {
                void supabase.removeChannel(propertyChannel);
                void supabase.removeChannel(ratingChannel);
            };
        });

        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },
};
