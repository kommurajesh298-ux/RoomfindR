import type { Offer } from './booking.types';

export type PropertyType = 'WG' | 'Private' | 'Shared' | 'Dorm' | 'Single' | 'Double' | 'Triple' | 'Dormitory';

export interface Room {
    roomId: string;
    roomNumber: string;
    type: PropertyType;
    price: number;
    capacity: number;
    bookedCount: number;
    availableCount: number;
    status: 'available' | 'full' | 'occupied';
    amenities: string[];
    images: string[];
}

export interface FoodMenuItem {
    dayOfWeek: string;
    breakfast: string;
    lunch: string;
    dinner: string;
    timeTableUrl?: string;
}

export interface NearbyPlace {
    name: string;
    type: string;
    distanceInKm: number;
}

export interface Address {
    text: string;
    lat: number;
    lng: number;
    placeId?: string;
    pincode?: string;
}

export interface PropertyFeatures {
    wifi: boolean;
    ac: boolean;
    meals: boolean;
    laundry: boolean;
    security: boolean;
    [key: string]: boolean;
}

export interface Property {
    propertyId: string;
    ownerId: string;
    title: string;
    description: string;
    address: Address;
    city: string;
    tags: string[];
    features: PropertyFeatures;
    images: string[];
    pricePerMonth: number;
    foodPrice?: number; // Monthly food price
    advanceAmount: number;
    currency: string;
    vacancies: number;
    totalRooms: number;
    // rooms: Record<string, Room>; // Moved to subcollection
    foodMenu?: FoodMenuItem[];
    nearbyPlaces?: NearbyPlace[];
    verified: boolean;
    published: boolean;
    createdAt: string;
    updatedAt: string;
    autoOffer?: Offer;
    avgRating?: number;
    totalRatings?: number;
    fullPaymentDiscount?: {
        active: boolean;
        amount: number;
        type: 'percentage' | 'flat';
        minMonths: number;
    };
}

export interface PropertyFilters {
    city?: string;
    tags?: string[];
    priceRange?: {
        min: number;
        max: number;
    };
    features?: string[];
    searchQuery?: string;
    availability?: {
        start: string; // ISO date string
        end: string;
    };
    distanceRadius?: number; // in km
    sortBy?: SortOption;
}

export type SortOption = 'popular' | 'newest' | 'price-low' | 'price-high' | 'distance';
