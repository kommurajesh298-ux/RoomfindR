import { supabase } from './supabase-config';
import { deferRealtimeSubscription } from './realtime-subscription';
import { browserNotificationService } from './browser-notification.service';

export interface OwnerNotification {
    id: string;
    user_id: string;
    title: string;
    message: string;
    type: 'booking' | 'message' | 'property' | 'system' | 'offer' | 'chat';
    notification_type?: string | null;
    room_id?: string;
    sender_name?: string;
    pg_name?: string;
    is_read: boolean;
    created_at: string;
}

type NotificationSubscriber = (notifications: OwnerNotification[]) => void;

type NotificationStore = {
    notifications: OwnerNotification[];
    listeners: Set<NotificationSubscriber>;
    unsubscribeRealtime?: () => void;
    initialized: boolean;
    refreshPromise?: Promise<void>;
};

const OWNER_ONE_TIME_NOTIFICATION_TYPES = new Set([
    'settlement_completed',
    'settlement_failed'
]);

const stores = new Map<string, NotificationStore>();

const readSeenNotificationIds = (ownerId: string) => {
    if (typeof window === 'undefined') {
        return new Set<string>();
    }

    try {
        const raw = window.localStorage.getItem(`owner-notification-seen:${ownerId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.map((value) => String(value)) : []);
    } catch {
        return new Set<string>();
    }
};

const writeSeenNotificationIds = (ownerId: string, ids: Set<string>) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(
            `owner-notification-seen:${ownerId}`,
            JSON.stringify(Array.from(ids))
        );
    } catch {
        // Ignore storage failures and continue with the current session.
    }
};

const lower = (value: unknown) => String(value || '').trim().toLowerCase();

const resolveNotificationRoute = (notification: OwnerNotification) => {
    const type = lower(notification.notification_type || notification.type);
    if (type.includes('message') || type.includes('chat')) return '/chat';
    if (type.includes('booking') || type.includes('payment') || type.includes('refund')) return '/bookings';
    return '/dashboard';
};

const getStore = (ownerId: string): NotificationStore => {
    let store = stores.get(ownerId);
    if (!store) {
        store = {
            notifications: [],
            listeners: new Set(),
            initialized: false,
        };
        stores.set(ownerId, store);
    }
    return store;
};

const emitStore = (store: NotificationStore) => {
    store.listeners.forEach((listener) => listener([...store.notifications]));
};

const markNotificationAsRead = async (notificationId: string) => {
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
    if (error) throw error;
};

const normalizeOneTimeNotifications = async (
    ownerId: string,
    notifications: OwnerNotification[]
) => {
    const seenIds = readSeenNotificationIds(ownerId);
    const idsToMarkRead = new Set<string>();
    let changed = false;

    notifications.forEach((notification) => {
        const notificationType = lower(notification.notification_type || notification.type);
        if (!OWNER_ONE_TIME_NOTIFICATION_TYPES.has(notificationType)) {
            return;
        }

        if (!seenIds.has(notification.id)) {
            seenIds.add(notification.id);
            changed = true;
        }

        if (!notification.is_read) {
            idsToMarkRead.add(notification.id);
        }
    });

    if (changed) {
        writeSeenNotificationIds(ownerId, seenIds);
    }

    if (idsToMarkRead.size > 0) {
        void Promise.allSettled(Array.from(idsToMarkRead).map((id) => markNotificationAsRead(id)));
    }

    return notifications.map((notification) =>
        idsToMarkRead.has(notification.id)
            ? { ...notification, is_read: true }
            : notification
    );
};

const fetchNotifications = async (ownerId: string) => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return normalizeOneTimeNotifications(ownerId, (data || []) as OwnerNotification[]);
};

const refreshStore = async (ownerId: string) => {
    const store = getStore(ownerId);
    if (store.refreshPromise) {
        await store.refreshPromise;
        return;
    }

    store.refreshPromise = (async () => {
        const previousIds = new Set(store.notifications.map((notification) => notification.id));
        store.notifications = await fetchNotifications(ownerId);
        store.initialized = true;
        store.notifications.forEach((notification) => {
            if (previousIds.has(notification.id) || notification.is_read) return;
            browserNotificationService.show({
                id: notification.id,
                title: notification.title,
                body: notification.message,
                route: resolveNotificationRoute(notification),
            });
        });
        emitStore(store);
    })().finally(() => {
        store.refreshPromise = undefined;
    });

    await store.refreshPromise;
};

const ensureRealtime = (ownerId: string) => {
    const store = getStore(ownerId);
    if (store.unsubscribeRealtime) return;

    store.unsubscribeRealtime = deferRealtimeSubscription(() => {
        void refreshStore(ownerId);

        const channel = supabase.channel(`owner-notifs-${ownerId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${ownerId}`,
            }, async () => {
                void refreshStore(ownerId);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    void refreshStore(ownerId);
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    });
};

const teardownStoreIfUnused = (ownerId: string) => {
    const store = stores.get(ownerId);
    if (!store || store.listeners.size > 0) return;
    store.unsubscribeRealtime?.();
    stores.delete(ownerId);
};

export const notificationService = {
    getOwnerNotifications: async (ownerId: string): Promise<OwnerNotification[]> => {
        await refreshStore(ownerId);
        return [...getStore(ownerId).notifications];
    },

    markAsRead: async (notificationId: string) => {
        await markNotificationAsRead(notificationId);
    },

    subscribeToNotifications: (ownerId: string, callback: (notifications: OwnerNotification[]) => void) => {
        const store = getStore(ownerId);
        store.listeners.add(callback);
        ensureRealtime(ownerId);

        if (store.initialized) {
            emitStore(store);
        } else {
            void refreshStore(ownerId);
        }

        return () => {
            const currentStore = stores.get(ownerId);
            if (!currentStore) return;
            currentStore.listeners.delete(callback);
            teardownStoreIfUnused(ownerId);
        };
    },
};
