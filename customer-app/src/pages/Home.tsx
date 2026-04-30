import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { propertyService } from '../services/property.service';
import type { Property, PropertyFilters } from '../types/property.types';
import { createStaticLocation, isLiveLocation, isLocationInsecureOriginError, isLocationPermissionDeniedError, locationService } from '../services/location.service';
import { PropertyCard } from '../components/home/PropertyCard';
import { PropertyCardSkeleton } from '../components/home/PropertyCardSkeleton';
import { SectionHeading } from '../components/common/SectionHeading';
import { SortDropdown } from '../components/common/SortDropdown';
import { FilterChips } from '../components/home/FilterChips';
import { BannerCarousel } from '@components/home/BannerCarousel';
import { RecentViewed } from '../components/home/RecentViewed';
import { BookingModal } from '../components/home/BookingModal';
import { PincodeModal } from '../components/home/PincodeModal';
import { toast } from 'react-hot-toast';
import { useLayout } from '../hooks/useLayout';
import { IntersectionRender } from '../components/common/IntersectionRender';
import { getPincodeLocation } from '../data/pincode-map';


// Helper to get query params
const useQuery = () => {
    return new URLSearchParams(useLocation().search);
};

const shouldAutoDistanceSort = (
    location: { source?: 'profile' | 'manual' | 'live' | 'pincode' | null } | null | undefined
) =>
    Boolean(location?.source && location.source !== 'profile');

const hasSpecificSelectedArea = (
    location: { city?: string | null; displayName?: string | null } | null | undefined
) => {
    const city = String(location?.city || '').trim().toLowerCase();
    const displayName = String(location?.displayName || '').trim().toLowerCase();

    return Boolean(displayName && city && displayName !== city);
};

const getLocationDistanceRadius = (
    location: {
        source?: 'profile' | 'manual' | 'live' | 'pincode' | null;
        city?: string | null;
        displayName?: string | null;
    } | null | undefined,
    userPincode: string | null
) => {
    if (userPincode) return 5;
    if (!location) return undefined;
    if (location.source === 'live') return 5;
    if (location.source === 'pincode') return 5;
    if (hasSpecificSelectedArea(location)) return 5;
    return undefined;
};

const MOBILE_NAVBAR_EXPANDED_HEIGHT = 122;
const DESKTOP_FILTER_OFFSET = 72;
const FILTER_CHIP_TAGS = ['Girls', 'Boys', 'Co-living', 'Hostel', 'Premium', 'Luxury'] as const;

