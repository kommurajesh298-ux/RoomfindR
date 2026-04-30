import React, { useEffect, useMemo, useState } from 'react';
import {
    IoCalendarOutline,
    IoFunnelOutline,
    IoRefreshOutline,
    IoStarOutline,
    IoTrendingUpOutline,
} from 'react-icons/io5';
import RatingStars from '../components/common/RatingStars';
import { useAuth } from '../hooks/useAuth';
import { propertyService } from '../services/property.service';
import {
    ratingService,
    type OwnerRatingFilters,
    type OwnerRatingRecord,
    type OwnerRatingsPageData,
} from '../services/rating.service';
import type { Property } from '../types/property.types';

const EMPTY_PAGE_DATA: OwnerRatingsPageData = {
    summary: {
        averageRating: 0,
        totalReviews: 0,
        ratedProperties: 0,
        ratingTrendLast30Days: null,
    },
    reviews: [],
};

const INITIAL_FILTERS: OwnerRatingFilters = {
    sortBy: 'latest',
};

const formatTrendLabel = (value: number | null) => {
    if (value === null) return 'No recent trend';
    if (value > 0) return `+${value.toFixed(1)} vs prior 30 days`;
    if (value < 0) return `${value.toFixed(1)} vs prior 30 days`;
    return 'No change vs prior 30 days';
};

const getReviewTypeLabel = (review: OwnerRatingRecord) =>
    review.type === 'checkin' ? 'Check-in' : 'Stay';

