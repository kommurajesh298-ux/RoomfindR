import { supabase } from './supabase-config';
import { deferRealtimeSubscription } from './realtime-subscription';
import { browserNotificationService } from './browser-notification.service';

export interface Notification {
    id: string;
    user_id: string;
    title: string;
    message: string;
    type: 'booking' | 'message' | 'property' | 'system' | 'offer';
    data?: Record<string, unknown>;
    is_read: boolean;
    created_at: string;
}

type UnreadSubscriber = (count: number, notifications: Notification[]) => void;

type NotificationStore = {
    notifications: Notification[];
    listeners: Set<UnreadSubscriber>;
    unsubscribeRealtime?: () => void;
    initialized: boolean;
    refreshPromise?: Promise<void>;
};

const stores = new Map<string, NotificationStore>();

const resolveNotificationRoute = (notification: Notification) => {
    const data = notification.data || {};
    const explicitRoute = String(data.route || '').trim();
    if (explicitRoute.startsWith('/')) return explicitRoute;

    const type = String(notification.type || '').trim().toLowerCase();
    if (type.includes('message') || type.includes('chat')) return '/chat';
    if (type.includes('booking') || type.includes('payment') || type.includes('refund')) return '/bookings';
    return '/';
};

const isSuppressedPreCheckInBookingNotification = (notification: Notification): boolean => {
    const type = String(notification.type || '').trim().toLowerCase();
    const data = notification.data || {};
    const status = String(data.status || '').trim().toLowerCase().replace(/_/g, '-');
    return type === 'booking' && ['approved', 'accepted', 'confirmed'].includes(status);
};

const getStore = (userId: string): NotificationStore => {
    let store = stores.get(userId);
    if (!store) {
        store = {
            notifications: [],
            listeners: new Set(),
            initialized: false,
        };
        stores.set(userId, store);
    }
    return store;
};

const emitStore = (store: NotificationStore) => {
    const visibleNotifications = store.notifications.filter((notification) => !isSuppressedPreCheckInBookingNotification(notification));
    const unreadCount = visibleNotifications.filter((notification) => !notification.is_read).length;
    store.listeners.forEach((listener) => listener(unreadCount, visibleNotifications));
};

const fetchNotifications = async (userId: string) => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) throw error;
    return (data || []) as Notification[];
};

const refreshStore = async (userId: string) => {
    const store = getStore(userId);
    if (store.refreshPromise) {
        await store.refreshPromise;
        return;
    }

    store.refreshPromise = (async () => {
        const previousIds = new Set(store.notifications.map((notification) => notification.id));
        store.notifications = await fetchNotifications(userId);
        store.initialized = true;
        store.notifications.forEach((notification) => {
            if (previousIds.has(notification.id) || notification.is_read) return;
            if (isSuppressedPreCheckInBookingNotification(notification)) return;
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

const ensureRealtime = (userId: string) => {
    const store = getStore(userId);
    if (store.unsubscribeRealtime) return;

    store.unsubscribeRealtime = deferRealtimeSubscription(() => {
        void refreshStore(userId);

        const channel = supabase
            .channel(`notifications-shared-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${userId}`,
                },
                () => {
                    void refreshStore(userId);
                },
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    void refreshStore(userId);
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    });
};

const teardownStoreIfUnused = (userId: string) => {
    const store = stores.get(userId);
    if (!store || store.listeners.size > 0) return;
    store.unsubscribeRealtime?.();
    stores.delete(userId);
};

export const notificationService = {
    getNotifications: async (userId: string, limit = 50, offset = 0): Promise<Notification[]> => {
        await refreshStore(userId);
        return getStore(userId)
            .notifications
            .filter((notification) => !isSuppressedPreCheckInBookingNotification(notification))
            .slice(offset, offset + limit);
    },

    getUnreadCount: async (userId: string): Promise<number> => {
        await refreshStore(userId);
        return getStore(userId).notifications.filter((notification) =>
            !notification.is_read && !isSuppressedPreCheckInBookingNotification(notification),
        ).length;
    },

    markAsRead: async (userId: string, notificationIds: string[]) => {
        if (!notificationIds.length) return;
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .in('id', notificationIds)
            .eq('is_read', false);
        if (error) throw error;
        await refreshStore(userId);
    },

    markAllAsRead: async (userId: string) => {
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);
        if (error) throw error;
        await refreshStore(userId);
    },

    deleteNotification: async (notificationId: string, userId?: string) => {
        const { error } = await supabase.from('notifications').delete().eq('id', notificationId);
        if (error) throw error;
        if (userId) {
            await refreshStore(userId);
        }
    },

    subscribeToUnread: (userId: string, callback: UnreadSubscriber): (() => void) => {
        const store = getStore(userId);
        store.listeners.add(callback);
        ensureRealtime(userId);

        if (store.initialized) {
            emitStore(store);
        } else {
            void refreshStore(userId);
        }

        return () => {
            const currentStore = stores.get(userId);
            if (!currentStore) return;
            currentStore.listeners.delete(callback);
            teardownStoreIfUnused(userId);
        };
    },
};