const readCssPixelVariable = (name: string, fallback: number) => {
    if (typeof window === 'undefined') return fallback;

    const rawValue = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const parsedValue = Number.parseFloat(rawValue);

    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const readMobileNavbarHeight = (fallback: number) => {
    if (typeof window === 'undefined') return fallback;

    const navbarHeight = document.querySelector('.rfm-navbar')?.getBoundingClientRect().height;
    if (typeof navbarHeight === 'number' && Number.isFinite(navbarHeight) && navbarHeight > 0) {
        return navbarHeight;
    }

    return readCssPixelVariable('--rfm-navbar-mobile-height', fallback);
};

const normalizeChipTags = (tags?: string[]) => {
    if (!tags || tags.length === 0) return undefined;

    const selectedChipTags = tags.filter((tag) => FILTER_CHIP_TAGS.includes(tag as typeof FILTER_CHIP_TAGS[number]));
    if (selectedChipTags.length <= 1) {
        return tags;
    }

    const latestChipTag = selectedChipTags[selectedChipTags.length - 1];
    const nonChipTags = tags.filter((tag) => !FILTER_CHIP_TAGS.includes(tag as typeof FILTER_CHIP_TAGS[number]));

    return [...nonChipTags, latestChipTag];
};

const Home: React.FC = () => {
    const { currentUser, userData } = useAuth();
    const navigate = useNavigate();
    const queryParams = useQuery();
    const location = useLocation();
    const {
        currentLocation,
        updateLocation,
        setShowNavbarSearch,
        setIsFiltered
    } = useLayout();
    const getPreferredStaticLocation = React.useCallback(() => {
        return locationService.getPreferredStaticLocation()
            || createStaticLocation(userData?.location?.city, 'profile');
    }, [userData?.location?.city]);

    const restorePreferredStaticLocation = React.useCallback(() => {
        const preferredLocation = getPreferredStaticLocation();
        if (preferredLocation) {
            updateLocation(preferredLocation);
        }
        return preferredLocation;
    }, [getPreferredStaticLocation, updateLocation]);

    // State
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);

    const [filters, setFilters] = useState<PropertyFilters>({
        searchQuery: queryParams.get('search') || undefined,
        tags: normalizeChipTags(queryParams.get('tags')?.split(',').filter(Boolean)),
        sortBy: (queryParams.get('sortBy') as PropertyFilters['sortBy']) || 'popular',
        city: currentLocation?.city || userData?.location?.city || undefined,
        features: queryParams.get('features')?.split(',').filter(Boolean) || undefined,
        priceRange: (queryParams.get('minPrice') || queryParams.get('maxPrice'))
            ? {
                min: Number(queryParams.get('minPrice') || 0),
                max: Number(queryParams.get('maxPrice') || 100000)
            }
            : undefined
    });

    const hasTextSearch = Boolean(filters.searchQuery?.trim());
    const hasTagFilters = Boolean(filters.tags && filters.tags.length > 0);
    const hasFeatureFilters = Boolean(filters.features && filters.features.length > 0);
    const hasPriceFilter = Boolean(filters.priceRange);
    const hasAvailabilityFilter = Boolean(filters.availability?.start || filters.availability?.end);
    const hasDistanceRadiusFilter = Boolean(filters.distanceRadius && filters.distanceRadius !== 10);
    const hasSortFilter = Boolean(filters.sortBy && filters.sortBy !== 'popular');
    const hasActiveFilters = Boolean(
        hasTextSearch
        || hasTagFilters
        || hasFeatureFilters
        || hasPriceFilter
        || hasAvailabilityFilter
        || hasDistanceRadiusFilter
        || hasSortFilter
    );
    const shouldShowHero = !hasTextSearch && !hasTagFilters;

    // Sync filter state with LayoutContext
    useEffect(() => {
        setIsFiltered(hasActiveFilters);
    }, [hasActiveFilters, setIsFiltered]);


    const [hasMore, setHasMore] = useState(true);
    const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());

    // Modals
    // Modals
    const [selectedBookingProperty, setSelectedBookingProperty] = useState<Property | null>(null);
    const [showPincodeModal, setShowPincodeModal] = useState(false);
    const [userPincode, setUserPincode] = useState<string | null>(() => {
        const stored = localStorage.getItem('user_pincode');
        return stored && /^\d{6}$/.test(stored) ? stored : null;
    });
    const lastAutoDistanceLocationRef = useRef('');
    const [isMobileViewport, setIsMobileViewport] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth < 768 : false
    );
    const [mobileNavbarOffset, setMobileNavbarOffset] = useState(() =>
        readMobileNavbarHeight(MOBILE_NAVBAR_EXPANDED_HEIGHT)
    );

    // Sync city from layout context
    useEffect(() => {
        if (!currentLocation?.city) return;
        const nextCity = userPincode ? 'Bengaluru' : currentLocation.city;
        if (nextCity !== filters.city) {
            setFilters(prev => ({ ...prev, city: nextCity }));
        }
    }, [currentLocation?.city, filters.city, userPincode]);

    useEffect(() => {
        const nextDistanceRadius = getLocationDistanceRadius(currentLocation, userPincode);
        if ((filters.distanceRadius ?? undefined) === nextDistanceRadius) return;

        setFilters(prev => ({
            ...prev,
            distanceRadius: nextDistanceRadius
        }));
    }, [currentLocation?.city, currentLocation?.displayName, currentLocation?.source, filters.distanceRadius, userPincode]);

    useEffect(() => {
        const autoDistanceEnabled = shouldAutoDistanceSort(currentLocation) || hasSpecificSelectedArea(currentLocation);
        const locationKey = autoDistanceEnabled
            ? `${currentLocation?.source || ''}:${currentLocation?.displayName || ''}:${currentLocation?.lat || ''}:${currentLocation?.lng || ''}`
            : '';

        if (!autoDistanceEnabled) {
            lastAutoDistanceLocationRef.current = '';
            return;
        }

        if (!locationKey || lastAutoDistanceLocationRef.current === locationKey) {
            return;
        }

        lastAutoDistanceLocationRef.current = locationKey;
        setFilters((prev) => prev.sortBy === 'distance' ? prev : ({ ...prev, sortBy: 'distance' }));

        const params = new URLSearchParams(location.search);
        if (params.get('sortBy') !== 'distance') {
            params.set('sortBy', 'distance');
            navigate(`/?${params.toString()}`, { replace: true });
        }
    }, [
        currentLocation,
        currentLocation?.displayName,
        currentLocation?.lat,
        currentLocation?.lng,
        currentLocation?.source,
        location.search,
        navigate,
    ]);

    // Sync all filters from URL - DEBOUNCED to prevent frame drops on rapid changes
    useEffect(() => {
        const handler = setTimeout(() => {
            const search = queryParams.get('search');
            const tags = normalizeChipTags(queryParams.get('tags')?.split(',').filter(Boolean));
            const sortBy = queryParams.get('sortBy') as PropertyFilters['sortBy'];
            const features = queryParams.get('features')?.split(',').filter(Boolean);
            const minPrice = queryParams.get('minPrice');
            const maxPrice = queryParams.get('maxPrice');

            setFilters(prev => {
                const newFilters = { ...prev };
                let changed = false;

                if (search !== prev.searchQuery) {
                    newFilters.searchQuery = search || undefined;
                    changed = true;
                }

                let finalTags = tags;
                if (sortBy === 'distance') finalTags = undefined;

                const prevTags = prev.tags || [];
                const newTags = finalTags || [];
                if (JSON.stringify(prevTags) !== JSON.stringify(newTags)) {
                    newFilters.tags = finalTags;
                    changed = true;
                }

                if (sortBy && sortBy !== prev.sortBy) {
                    newFilters.sortBy = sortBy;
                    changed = true;
                }

                const prevFeatures = prev.features || [];
                const newFeatures = features || [];
                if (JSON.stringify(prevFeatures) !== JSON.stringify(newFeatures)) {
                    newFilters.features = features || undefined;
                    changed = true;
                }

                if (minPrice || maxPrice) {
                    const newMin = Number(minPrice || 0);
                    const newMax = Number(maxPrice || 100000);
                    if (!prev.priceRange || prev.priceRange.min !== newMin || prev.priceRange.max !== newMax) {
                        newFilters.priceRange = { min: newMin, max: newMax };
                        changed = true;
                    }
                } else if (prev.priceRange && !minPrice && !maxPrice) {
                    newFilters.priceRange = undefined;
                    changed = true;
                }

                return changed ? newFilters : prev;
            });
        }, 100);

        return () => clearTimeout(handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search, currentLocation?.city]);

    // Load User Favorites
    useEffect(() => {
        if (currentUser) {
            propertyService.getFavorites(currentUser.id).then(favs => {
                setUserFavorites(new Set(favs));
            });
        } else {

            setUserFavorites(new Set());
        }
    }, [currentUser]);

    const [limit, setLimit] = useState(20);

    // Reset limit when critical filter params change (using primitives to avoid object ref churn)
    useEffect(() => {
        setLimit(20);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.city, JSON.stringify(filters.tags), JSON.stringify(filters.priceRange), JSON.stringify(filters.features), filters.sortBy]);

    // Real-time subscription for properties
    // Using Ref to track if we mean to actually re-subscribe
    const prevFiltersRef = React.useRef(filters);

    useEffect(() => {
        setLoading(true);

        let isCancelled = false;
        let cleanup: (() => void) | undefined;

        const fetchData = async () => {
            // 1. Try to get cached location first for instant update
            const cachedLoc = locationService.getCachedLocation();
            let effectiveLoc = currentLocation || cachedLoc || getPreferredStaticLocation();

            // If "Near Me" is active but we have no location, try fetching it
            if (((!currentLocation && filters.tags?.includes('near_me')) || filters.sortBy === 'distance') && !userPincode) {
                try {
                    if (!effectiveLoc || !isLiveLocation(effectiveLoc)) {
                        const loc = await locationService.getCurrentLocation();
                        effectiveLoc = loc;
                        if (!isCancelled) {
                            updateLocation(loc);
                        }
                    }
                } catch (e) {
                    if (!isLocationInsecureOriginError(e) && !isLocationPermissionDeniedError(e)) {
                        console.warn('Failed to get live location via GPS', e);
                    }
                }
            }

            if (isCancelled) return;

            // 2. Fetch properties
            // If userPincode is set, treat it as a search query override or fallback
            const activeFilters = { ...filters };
            if (userPincode) {
                const pincodeLocation = getPincodeLocation(userPincode);
                if (pincodeLocation) {
                    effectiveLoc = {
                        lat: pincodeLocation.lat,
                        lng: pincodeLocation.lng,
                        city: pincodeLocation.city,
                        displayName: pincodeLocation.locality,
                        source: 'pincode'
                    };
                    activeFilters.city = pincodeLocation.city;
                } else {
                    activeFilters.city = getPreferredStaticLocation()?.city || effectiveLoc?.city;
                }
            }

            const locationDistanceRadius = getLocationDistanceRadius(effectiveLoc, userPincode);
            if (locationDistanceRadius) {
                activeFilters.distanceRadius = locationDistanceRadius;
                if (!activeFilters.sortBy || activeFilters.sortBy === 'popular') {
                    activeFilters.sortBy = 'distance';
                }
            } else {
                activeFilters.distanceRadius = undefined;
            }

            cleanup = propertyService.subscribeToProperties(
                activeFilters,
                limit,
                (updatedProps) => {
                    if (isCancelled) return;
                    setProperties(updatedProps);
                    setLoading(false);
                    setHasMore(updatedProps.length >= limit);
                },
                effectiveLoc ? { lat: effectiveLoc.lat, lng: effectiveLoc.lng } : undefined
            );
        };

        fetchData().catch((error) => {
            if (isCancelled) return;
            console.error('[Home] Failed to subscribe to properties:', error);
            setProperties([]);
            setLoading(false);
            setHasMore(false);
        });

        // Update ref for next run
        prevFiltersRef.current = filters;

        return () => {
            isCancelled = true;
            cleanup?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(filters), getPreferredStaticLocation, limit, currentLocation?.city, currentLocation?.displayName, currentLocation?.lat, currentLocation?.lng, currentLocation?.source, updateLocation, userPincode]);


    // Keep the mobile home navbar fully expanded so the filter strip always
    // sticks to one stable offset instead of chasing a collapsing header.
    useEffect(() => {
        setShowNavbarSearch(true);
        return () => {
            setShowNavbarSearch(true);
        };
    }, [setShowNavbarSearch]);


    // Handlers
    const handleChipSelect = (tag: string | undefined) => {
        // Chip selected
        const params = new URLSearchParams(location.search);
        const pincodeLocation = userPincode ? getPincodeLocation(userPincode) : null;
        const activeLocationCity = pincodeLocation?.city
            || currentLocation?.city
            || getPreferredStaticLocation()?.city
            || userData?.location?.city
            || filters.city;
        const nextDistanceRadius = getLocationDistanceRadius(currentLocation, userPincode);

        // Keep the currently selected location and clear only the discovery-chip category.
        if (!tag || tag === 'all') {
            params.delete('tags');

            setFilters(prev => ({
                ...prev,
                tags: undefined,
                city: activeLocationCity || prev.city,
                distanceRadius: nextDistanceRadius,
                sortBy: nextDistanceRadius && (!prev.sortBy || prev.sortBy === 'popular')
                    ? 'distance'
                    : prev.sortBy
            }));
            navigate(params.toString() ? `/?${params.toString()}` : '/');
            return;
        }

        // 2. Handle "Near Me" Toggle
        if (tag === 'near_me') {
            // Check if it WAS already active (toggle off)
            const wasActive = filters.sortBy === 'distance';

            if (wasActive) {
                // Toggled off -> keep the current selected location instead of
                // jumping back to the saved/default city.
                params.set('sortBy', 'popular');
                setFilters(prev => ({
                    ...prev,
                    sortBy: 'popular',
                    city: activeLocationCity || prev.city,
                    distanceRadius: nextDistanceRadius
                }));
                toast('Near Me disabled');
                navigate(`/?${params.toString()}`);
            } else {
                params.delete('tags');
                params.set('sortBy', 'distance');

                // 1. Update state immediately (Optimistic UI)
                setFilters(prev => ({ ...prev, tags: undefined, sortBy: 'distance' }));

                // 2. Navigate immediately
                navigate(`/?${params.toString()}`);

                setLoading(true);

                // 3. Start location fetch
                locationService.getCurrentLocation()
                    .then(loc => {
                        updateLocation(loc);
                        toast.success('Live location enabled');
                    })
                    .catch(err => {
                        if (!isLocationInsecureOriginError(err) && !isLocationPermissionDeniedError(err)) {
                            console.warn('Geolocation error:', err);
                        }

                        if (isLocationInsecureOriginError(err)) {
                            toast.error('Live location needs HTTPS or localhost.');
                        } else if (isLocationPermissionDeniedError(err)) {
                            toast.error('Location permission denied.');
                        } else {
                            restorePreferredStaticLocation();
                            // Fallback to cached or default
                            toast('Using default location', { icon: '📍' });
                        }
                    })
                    .finally(() => setLoading(false));
            }
            return;
        }

        // 3. Handle Regular Tags (Categories, Amenities, Offers)
        else {
            const currentTags = (params.get('tags') || '').split(',').filter(Boolean);
            const currentChipTag = currentTags.find((currentTag) =>
                FILTER_CHIP_TAGS.includes(currentTag as typeof FILTER_CHIP_TAGS[number])
            );

            if (currentChipTag === tag) {
                // Toggled off -> Remove the active chip tag only
                const newTags = currentTags.filter(currentTag => currentTag !== tag);
                if (newTags.length > 0) params.set('tags', newTags.join(','));
                else params.delete('tags');
            } else {
                // Keep non-chip tags from the filter panel, but allow only one active discovery chip.
                const nonChipTags = currentTags.filter((currentTag) =>
                    !FILTER_CHIP_TAGS.includes(currentTag as typeof FILTER_CHIP_TAGS[number])
                );
                const newTags = [...nonChipTags, tag];
                params.set('tags', newTags.join(','));
                // Also reset "Near Me" sort to popular when a tag is selected
                params.set('sortBy', 'popular');
            }

            navigate(`/?${params.toString()}`);

        }
    };

    // ... [Other handlers like handleBook, handleView, handleSave, handleClaimOffer remain unchanged]

    const handleBook = (id: string) => {
        if (!currentUser) {
            navigate('/login', { state: { from: '/' } });
            return;
        }
        const prop = properties.find(p => p.propertyId === id);
        if (prop) setSelectedBookingProperty(prop);
    };

    const handleView = (id: string) => {
        propertyService.addToRecentlyViewed(id);

        navigate(`/property/${id}`);
    };

    const handleSave = async (id: string) => {
        if (!currentUser) {
            navigate('/login');
            return;
        }

        const isFav = userFavorites.has(id);
        const newFavs = new Set(userFavorites);
        if (isFav) newFavs.delete(id);
        else newFavs.add(id);
        setUserFavorites(newFavs);

        try {
            await propertyService.toggleFavorite(currentUser.id, id);

            toast.success(isFav ? 'Removed from favorites' : 'Saved to favorites');
        } catch (e) {
            setUserFavorites(userFavorites);
            console.error("Failed to save", e);
            toast.error("Failed to save property");
        }
    };



    // Sticky Filter Logic
    const [isFilterStuck, setIsFilterStuck] = useState(false);
    const filterRef = useRef<HTMLDivElement>(null);
    const filterSentinelRef = useRef<HTMLDivElement>(null);
    const shouldPinFiltersBelowNavbar = hasActiveFilters && !shouldShowHero;
    const filterStickyStyle = isMobileViewport
        ? (
            shouldPinFiltersBelowNavbar
                ? { top: `${mobileNavbarOffset}px`, marginTop: `${mobileNavbarOffset}px` }
                : { top: `${mobileNavbarOffset}px` }
        )
        : (shouldPinFiltersBelowNavbar ? { top: `${DESKTOP_FILTER_OFFSET}px`, marginTop: '12px' } : { top: `${DESKTOP_FILTER_OFFSET}px` });

    useEffect(() => {
        let frame = 0;

        const syncViewportMetrics = () => {
            setIsMobileViewport(window.innerWidth < 768);
            setMobileNavbarOffset(readMobileNavbarHeight(MOBILE_NAVBAR_EXPANDED_HEIGHT));
        };

        const requestSync = () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
            frame = window.requestAnimationFrame(syncViewportMetrics);
        };

        requestSync();

        const navbarElement = document.querySelector<HTMLElement>('.rfm-navbar');
        const observer = typeof ResizeObserver === 'undefined' || !navbarElement
            ? null
            : new ResizeObserver(() => requestSync());

        if (observer && navbarElement) {
            observer.observe(navbarElement);
        }
        window.addEventListener('resize', requestSync);

        return () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
            observer?.disconnect();
            window.removeEventListener('resize', requestSync);
        };
    }, []);

    useEffect(() => {
        if (shouldPinFiltersBelowNavbar) {
            setIsFilterStuck(true);
            return;
        }

        const sentinel = filterSentinelRef.current;
        if (!sentinel) return;

        const stickyOffset = isMobileViewport ? mobileNavbarOffset : DESKTOP_FILTER_OFFSET;

        const observer = new IntersectionObserver(
            ([entry]) => {
                setIsFilterStuck(!entry.isIntersecting);
            },
            {
                threshold: 0,
                rootMargin: `-${stickyOffset + 1}px 0px 0px 0px`,
            }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [isMobileViewport, mobileNavbarOffset, shouldPinFiltersBelowNavbar]);

    return (
        <div className="rfm-home-page min-h-screen pb-18 lg:pb-8">

            {/* 1. Hero Banner Section (Merged for Mobile) */}
            {shouldShowHero && (
                <div className="relative">
                    {/* Desktop/Tablet Banner (Unchanged) */}
                    <div className="hidden sm:block max-w-[1400px] mx-auto px-3 md:px-5 pt-3 lg:pt-2">
                        <div className="rfm-hero-desktop-frame relative h-[220px] md:h-[244px] lg:h-[256px] xl:h-[276px] overflow-hidden rounded-[28px] md:rounded-[32px]">
                            <BannerCarousel />
                        </div>
                    </div>

                    {/* Mobile Premium Hero (Stacked Layout) */}
                    <div
                        className={[
                            'rfm-mobile-hero-shell rfm-hero is-expanded sm:hidden w-full'
                        ].join(' ')}
                        style={{ paddingTop: `${mobileNavbarOffset}px` }}
                    >
                        <div
                            className="rfm-hero-banner w-full relative z-10 px-0 pb-0"
                        >
                            <div className="rfm-hero-banner-frame relative h-[172px] w-full overflow-hidden">
                                <BannerCarousel />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Category Filter Slider (Overlapping on Mobile) */}
            <div ref={filterSentinelRef} aria-hidden="true" className="h-px w-full" />
            <div
                ref={filterRef}
                className={`rfm-filter-sticky sticky ${shouldPinFiltersBelowNavbar ? 'rfm-filter-sticky--below-navbar' : ''} z-40 pb-0 pt-0 ${isFilterStuck ? 'is-stuck' : 'is-resting'}`}
                style={filterStickyStyle}
            >
                <div className="max-w-[1400px] mx-auto px-0 sm:px-0 lg:px-6">
                    <FilterChips
                        activeFilter={(() => {
                            const urlSort = queryParams.get('sortBy');
                            const stateSort = filters.sortBy;
                            const isNearBy = urlSort === 'distance' || stateSort === 'distance';

                            const urlTags = queryParams.get('tags')?.split(',').filter(Boolean) || [];
                            const stateTags = filters.tags || [];
                            const tags = isNearBy ? [] : (urlTags.length > 0 ? normalizeChipTags(urlTags) || [] : stateTags);

                            if (isNearBy) return 'near_me';
                            return tags.find((tag) => FILTER_CHIP_TAGS.includes(tag as typeof FILTER_CHIP_TAGS[number])) || 'all';
                        })()}
                        onFilterChange={handleChipSelect}
                    />
                </div>
            </div>

            {/* Recently Viewed */}
            {
                shouldShowHero && (
                    <RecentViewed />
                )
            }

            {/* Results Section */}
            <section className={`rfm-listing-section pb-3 bg-listing-section relative z-0 lg:pb-6 ${shouldPinFiltersBelowNavbar ? 'rfm-listing-section--filters-pinned pt-0 sm:mt-0 sm:pt-3' : hasActiveFilters ? 'mt-0 pt-0 sm:mt-0 sm:pt-3' : 'pt-0'}`}>
                <div className="mx-auto max-w-[1680px] px-1.5 sm:px-4 md:px-6 lg:px-4 xl:px-5">
                    <div className="rfm-results-shell pt-0">
                    {/* Results Header */}
                    <div className="rfm-results-header mb-2 flex items-start justify-between gap-2 md:mb-3 lg:mb-4">
                        <div className="min-w-0 flex-1">
                            <div className="rfm-results-heading flex items-start justify-between gap-2">
                                <SectionHeading
                                    title={filters.searchQuery ? `Results for "${filters.searchQuery}"` : "Available PGs & Hostels"}
                                    icon={
                                        !(filters.searchQuery || (filters.tags && filters.tags.length > 0) || filters.sortBy === 'distance') || !isMobileViewport ? (
                                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                            </svg>
                                        ) : undefined
                                    }
                                    variant="listing"
                                />
                                <div className="mt-1 shrink-0 rounded-full border border-[#FFD7B8] bg-[linear-gradient(135deg,#FFF1E7_0%,#FFE2CA_100%)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#F47A20] shadow-[0_8px_18px_rgba(244,122,32,0.18)] sm:px-3 sm:text-[11px]">
                                    {loading ? 'Loading...' : `${properties.length} ${properties.length === 1 ? 'PG' : 'PGs'}`}
                                </div>
                            </div>
                        </div>

                        <div className="shrink-0 self-start sm:ml-4 lg:ml-6">
                            <SortDropdown
                                value={filters.sortBy || 'popular'}

                                onChange={(val: string) => setFilters(prev => ({ ...prev, sortBy: val as PropertyFilters['sortBy'] }))}
                                options={[
                                    { value: 'popular', label: 'Popular' },
                                    { value: 'newest', label: 'Newest' },
                                    { value: 'price-low', label: 'Price: Low to High' },
                                    { value: 'price-high', label: 'Price: High to Low' },
                                    { value: 'distance', label: 'Distance' }
                                ]}
                            />
                        </div>
                    </div>

                    {/* Grid with Simple Virtualization (Lazy Rendering) */}
                    <div className="rfm-card-grid mx-0 grid grid-cols-2 gap-1 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4 lg:gap-4 xl:grid-cols-4 xl:gap-5 2xl:grid-cols-5">
                        {loading ? (
                            Array.from({ length: 8 }).map((_, i) => <PropertyCardSkeleton key={i} />)
                        ) : properties.length > 0 ? (
                            properties.map((property) => (
                                <IntersectionRender key={property.propertyId} height={350} offset={300}>
                                    <PropertyCard
                                        property={property}
                                        onView={handleView}
                                        onBook={handleBook}
                                        onToggleFavorite={handleSave}
                                        isFavorite={userFavorites.has(property.propertyId)}
                                    />
                                </IntersectionRender>
                            ))
                        ) : (
                            // Empty State
                            <div className="rfm-empty-state col-span-full py-16 text-center">
                                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#EFF4FF]">
                                    <svg className="h-9 w-9 text-[#255CF0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                                    </svg>
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">No properties found</h3>
                                <p className="text-gray-600 mb-6">Try adjusting your filters or search criteria</p>
                                <button
                                    onClick={() => {
                                        setFilters(prev => ({
                                            city: prev.city,
                                            tags: undefined,
                                            sortBy: 'popular',
                                            searchQuery: undefined,
                                            priceRange: undefined,
                                            features: undefined
                                        }));
                                        navigate('/');
                                        toast.success('Filters cleared');
                                    }}
                                    className="mt-6 h-[46px] md:h-auto rounded-[14px] bg-[#255CF0] px-8 text-[14px] font-semibold text-white shadow-[0_12px_24px_rgba(37,92,240,0.18)] transition-all active:scale-95 hover:bg-[#F47A20] md:rounded-[14px] md:py-2.5 md:text-base md:normal-case uppercase"
                                >
                                    Clear Filters
                                </button>
                            </div>
                        )}
                    </div>
                    </div>
                </div>
            </section>

            {hasMore && !loading && (
                <div className="mt-8 px-4 text-center">
                    <button
                        onClick={() => setLimit(prev => prev + 20)}
                        className="h-[46px] w-full rounded-[14px] border border-[#D1D5DB] bg-white px-8 text-[14px] font-semibold text-gray-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition-all active:scale-95 hover:border-[#FFD0AE] hover:bg-[#FFF4EC] hover:text-[#F47A20] md:h-auto md:w-auto md:rounded-[14px] md:py-2.5 md:text-base md:normal-case uppercase"
                    >
                        Load More Properties
                    </button>
                </div>
            )}



            {/* Modals */}
            {
                selectedBookingProperty && (
                    <BookingModal
                        property={selectedBookingProperty!}
                        onClose={() => setSelectedBookingProperty(null)}
                        onViewDetails={handleView}
                    />
                )
            }


            {/* Pincode Modal */}
            <PincodeModal
                isOpen={showPincodeModal}
                onClose={() => setShowPincodeModal(false)}
                onPincodeSelect={(pincode: string) => {
                    setUserPincode(pincode);
                    const pincodeLocation = getPincodeLocation(pincode);
                    if (pincodeLocation) {
                        updateLocation({
                            lat: pincodeLocation.lat,
                            lng: pincodeLocation.lng,
                            city: pincodeLocation.city,
                            displayName: pincodeLocation.locality,
                            source: 'pincode'
                        });
                        toast.success(`Showing properties near ${pincodeLocation.locality} (${pincode})`);
                    } else {
                        toast.success(`Showing properties in pincode ${pincode}`);
                    }
                }}
            />

        </div >
    );
};

export default Home;