const Ratings: React.FC = () => {
    const { currentUser } = useAuth();
    const [filters, setFilters] = useState<OwnerRatingFilters>(INITIAL_FILTERS);
    const [pageData, setPageData] = useState<OwnerRatingsPageData>(EMPTY_PAGE_DATA);
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentUser?.uid) {
            setPageData(EMPTY_PAGE_DATA);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = ratingService.subscribeToOwnerRatingsPageData(currentUser.uid, filters, (data) => {
            setPageData(data);
            setLoading(false);
        });

        return unsubscribe;
    }, [currentUser?.uid, filters]);

    useEffect(() => {
        if (!currentUser?.uid) {
            setProperties([]);
            return;
        }

        const unsubscribe = propertyService.subscribeToOwnerProperties(currentUser.uid, (ownerProperties) => {
            setProperties(ownerProperties);
        });

        return unsubscribe;
    }, [currentUser?.uid]);

    const sortedProperties = useMemo(
        () => [...properties].sort((left, right) => left.title.localeCompare(right.title)),
        [properties],
    );

    const hasActiveFilters = Boolean(
        filters.propertyId
        || filters.rating
        || filters.dateFrom
        || filters.dateTo
        || (filters.sortBy && filters.sortBy !== 'latest'),
    );

    const handleFilterChange = <K extends keyof OwnerRatingFilters>(key: K, value: OwnerRatingFilters[K]) => {
        setFilters((previous) => ({
            ...previous,
            [key]: value || undefined,
        }));
    };

    const clearFilters = () => {
        setFilters(INITIAL_FILTERS);
    };

    const summaryCards = [
        {
            label: 'Average Rating',
            value: pageData.summary.totalReviews > 0 ? pageData.summary.averageRating.toFixed(1) : '--',
            helper: pageData.summary.totalReviews > 0 ? 'Across check-in and checkout reviews' : 'Waiting for the first rating',
            accent: 'from-orange-500/15 via-orange-100/60 to-white',
            icon: IoStarOutline,
        },
        {
            label: 'Total Reviews',
            value: String(pageData.summary.totalReviews),
            helper: 'Every booking-linked rating event',
            accent: 'from-blue-500/12 via-blue-100/55 to-white',
            icon: IoFunnelOutline,
        },
        {
            label: 'Rated Properties',
            value: String(pageData.summary.ratedProperties),
            helper: 'Properties with at least one rating',
            accent: 'from-emerald-500/12 via-emerald-100/55 to-white',
            icon: IoCalendarOutline,
        },
        {
            label: '30 Day Trend',
            value: pageData.summary.ratingTrendLast30Days === null
                ? '--'
                : pageData.summary.ratingTrendLast30Days > 0
                    ? `+${pageData.summary.ratingTrendLast30Days.toFixed(1)}`
                    : pageData.summary.ratingTrendLast30Days.toFixed(1),
            helper: formatTrendLabel(pageData.summary.ratingTrendLast30Days),
            accent: 'from-violet-500/12 via-violet-100/55 to-white',
            icon: IoTrendingUpOutline,
        },
    ];

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(220,252,231,0.45),_transparent_28%),linear-gradient(180deg,#ffffff_0%,#f9fafb_100%)] pb-20 md:pb-8">
            <div className="container mx-auto space-y-5 px-4 py-5">
                <div className="flex flex-col gap-3 rounded-[28px] border border-gray-100 bg-white/90 p-5 shadow-sm md:flex-row md:items-center md:justify-between md:p-6">
                    <div className="space-y-1">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-500">Trust And Conversion</p>
                        <h1 className="text-3xl font-black tracking-tight text-[var(--rf-color-text)] md:text-5xl">Ratings</h1>
                    </div>

                    <div className="inline-flex items-center gap-2 self-start rounded-full border border-orange-100 bg-orange-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600">
                        <IoRefreshOutline size={16} />
                        Live Realtime Feed
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
                    {summaryCards.map((card) => (
                        <div
                            key={card.label}
                            className="rounded-[24px] border border-gray-100 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(249,250,251,0.96))] p-3 shadow-sm transition-all hover:shadow-md md:p-5"
                        >
                            <div className={`rounded-[22px] bg-gradient-to-br ${card.accent} p-3 md:p-4`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">{card.label}</p>
                                        <p className="mt-2 text-2xl font-black tracking-tight text-[#1a1c2e] md:mt-3 md:text-3xl">{card.value}</p>
                                    </div>
                                    <div className="rounded-2xl border border-white/70 bg-white/80 p-2.5 text-orange-500 shadow-sm md:p-3">
                                        <card.icon size={18} />
                                    </div>
                                </div>
                                {card.label === 'Average Rating' ? (
                                    <div className="mt-3 md:mt-4">
                                        <RatingStars
                                            rating={pageData.summary.averageRating}
                                            starClassName="h-4 w-4 md:h-5 md:w-5"
                                            filledClassName="text-[#FF7A00]"
                                            emptyClassName="text-gray-300"
                                        />
                                    </div>
                                ) : null}
                                <p className="mt-3 text-xs leading-5 text-gray-500 md:mt-4 md:text-sm md:leading-6">{card.helper}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-sm md:p-6">
                    <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-500">Filter Reviews</p>
                            <h2 className="mt-2 text-2xl font-black text-[#1a1c2e]">Refine The Ratings Feed</h2>
                        </div>
                    </div>

                    <div className="mt-4 overflow-x-auto pb-1">
                        <div className="flex min-w-max items-end gap-3">
                        <label className="w-[220px] space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">Property</span>
                            <select
                                name="ratingsPropertyFilter"
                                value={filters.propertyId || ''}
                                onChange={(event) => handleFilterChange('propertyId', event.target.value || undefined)}
                                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#1a1c2e] outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                            >
                                <option value="">All Properties</option>
                                {sortedProperties.map((property) => (
                                    <option key={property.propertyId} value={property.propertyId}>
                                        {property.title}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="w-[180px] space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">Rating</span>
                            <select
                                name="ratingsScoreFilter"
                                value={filters.rating || ''}
                                onChange={(event) => handleFilterChange('rating', event.target.value ? Number(event.target.value) : undefined)}
                                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#1a1c2e] outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                            >
                                <option value="">All Ratings</option>
                                {[5, 4, 3, 2, 1].map((value) => (
                                    <option key={value} value={value}>
                                        {value} Star{value === 1 ? '' : 's'}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="w-[170px] space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">Date From</span>
                            <input
                                type="date"
                                name="ratingsDateFrom"
                                value={filters.dateFrom || ''}
                                onChange={(event) => handleFilterChange('dateFrom', event.target.value || undefined)}
                                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#1a1c2e] outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                            />
                        </label>

                        <label className="w-[170px] space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">Date To</span>
                            <input
                                type="date"
                                name="ratingsDateTo"
                                value={filters.dateTo || ''}
                                onChange={(event) => handleFilterChange('dateTo', event.target.value || undefined)}
                                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#1a1c2e] outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                            />
                        </label>

                        <label className="w-[190px] space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">Sort By</span>
                            <select
                                name="ratingsSortBy"
                                value={filters.sortBy || 'latest'}
                                onChange={(event) => handleFilterChange('sortBy', event.target.value as OwnerRatingFilters['sortBy'])}
                                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#1a1c2e] outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                            >
                                <option value="latest">Latest</option>
                                <option value="highest">Highest Rating</option>
                                <option value="lowest">Lowest Rating</option>
                            </select>
                        </label>
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="mb-0.5 inline-flex h-[50px] items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-100"
                        >
                            <IoRefreshOutline size={16} />
                            Clear Filters
                        </button>
                        </div>
                    </div>
                </div>

                <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-sm md:p-6">
                    <div className="flex flex-col gap-3 border-b border-gray-100 pb-5 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-500">Review Feed</p>
                            <h2 className="mt-2 text-2xl font-black text-[#1a1c2e]">All Ratings</h2>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-gray-600">
                            {pageData.reviews.length} Result{pageData.reviews.length === 1 ? '' : 's'}
                        </div>
                    </div>

                    <div className="mt-5 space-y-4">
                        {loading ? (
                            Array.from({ length: 3 }, (_, index) => (
                                <div key={index} className="animate-pulse rounded-[24px] border border-gray-100 bg-gray-50/80 p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-3">
                                            <div className="h-4 w-36 rounded-full bg-gray-200" />
                                            <div className="h-3 w-28 rounded-full bg-gray-200" />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="h-4 w-24 rounded-full bg-gray-200" />
                                            <div className="h-3 w-20 rounded-full bg-gray-200" />
                                        </div>
                                    </div>
                                    <div className="mt-4 h-4 w-full rounded-full bg-gray-200" />
                                    <div className="mt-2 h-4 w-4/5 rounded-full bg-gray-200" />
                                </div>
                            ))
                        ) : pageData.reviews.length > 0 ? (
                            pageData.reviews.map((review) => (
                                <div key={review.id} className="rounded-[24px] border border-gray-100 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(249,250,251,0.92))] p-5 shadow-sm transition-all hover:shadow-md">
                                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-lg font-black text-[#1a1c2e]">{review.reviewerName}</p>
                                                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                                                    review.type === 'checkin'
                                                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                                                        : 'border-orange-200 bg-orange-50 text-orange-600'
                                                }`}>
                                                    {getReviewTypeLabel(review)}
                                                </span>
                                            </div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">{review.propertyTitle}</p>
                                        </div>

                                        <div className="space-y-2 text-left md:text-right">
                                            <div className="flex items-center gap-3 md:justify-end">
                                                <RatingStars
                                                    rating={review.rating}
                                                    starClassName="h-5 w-5"
                                                    filledClassName="text-[#FF7A00]"
                                                    emptyClassName="text-gray-300"
                                                />
                                                <span className="text-sm font-black text-[#1a1c2e]">{review.rating.toFixed(1)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <p className="mt-4 text-sm leading-7 text-gray-600">
                                        {review.reviewText || 'Guest submitted a star rating without written feedback.'}
                                    </p>
                                </div>
                            ))
                        ) : (
                            <div className="rounded-[24px] border border-dashed border-gray-200 bg-gray-50/70 px-6 py-16 text-center">
                                <p className="text-xl font-black text-[#1a1c2e]">No ratings match the current filters</p>
                                <p className="mt-3 text-sm leading-6 text-gray-500">
                                    {hasActiveFilters
                                        ? 'Try clearing a filter or widening the date range to see more rating events.'
                                        : 'Check-in and checkout ratings will land here automatically as soon as guests submit them.'}
                                </p>
                                {hasActiveFilters ? (
                                    <button
                                        type="button"
                                        onClick={clearFilters}
                                        className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[var(--rf-color-action)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:bg-[var(--rf-color-action-hover)]"
                                    >
                                        <IoRefreshOutline size={16} />
                                        Reset Filters
                                    </button>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Ratings;
