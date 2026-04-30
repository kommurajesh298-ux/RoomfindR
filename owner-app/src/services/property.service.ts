import { supabase } from './supabase-config';
import type { Property, Room, FoodMenuItem, PropertyType } from '../types/property.types';
import { deferRealtimeSubscription } from './realtime-subscription';

const COLLECTION_NAME = 'properties';
const CATEGORY_TAGS = ['Boys', 'Girls', 'Hostel', 'Co-living'];
const OWNER_PROPERTY_SELECT = 'id, owner_id, title, description, address, city, locality, amenities, food_available, tags, images, monthly_rent, advance_deposit, rooms_available, total_rooms, status, auto_offer, avg_rating, total_ratings, full_payment_discount, created_at, updated_at';

type ScheduledFetcher = {
    flush: () => void;
    schedule: () => void;
    cancel: () => void;
};

const inferPropertyType = (tags?: string[]) =>
    tags?.find((tag) => CATEGORY_TAGS.includes(tag))?.toLowerCase();

const sanitizeAmount = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;

    const numericValue = typeof value === 'number'
        ? value
        : Number(String(value).replace(/,/g, '').trim());

    if (!Number.isFinite(numericValue)) return undefined;

    return Math.max(0, Math.round(numericValue * 100) / 100);
};

const compactPayload = <T extends Record<string, unknown>>(payload: T): Partial<T> =>
    Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Partial<T>;

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

