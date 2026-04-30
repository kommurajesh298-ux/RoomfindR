import { supabase } from './supabase-config';
import { db } from '../db';
import type { Property, PropertyFilters, Room, FoodMenuItem, PropertyType } from '../types/property.types';
import type { Offer } from '../types/offer.types';
import { deferRealtimeSubscription } from './realtime-subscription';
import { favoritesService } from './favorites.service';

const PROPERTIES_TABLE = 'properties';
const PROPERTY_LIST_SELECT = 'id, owner_id, title, description, address, city, locality, tags, amenities, food_available, monthly_rent, advance_deposit, rooms_available, status, created_at, updated_at, auto_offer, avg_rating, total_ratings, full_payment_discount, images';

const propertyCache = new Map<string, { data: Property, timestamp: number }>();
const propertyListCache = new Map<string, { data: { properties: Property[]; totalCount: number }, timestamp: number }>();
const CACHE_TTL = 60000; // 60 seconds
const LIST_CACHE_TTL = 45000;

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

// Type definitions for DB rows to avoid 'any'
interface PropertyRow {
    id: string;
    owner_id: string;
    title: string;
    description: string;
    address: string | { text?: string; lat?: number; lng?: number; };
    city: string;
    locality?: string;
    tags: string[] | string | null;
    amenities: string[] | Record<string, boolean> | null;
    food_available: boolean;
    monthly_rent: number;
    advance_deposit: number;
    rooms_available: number;
    status: string;
    created_at: string;
    updated_at: string;
    auto_offer: {
        title?: string;
        value?: number;
        type?: string;
        subtitle?: string;
        code?: string;
    } | null;
    avg_rating?: number;
    total_ratings?: number;
    full_payment_discount?: string | {
        active: boolean;
        type: 'percentage' | 'flat';
        amount: number;
        minMonths?: number;
    } | null;
    images?: string[] | string | null;
}

const PROPERTY_TAG_ALIASES: Record<string, string> = {
    girls: 'Girls',
    boys: 'Boys',
    hostel: 'Hostel',
    'co-living': 'Co-living',
    coliving: 'Co-living',
    premium: 'Premium',
    luxury: 'Luxury',
    offers: 'offers',
    near_me: 'near_me'
};

const normalizeFilterTag = (tag: string) => {
    const trimmed = tag.trim();
    return PROPERTY_TAG_ALIASES[trimmed.toLowerCase()] || trimmed;
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

const buildPropertyListCacheKey = (
    filters: PropertyFilters,
    limitCount: number,
    page: number,
    userLocation?: { lat: number; lng: number }
) => JSON.stringify({
    city: filters.city || '',
    tags: (filters.tags || []).map(normalizeFilterTag).sort(),
    minPrice: filters.priceRange?.min ?? null,
    maxPrice: filters.priceRange?.max ?? null,
    features: (filters.features || []).slice().sort(),
    searchQuery: filters.searchQuery?.trim().toLowerCase() || '',
    distanceRadius: filters.distanceRadius ?? null,
    sortBy: filters.sortBy || 'popular',
    page,
    limitCount,
    userLocation: userLocation
        ? {
            lat: Number(userLocation.lat.toFixed(3)),
            lng: Number(userLocation.lng.toFixed(3)),
        }
        : null,
});

const getCachedPropertyList = (cacheKey: string) => {
    const cached = propertyListCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > LIST_CACHE_TTL) {
        propertyListCache.delete(cacheKey);
        return null;
    }
    return cached.data;
};

const setCachedPropertyList = (cacheKey: string, data: { properties: Property[]; totalCount: number }) => {
    propertyListCache.set(cacheKey, { data, timestamp: Date.now() });
};

