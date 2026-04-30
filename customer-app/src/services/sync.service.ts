import { db, type SyncAction } from '../db';
import { bookingService } from './booking.service';
import toast from 'react-hot-toast';

export const syncService = {
    startSync: async () => {
        if (!navigator.onLine) return;

        const pendingActions = await db.syncQueue.where('status').equals('PENDING').toArray();

        if (pendingActions.length === 0) {
            return;
        }

        const toastId = toast.loading(`Syncing ${pendingActions.length} offline actions...`);

        for (const action of pendingActions) {
            try {
                await syncService.processAction(action);
            } catch (error) {
                console.error(`[SyncService] Failed to process action ${action.id}:`, error);
                await db.syncQueue.update(action.id!, { status: 'FAILED' });
            }
        }

        toast.success('Sync complete!', { id: toastId });
    },

    processAction: async (action: SyncAction) => {
        switch (action.type) {
            case 'CREATE_BOOKING':
                await syncService.syncBooking(action);
                break;
            default:
                console.warn('[SyncService] Unknown action type:', action.type);
        }
    },

    syncBooking: async (action: SyncAction) => {
        const payload = action.payload;

        // 1. Create actual booking on server
        // Remove temp properties
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { tempId, ...bookingData } = payload as any;

        try {
            // Check if already synced (idempotency check could go here)
            await bookingService.createBooking(bookingData);

            // 2. Remove from Local Queue
            await db.syncQueue.delete(action.id!);

            // 3. Update Local Booking (Replace Temp ID with Real ID)
            const localBooking = await db.bookings.get({ bookingId: tempId });
            if (localBooking) {
                await db.bookings.delete(localBooking.localId!); // Delete temp
                // Ideally we would add the real one, but the subscription will catch it.
                // However, to prevent UI flicker, we could add it back as synced.
                /*
                await db.bookings.add({
                     ...bindingData,
                     bookingId: realId,
                     syncStatus: 'SYNCED'
                });
                */
            }

        } catch (error) {
            console.error('[SyncService] Booking sync error:', error);
            throw error;
        }
    }
};