export const propertyService = {
    createProperty: async (ownerId: string, propertyData: Partial<Property>): Promise<Property> => {
        try {
            const propertyType = inferPropertyType(propertyData.tags) || 'pg';
            const payload = compactPayload({
                owner_id: ownerId,
                title: propertyData.title,
                description: propertyData.description,
                property_type: propertyType,
                address: propertyData.address,
                city: propertyData.city,
                locality: propertyData.address?.text?.split(',')[0] || '',
                amenities: propertyData.features,
                food_available: propertyData.features?.meals || false,
                tags: propertyData.tags,
                images: propertyData.images,
                monthly_rent: sanitizeAmount(propertyData.pricePerMonth),
                advance_deposit: sanitizeAmount(propertyData.advanceAmount),
                status: 'draft',
                rooms_available: propertyData.vacancies || 0,
                auto_offer: propertyData.autoOffer
            });

            const { data, error } = await supabase.from(COLLECTION_NAME).insert(payload).select().single();
            if (error) throw error;
            return propertyService.mapToProperty(data);
        } catch (error) { console.error('Error creating property:', error); throw error; }
    },

    updateProperty: async (propertyId: string, updates: Partial<Property>): Promise<void> => {
        const propertyType = updates.tags ? (inferPropertyType(updates.tags) || 'pg') : undefined;
        const payload = compactPayload({
            title: updates.title,
            description: updates.description,
            property_type: propertyType,
            address: updates.address,
            city: updates.city,
            locality: updates.address?.text?.split(',')[0] || '',
            amenities: updates.features,
            food_available: updates.features?.meals || false,
            tags: updates.tags,
            images: updates.images,
            monthly_rent: sanitizeAmount(updates.pricePerMonth),
            advance_deposit: sanitizeAmount(updates.advanceAmount),
            rooms_available: updates.vacancies,
            auto_offer: updates.autoOffer,
            full_payment_discount: updates.fullPaymentDiscount,
            updated_at: new Date().toISOString()
        });

        const { error } = await supabase.from(COLLECTION_NAME).update(payload).eq('id', propertyId);
        if (error) throw error;
    },

    deleteProperty: async (propertyId: string): Promise<void> => {
        const { error } = await supabase.from(COLLECTION_NAME).delete().eq('id', propertyId);
        if (error) throw error;
    },

    publishProperty: async (propertyId: string): Promise<void> => {
        const { data, error } = await supabase.from(COLLECTION_NAME).update({
            status: 'published',
            published_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq('id', propertyId).select();

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("Property not found or access denied");
        }
    },

    subscribeToOwnerProperties: (ownerId: string, callback: (properties: Property[]) => void) => {
        const fetch = async () => {
            const { data } = await supabase
                .from(COLLECTION_NAME)
                .select(OWNER_PROPERTY_SELECT)
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });
            callback(data ? data.map(propertyService.mapToProperty) : []);
        };

        const scheduledFetch = createScheduledFetcher(fetch);
        scheduledFetch.flush();

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(`owner-props-${ownerId}`)
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: COLLECTION_NAME, filter: `owner_id=eq.${ownerId}`
                }, () => scheduledFetch.schedule())
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'rooms'
                }, () => scheduledFetch.schedule())
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'bookings'
                }, () => scheduledFetch.schedule())
                .subscribe();

            return () => { void supabase.removeChannel(channel); };
        });

        return () => {
            scheduledFetch.cancel();
            unsubscribeRealtime();
        };
    },

    addRoom: async (propertyId: string, roomData: Room): Promise<void> => {
        const { error } = await supabase.from('rooms').insert({
            property_id: propertyId,
            room_number: roomData.roomNumber,
            room_type: roomData.type,
            capacity: roomData.capacity || 1,
            booked_count: roomData.bookedCount || 0,
            price: roomData.price || 0,
            amenities: roomData.amenities || [],
            images: roomData.images || [],
            is_available: roomData.status === 'available' || (roomData.bookedCount || 0) < (roomData.capacity || 1)
        });
        if (error) throw error;
        await propertyService.syncPropertyVacancies(propertyId);
    },

    updateFoodMenu: async (propertyId: string, menu: FoodMenuItem[]): Promise<void> => {
        const { error } = await supabase.from('food_menu').upsert({
            property_id: propertyId,
            weekly_menu: menu
        }, {
            onConflict: 'property_id'
        });

        if (error) {
            console.error(`[PropertyService] Error updating food menu:`, error);
            throw error;
        }
    },

    uploadPropertyImages: async (propertyId: string, files: File[]): Promise<string[]> => {
        const urls: string[] = [];
        for (const file of files) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${propertyId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
            const { error: uploadError } = await supabase.storage.from('property-images').upload(fileName, file);
            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('property-images').getPublicUrl(fileName);
            urls.push(urlData.publicUrl);
        }
        return urls;
    },

    deletePropertyImage: async (imageUrl: string): Promise<void> => {
        const path = imageUrl.split('/storage/v1/object/public/property-images/')[1];
        if (path) {
            await supabase.storage.from('property-images').remove([path]);
        }
    },

    subscribeToRooms: (propertyId: string, callback: (rooms: Room[]) => void) => {
        supabase.from('rooms').select('*').eq('property_id', propertyId).then(({ data }) => {
            if (data) callback(data.map(r => propertyService.mapToRoom(r)));
        });
        const channel = supabase.channel(`rooms-${propertyId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'rooms', filter: `property_id=eq.${propertyId}`
        }, async () => {
            const { data } = await supabase.from('rooms').select('*').eq('property_id', propertyId);
            if (data) callback(data.map(r => propertyService.mapToRoom(r)));
        }).subscribe();
        return () => { supabase.removeChannel(channel); };
    },

    updateRoomOccupancy: async (propertyId: string, roomId: string, newValue: number) => {
        // In this schema, we probably want to update booked_count or similar
        const { error } = await supabase.from('rooms').update({ booked_count: newValue }).eq('id', roomId);
        if (error) throw error;
        await propertyService.syncPropertyVacancies(propertyId);
    },

    subscribeToFoodMenu: (propertyId: string, callback: (menu: FoodMenuItem[]) => void) => {
        supabase.from('food_menu').select('*').eq('property_id', propertyId).maybeSingle().then(({ data }) => {
            if (data && data.weekly_menu) {
                callback((data.weekly_menu as Record<string, unknown>[]).map(propertyService.mapToFoodMenuItem));
            } else {
                callback([]);
            }
        });

        const channel = supabase.channel(`food-${propertyId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'food_menu', filter: `property_id=eq.${propertyId}`
        }, async () => {
            const { data } = await supabase.from('food_menu').select('*').eq('property_id', propertyId).maybeSingle();
            if (data && data.weekly_menu) {
                callback((data.weekly_menu as Record<string, unknown>[]).map(propertyService.mapToFoodMenuItem));
            } else {
                callback([]);
            }
        }).subscribe();
        return () => { supabase.removeChannel(channel); };
    },

    updateRoom: async (propertyId: string, roomId: string, updates: Partial<Room>): Promise<void> => {
        const { error } = await supabase.from('rooms').update({
            room_number: updates.roomNumber,
            room_type: updates.type,
            capacity: updates.capacity,
            booked_count: updates.bookedCount,
            price: updates.price,
            amenities: updates.amenities,
            images: updates.images,
            is_available: updates.status === 'available' || (updates.bookedCount || 0) < (updates.capacity || 0)
        }).eq('id', roomId);
        if (error) throw error;
        await propertyService.syncPropertyVacancies(propertyId);
    },

    deleteRoom: async (propertyId: string, roomId: string): Promise<void> => {
        const { error } = await supabase.from('rooms').delete().eq('id', roomId);
        if (error) throw error;
        await propertyService.syncPropertyVacancies(propertyId);
    },

    uploadRoomImages: async (propertyId: string, roomId: string, files: File[]): Promise<string[]> => {
        const urls: string[] = [];
        for (const file of files) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${propertyId}/rooms/${roomId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
            const { error: uploadError } = await supabase.storage.from('property-images').upload(fileName, file);
            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('property-images').getPublicUrl(fileName);
            urls.push(urlData.publicUrl);
        }
        return urls;
    },

    savePropertyOffer: async (propertyId: string, offer: unknown): Promise<void> => {
        // We'll store offer in properties table JSONB or similar, or a separate offers table.
        // Assuming 'offers' table or 'autoOffer' column in property
        // Let's use 'auto_offer' column in properties based on usage
        const { error } = await supabase.from(COLLECTION_NAME).update({ auto_offer: offer }).eq('id', propertyId);
        if (error) throw error;
    },

    deletePropertyOffer: async (propertyId: string): Promise<void> => {
        // _offerId was previously here but unused.
        const { error } = await supabase.from(COLLECTION_NAME).update({ auto_offer: null }).eq('id', propertyId);
        if (error) throw error;
    },

    subscribeToProperty: (propertyId: string, callback: (property: Property) => void) => {
        supabase.from(COLLECTION_NAME).select(OWNER_PROPERTY_SELECT).eq('id', propertyId).single().then(({ data }) => {
            if (data) callback(propertyService.mapToProperty(data));
        });
        const refreshProperty = async () => {
            const { data } = await supabase.from(COLLECTION_NAME).select(OWNER_PROPERTY_SELECT).eq('id', propertyId).single();
            if (data) callback(propertyService.mapToProperty(data));
        };
        const channel = supabase.channel(`prop-${propertyId}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: COLLECTION_NAME, filter: `id=eq.${propertyId}`
            }, refreshProperty)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'rooms', filter: `property_id=eq.${propertyId}`
            }, refreshProperty)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'bookings', filter: `property_id=eq.${propertyId}`
            }, refreshProperty)
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    },

    syncPropertyVacancies: async (propertyId: string) => {
        const { data: rooms } = await supabase.from('rooms').select('capacity, booked_count').eq('property_id', propertyId);
        const totalVacancies = rooms?.reduce((acc, r) => {
            const capacity = Math.max(0, Number(r.capacity || 0));
            const bookedCount = Math.max(0, Number(r.booked_count || 0));
            return acc + Math.max(0, capacity - bookedCount);
        }, 0) || 0;
        const totalCapacity = rooms?.reduce((acc, r) => acc + Math.max(0, Number(r.capacity || 0)), 0) || 0;

        await supabase.from(COLLECTION_NAME).update({
            rooms_available: totalVacancies,
            total_rooms: totalCapacity
        }).eq('id', propertyId);

        return totalVacancies;
    },



    unpublishProperty: async (propertyId: string) => {
        const { error } = await supabase.from(COLLECTION_NAME).update({ status: 'draft' }).eq('id', propertyId);
        if (error) throw error;
    },

    getRoom: async (_propertyId: string, roomId: string) => {
        const { data } = await supabase.from('rooms').select('*').eq('id', roomId).single();
        if (data) return propertyService.mapToRoom(data);
        return null;
    },

    getPropertyById: async (propertyId: string): Promise<Property | null> => {
        const { data, error } = await supabase.from(COLLECTION_NAME).select(OWNER_PROPERTY_SELECT).eq('id', propertyId).single();
        if (error) return null;
        return propertyService.mapToProperty(data);
    },

    mapToProperty: (data: unknown): Property => {
        const d = data as Record<string, unknown>;

        // Helper to handle Supabase Array strings or real arrays
        const parseArray = (val: unknown): string[] => {
            if (Array.isArray(val)) return val;
            if (typeof val === 'string') {
                // Handle Supabase format: {url1,url2}
                const cleaned = val.replace(/^{|}$/g, '');
                return cleaned ? cleaned.split(',') : [];
            }
            return [];
        };

        // Helper to handle JSONB strings or real objects
        const parseJson = (val: unknown, fallback: unknown) => {
            if (typeof val === 'object' && val !== null) return val;
            if (typeof val === 'string') {
                try {
                    return JSON.parse(val);
                } catch {
                    return fallback;
                }
            }
            return fallback;
        };

        return {
            propertyId: d.id as string,
            ownerId: d.owner_id as string,
            title: d.title as string,
            description: d.description as string,
            address: parseJson(d.address, { text: '', lat: 0, lng: 0, pincode: '' }),
            city: d.city as string,
            tags: parseArray(d.tags),
            features: parseJson(d.amenities, { wifi: false, ac: false, meals: false, laundry: false, security: false }),
            pricePerMonth: parseFloat(String(d.monthly_rent || 0)),
            advanceAmount: parseFloat(String(d.advance_deposit || 0)),
            vacancies: d.rooms_available as number,
            totalRooms: d.total_rooms as number || 0,
            verified: d.status === 'published' || d.status === 'approved',
            published: d.status === 'published',
            images: parseArray(d.images),
            createdAt: d.created_at as string,
            updatedAt: d.updated_at as string,
            autoOffer: parseJson(d.auto_offer, null),
            avgRating: parseFloat(String(d.avg_rating || 0)) || 0,
            totalRatings: parseInt(String(d.total_ratings || 0), 10) || 0,
            fullPaymentDiscount: parseJson(d.full_payment_discount, null)
        } as Property;
    },

    mapToRoom: (data: unknown): Room => {
        const d = data as Record<string, unknown>;
        const capacity = parseInt(String(d.capacity || 1));
        const bookedCount = parseInt(String(d.booked_count || 0));

        const parseArray = (val: unknown): string[] => {
            if (Array.isArray(val)) return val;
            if (typeof val === 'string') {
                const cleaned = val.replace(/^{|}$/g, '');
                return cleaned ? cleaned.split(',').map(s => s.trim().replace(/^"|"$/g, '')) : [];
            }
            return [];
        };

        return {
            roomId: d.id as string,
            roomNumber: d.room_number as string,
            type: d.room_type as PropertyType,
            capacity: capacity,
            bookedCount: bookedCount,
            availableCount: capacity - bookedCount,
            price: parseFloat(String(d.price || 0)),
            status: d.is_available ? 'available' : 'occupied',
            amenities: Array.isArray(d.amenities) ? d.amenities : [],
            images: parseArray(d.images)
        };
    },

    mapToFoodMenuItem: (data: Record<string, unknown>): FoodMenuItem => ({
        dayOfWeek: String(data.dayOfWeek || data.day_of_week || ''),
        breakfast: String(data.breakfast || data.Breakfast || ''),
        lunch: String(data.lunch || data.Lunch || ''),
        dinner: String(data.dinner || data.Dinner || ''),
    })
};