const calculateDistanceKm = (
    leftLat: number,
    leftLng: number,
    rightLat: number,
    rightLng: number
) => {
    const R = 6371;
    const dLat = (rightLat - leftLat) * Math.PI / 180;
    const dLon = (rightLng - leftLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(leftLat * Math.PI / 180) * Math.cos(rightLat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return parseFloat((R * c).toFixed(1));
};

const hasPropertyCoordinates = (property: Property) =>
    Boolean(
        property.address.lat
        && property.address.lng
        && property.address.lat !== 0
        && property.address.lng !== 0
    );

const applyDistanceOrdering = (
    properties: Property[],
    activeSort: PropertyFilters['sortBy'],
    distanceRadius: number | undefined,
    userLocation?: { lat: number; lng: number },
) => {
    if (!userLocation) {
        return properties;
    }

    let nextProperties = properties.map((property) => {
        if (!hasPropertyCoordinates(property)) {
            return property;
        }

        return {
            ...property,
            distance: calculateDistanceKm(
                userLocation.lat,
                userLocation.lng,
                property.address.lat,
                property.address.lng
            ),
        };
    });

    if (activeSort === 'distance') {
        nextProperties = nextProperties
            .sort((left, right) => {
                const leftDistance = left.distance;
                const rightDistance = right.distance;

                if (leftDistance !== undefined && rightDistance !== undefined && leftDistance !== rightDistance) {
                    return leftDistance - rightDistance;
                }

                if (leftDistance !== undefined) return -1;
                if (rightDistance !== undefined) return 1;

                return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
            });
    }

    if (typeof distanceRadius === 'number' && Number.isFinite(distanceRadius) && distanceRadius > 0) {
        nextProperties = nextProperties.filter((property) =>
            typeof property.distance === 'number' && property.distance <= distanceRadius
        );
    }

    return nextProperties;
};

export const propertyService = {
    fetchPropertiesList: async (filters: PropertyFilters, limitCount: number = 20, page: number = 0, userLocation?: { lat: number; lng: number }): Promise<{ properties: Property[], totalCount: number }> => {
        let query = supabase.from(PROPERTIES_TABLE).select(PROPERTY_LIST_SELECT, { count: 'exact' }).eq('status', 'published');

        if (filters.city) {
            const city = filters.city.trim();
            if (city.toLowerCase() === 'bengaluru' || city.toLowerCase() === 'bangalore') {
                query = query.or(`city.ilike.%bengaluru%,city.ilike.%bangalore%,locality.ilike.%bengaluru%,locality.ilike.%bangalore%`);
            } else {
                query = query.or(`city.ilike.%${city}%,locality.ilike.%${city}%,address->>text.ilike.%${city}%`);
            }
        }

        if (filters.priceRange) {
            query = query.gte('monthly_rent', filters.priceRange.min);
            query = query.lte('monthly_rent', filters.priceRange.max);
        }

        if (filters.tags && filters.tags.length > 0) {
            const normalizedTags = filters.tags.map(normalizeFilterTag);
            const tagFilters = normalizedTags.filter(tag => tag !== 'near_me' && tag !== 'offers');
            if (tagFilters.length > 0) {
                query = query.contains('tags', tagFilters);
            }
            if (normalizedTags.includes('offers')) {
                query = query.not('auto_offer', 'is', null);
            }
        }

        const activeSort = filters.sortBy || 'popular';
        const hasDistanceRadius = typeof filters.distanceRadius === 'number'
            && Number.isFinite(filters.distanceRadius)
            && filters.distanceRadius > 0;
        const shouldProcessClientDistance = Boolean(userLocation) && (activeSort === 'distance' || hasDistanceRadius);
        switch (activeSort) {
            case 'newest':
                query = query.order('created_at', { ascending: false });
                break;
            case 'price-low':
                query = query.order('monthly_rent', { ascending: true });
                break;
            case 'price-high':
                query = query.order('monthly_rent', { ascending: false });
                break;
            default:
                query = query.order('views', { ascending: false });
                break;
        }

        if (filters.searchQuery) {
            const search = filters.searchQuery.trim();
            query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,locality.ilike.%${search}%,city.ilike.%${search}%`);
        }

        const from = page * limitCount;
        const to = from + limitCount - 1;
        if (!shouldProcessClientDistance) {
            query = query.range(from, to);
        }

        const { data, error, count } = await query;
        if (error) {
            throw error;
        }

        const orderedProperties = applyDistanceOrdering(
            (data || []).map((property) => propertyService.mapToProperty(property)),
            activeSort,
            filters.distanceRadius,
            userLocation,
        );
        const properties = shouldProcessClientDistance
            ? orderedProperties.slice(from, to + 1)
            : orderedProperties;

        return {
            properties,
            totalCount: count || 0,
        };
    },

    getProperties: async (filters: PropertyFilters, limitCount: number = 20, page: number = 0, userLocation?: { lat: number; lng: number }): Promise<{ properties: Property[], totalCount: number }> => {
        try {
            const cacheKey = buildPropertyListCacheKey(filters, limitCount, page, userLocation);
            const cached = getCachedPropertyList(cacheKey);
            if (cached) {
                return cached;
            }

            const result = await propertyService.fetchPropertiesList(filters, limitCount, page, userLocation);
            setCachedPropertyList(cacheKey, result);
            return result;
        } catch (error) { console.error('Error fetching properties:', error); throw error; }
    },

    getPropertyById: async (propertyId: string, userLocation?: { lat: number; lng: number }): Promise<Property | null> => {
        try {
            let property: Property | null = null;
            const now = Date.now();
            const memoryCached = propertyCache.get(propertyId);

            if (memoryCached && (now - memoryCached.timestamp < CACHE_TTL)) {

                return memoryCached.data;
            }

            const cached = await db.properties.get(propertyId);
            if (cached) {
                property = cached;
                if (!memoryCached || (now - memoryCached.timestamp >= CACHE_TTL)) {
                    propertyService.fetchAndCacheProperty(propertyId).catch(() => undefined);
                }
            } else {
                property = await propertyService.fetchAndCacheProperty(propertyId);
            }

            if (property && userLocation && property.address.lat && property.address.lng && property.address.lat !== 0) {
                const R = 6371;
                const dLat = (property.address.lat - userLocation.lat) * Math.PI / 180;
                const dLon = (property.address.lng - userLocation.lng) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(property.address.lat * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                property = { ...property, distance: parseFloat((R * c).toFixed(1)) };
            }

            return property;
        } catch (error) {
            console.error('[CRITICAL] getPropertyById failed:', { propertyId, error });
            return null;
        }
    },

    fetchAndCacheProperty: async (propertyId: string): Promise<Property | null> => {
        const { data, error } = await supabase.from(PROPERTIES_TABLE).select(PROPERTY_LIST_SELECT).eq('id', propertyId).maybeSingle();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw error;
        }
        if (!data) return null;

        const property = propertyService.mapToProperty(data);
        propertyCache.set(propertyId, { data: property, timestamp: Date.now() });

        try {
            // Map propertyId to id for Dexie storage (schema uses 'id' as key path)
            await db.properties.put({ ...property, id: property.propertyId, cachedAt: Date.now() });
        } catch (dbError) {
            console.error('[CRITICAL] Failed to cache property:', dbError);
        }

        return property;
    },

    subscribeToProperty: (propertyId: string, callback: (property: Property | null) => void, userLocation?: { lat: number; lng: number }) => {
        let disposed = false;

        const emitProperty = async (allowRetry = false) => {
            const property = await propertyService.getPropertyById(propertyId, userLocation);
            if (disposed) return;

            if (property || !allowRetry) {
                callback(property);
                return;
            }

            await new Promise((resolve) => setTimeout(resolve, 600));
            if (disposed) return;
            callback(await propertyService.getPropertyById(propertyId, userLocation));
        };

        void emitProperty(true);

        const scheduledFetch = createScheduledFetcher(async () => {
            await emitProperty(false);
        }, 180);

        const channel = supabase.channel(`property-${propertyId}`).on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: PROPERTIES_TABLE,
            filter: `id=eq.${propertyId}`,
        }, () => scheduledFetch.schedule()).subscribe();

        return () => {
            disposed = true;
            scheduledFetch.cancel();
            void supabase.removeChannel(channel);
        };
    },

    subscribeToRooms: (propertyId: string, callback: (rooms: Room[]) => void) => {
        supabase.from('rooms').select('*').eq('property_id', propertyId).then(({ data }) => { if (data) callback(data.map(r => propertyService.mapToRoom(r))); });
        const channel = supabase.channel(`rooms-${propertyId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `property_id=eq.${propertyId}` }, async () => {
            const { data } = await supabase.from('rooms').select('*').eq('property_id', propertyId);
            if (data) callback(data.map(r => propertyService.mapToRoom(r)));
        }).subscribe();
        return () => { supabase.removeChannel(channel); };
    },

    subscribeToFoodMenu: (propertyId: string, callback: (menu: FoodMenuItem[]) => void) => {
        supabase.from('food_menu').select('*').eq('property_id', propertyId).maybeSingle().then(({ data }) => {
            if (data && data.weekly_menu) {
                callback((data.weekly_menu as unknown as FoodMenuItem[]).map(propertyService.mapToFoodMenuItem));
            } else {
                callback([]);
            }
        });

        const channel = supabase.channel(`food-${propertyId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'food_menu', filter: `property_id=eq.${propertyId}`
        }, async () => {
            const { data } = await supabase.from('food_menu').select('*').eq('property_id', propertyId).maybeSingle();
            if (data && data.weekly_menu) {
                callback((data.weekly_menu as unknown as FoodMenuItem[]).map(propertyService.mapToFoodMenuItem));
            } else {
                callback([]);
            }
        }).subscribe();
        return () => { supabase.removeChannel(channel); };
    },

    subscribeToProperties: (filters: PropertyFilters, limitCount: number = 20, callback: (properties: Property[]) => void, userLocation?: { lat: number; lng: number }) => {
        const cacheKey = buildPropertyListCacheKey(filters, limitCount, 0, userLocation);
        const cached = getCachedPropertyList(cacheKey);
        if (cached) {
            callback(cached.properties);
        }

        let disposed = false;
        const scheduledFetch = createScheduledFetcher(async () => {
            try {
                const result = await propertyService.fetchPropertiesList(filters, limitCount, 0, userLocation);
                if (disposed) return;
                setCachedPropertyList(cacheKey, result);
                callback(result.properties);
            } catch (error) {
                if (!disposed) {
                    console.error('[PropertyService] Subscription update failed:', error);
                    callback(cached?.properties || []);
                }
            }
        });

        if (!cached) {
            scheduledFetch.flush();
        } else {
            scheduledFetch.schedule();
        }

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(`properties-${cacheKey}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: PROPERTIES_TABLE,
                }, () => scheduledFetch.schedule())
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'rooms',
                }, () => scheduledFetch.schedule())
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'bookings',
                }, () => scheduledFetch.schedule())
                .subscribe();

            return () => { void supabase.removeChannel(channel); };
        });

        return () => {
            disposed = true;
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },

    getPropertiesByIds: async (propertyIds: string[]): Promise<Record<string, Property>> => {
        const uniqueIds = [...new Set(propertyIds.filter(Boolean))];
        if (uniqueIds.length === 0) {
            return {};
        }

        const { data, error } = await supabase
            .from(PROPERTIES_TABLE)
            .select(PROPERTY_LIST_SELECT)
            .in('id', uniqueIds);

        if (error) {
            throw error;
        }

        return (data || []).reduce<Record<string, Property>>((accumulator, row) => {
            const property = propertyService.mapToProperty(row);
            propertyCache.set(property.propertyId, { data: property, timestamp: Date.now() });
            accumulator[property.propertyId] = property;
            return accumulator;
        }, {});
    },

    getFavorites: async (userId: string): Promise<string[]> => {
        return favoritesService.getFavorites(userId);
    },

    toggleFavorite: async (userId: string, propertyId: string): Promise<boolean> => {
        return favoritesService.toggleFavorite(userId, propertyId);
    },

    addToRecentlyViewed: (propertyId: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]') as any[];
        const updated = [propertyId, ...recentlyViewed.filter((id: string) => id !== propertyId)].slice(0, 10);
        localStorage.setItem('recentlyViewed', JSON.stringify(updated));
    },

    getRecentlyViewed: async (userLocation?: { lat: number; lng: number }): Promise<Property[]> => {
        const parsed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]') as unknown;
        const recentlyViewedIds = Array.isArray(parsed)
            ? parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            : [];

        if (recentlyViewedIds.length === 0) return [];

        try {
            // Always validate against live Supabase data so stale/deleted properties never show in recents.
            const { data, error } = await supabase
                .from(PROPERTIES_TABLE)
                .select('*')
                .in('id', recentlyViewedIds)
                .eq('status', 'published');

            if (error) throw error;

            const validProperties = (data || []).map(p => propertyService.mapToProperty(p));
            const validById = new Map(validProperties.map(p => [p.propertyId, p] as const));
            const validIds = new Set(validProperties.map(p => p.propertyId));
            const staleIds = recentlyViewedIds.filter(id => !validIds.has(id));

            if (staleIds.length > 0) {
                const cleanedIds = recentlyViewedIds.filter(id => validIds.has(id));
                localStorage.setItem('recentlyViewed', JSON.stringify(cleanedIds));
                await db.properties.bulkDelete(staleIds);
            }

            if (validProperties.length > 0) {
                await db.properties.bulkPut(
                    validProperties.map(p => ({ ...p, id: p.propertyId, cachedAt: Date.now() }))
                );
            }

            let ordered = recentlyViewedIds
                .map(id => validById.get(id))
                .filter((p): p is Property => p !== undefined);

            if (userLocation) {
                ordered = ordered.map(p => {
                    if (!p.address.lat || !p.address.lng || p.address.lat === 0 || p.address.lng === 0) return p;
                    const R = 6371;
                    const dLat = (p.address.lat - userLocation.lat) * Math.PI / 180;
                    const dLon = (p.address.lng - userLocation.lng) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(p.address.lat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return { ...p, distance: parseFloat((R * c).toFixed(1)) };
                });
            }

            return ordered;
        } catch (error) {
            console.error('Error in getRecentlyViewed:', error);
            // Strict behavior requested: if not confirmed from Supabase, do not show recents.
            return [];
        }
    },

    mapToProperty: (data: unknown): Property => {
        const d = data as PropertyRow;
        const parseArray = (val: unknown): string[] => {
            if (Array.isArray(val)) return val as string[];
            if (typeof val === 'string') {
                const cleaned = val.replace(/^{|}$/g, '');
                return cleaned ? cleaned.split(',').map(s => s.trim().replace(/^"|"$/g, '')) : [];
            }
            return [];
        };

        const amenities = d.amenities || {};
        const features = typeof amenities === 'object' && !Array.isArray(amenities)
            ? amenities
            : (Array.isArray(amenities)
                ? (amenities as string[]).reduce((acc: Record<string, boolean>, cur: string) => ({ ...acc, [cur.toLowerCase()]: true }), {})
                : {});

        return {
            propertyId: String(d.id),
            ownerId: String(d.owner_id),
            title: String(d.title),
            description: String(d.description),
            address: (() => {
                const addr = typeof d.address === 'string'
                    ? (() => { try { return JSON.parse(d.address) as { text?: string; lat?: number; lng?: number }; } catch { return {}; } })()
                    : (d.address as { text?: string; lat?: number; lng?: number } || {});
                let lat = parseFloat(String(addr.lat || 0));
                let lng = parseFloat(String(addr.lng || 0));

                if (lat === 0 || lng === 0) {
                    const locStr = ((d.title || '') + (d.locality || '') + (d.city || '') + (addr.text || '')).toLowerCase();
                    if (locStr.includes('btm')) { lat = 12.9166; lng = 77.6101; }
                    else if (locStr.includes('hsr')) { lat = 12.9121; lng = 77.6446; }
                    else if (locStr.includes('maratha')) { lat = 12.9592; lng = 77.6974; }
                    else if (locStr.includes('koramangala')) { lat = 12.9352; lng = 77.6245; }
                    else if (locStr.includes('indiranagar')) { lat = 12.9784; lng = 77.6408; }
                    else if (locStr.includes('jayanagar')) { lat = 12.9307; lng = 77.5832; }
                    else if (locStr.includes('jp nagar')) { lat = 12.9063; lng = 77.5857; }
                    else if (locStr.includes('whitefield')) { lat = 12.9698; lng = 77.7499; }
                    else if (locStr.includes('electronic city')) { lat = 12.8452; lng = 77.6633; }
                }

                return { text: addr.text || d.locality || '', lat, lng };
            })(),
            city: String(d.city),
            tags: parseArray(d.tags),
            features: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                wifi: Boolean((features as any).wifi),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ac: Boolean((features as any).ac),
                meals: Boolean(d.food_available),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                laundry: Boolean((features as any).laundry),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                security: Boolean((features as any).security),
                ...features
            },
            images: parseArray(d.images),
            pricePerMonth: parseFloat(String(d.monthly_rent)),
            advanceAmount: parseFloat(String(d.advance_deposit)),
            currency: 'INR',
            vacancies: Number(d.rooms_available),
            verified: d.status === 'published',
            published: d.status === 'published',
            createdAt: String(d.created_at),
            updatedAt: String(d.updated_at),
            autoOffer: d.auto_offer ? {
                title: String(d.auto_offer.title || ''),
                value: Number(d.auto_offer.value || 0),
                type: (d.auto_offer.type || 'flat') as 'percentage' | 'flat',
                subtitle: String(d.auto_offer.subtitle || 'Special Offer'),
                code: String(d.auto_offer.code || 'AUTO'),
                description: '',
                discount_type: (d.auto_offer.type || 'flat') as 'percentage' | 'fixed',
                discount_value: Number(d.auto_offer.value || 0),
                max_discount: 0,
                min_booking_amount: 0,
                max_uses: 0,
                current_uses: 0,
                is_active: true
            } as Offer : undefined,
            avgRating: Number(d.avg_rating) || 0,
            totalRatings: Number(d.total_ratings) || 0,
            fullPaymentDiscount: typeof d.full_payment_discount === 'string'
                ? JSON.parse(d.full_payment_discount)
                : (d.full_payment_discount || null)
        };
    },

    mapToRoom: (data: unknown): Room => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any;
        const parseArray = (val: unknown): string[] => {
            if (Array.isArray(val)) return val as string[];
            if (typeof val === 'string') {
                const cleaned = val.replace(/^{|}$/g, '');
                return cleaned ? cleaned.split(',').map(s => s.trim().replace(/^"|"$/g, '')) : [];
            }
            return [];
        };
        const rawType = String(d.room_type || '').toLowerCase();
        let mappedType: PropertyType = 'Single';
        if (rawType.includes('double')) mappedType = 'Double';
        else if (rawType.includes('triple')) mappedType = 'Triple';
        else if (rawType.includes('shared')) mappedType = 'Shared';
        else if (rawType.includes('dorm')) mappedType = 'Dorm';

        return {
            roomId: String(d.id),
            roomNumber: String(d.room_number),
            type: mappedType,
            price: parseFloat(String(d.price || 0)),
            capacity: parseInt(String(d.capacity || 1)),
            bookedCount: parseInt(String(d.booked_count || 0)),
            availableCount: parseInt(String(d.capacity || 1)) - parseInt(String(d.booked_count || 0)),
            status: d.is_available ? 'available' : 'full',
            amenities: Array.isArray(d.amenities) ? d.amenities : [],
            images: parseArray(d.images)
        };
    },

    mapToFoodMenuItem: (data: unknown): FoodMenuItem => {
        const d = data as FoodMenuItem;
        return {
            dayOfWeek: String(d.dayOfWeek || ''),
            breakfast: String(d.breakfast || ''),
            lunch: String(d.lunch || ''),
            dinner: String(d.dinner || ''),
        };
    }
};
