import Dexie, { type Table } from 'dexie';
import type { Property } from './types/property.types';
import type { Booking } from './types/booking.types';

// Define schemas for our offline data
export interface OfflineProperty extends Property {
    id: string; // Dexie key path (mapped from propertyId)
    cachedAt: number;
}

export interface OfflineBooking extends Booking {
    syncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
    localId?: number; // Auto-incremented ID for local reference
}

export interface SyncAction {
    id?: number;
    type: 'CREATE_BOOKING' | 'UPDATE_PROFILE' | 'ADD_FAVORITE' | 'PAYMENT_REQUEST';
    payload: unknown;
}

export const addToSyncQueue = async (type: SyncAction['type'], payload: unknown) => {
    await db.syncQueue.add({
        type,
        payload,
        timestamp: Date.now(),
        status: 'PENDING',
        retryCount: 0
    });
};

class RoomFindRDatabase extends Dexie {
    properties!: Table<OfflineProperty, string>;
    bookings!: Table<OfflineBooking, number>;
    favorites!: Table<{ propertyId: string }, number>;
    syncQueue!: Table<SyncAction & { timestamp: number; status: string; retryCount: number }, number>;

    constructor() {
        super('RoomFindRDatabase');
        this.version(1).stores({
            properties: 'id, title, city, locality, monthly_rent, cachedAt',
            bookings: '++localId, bookingId, propertyId, syncStatus',
            favorites: '++id, propertyId',
            syncQueue: '++id, type, status, timestamp'
        });
    }
}

export const db = new RoomFindRDatabase();

export const clearDatabase = async () => {
    await db.bookings.clear();
    await db.properties.clear();
    await db.syncQueue.clear();
};
