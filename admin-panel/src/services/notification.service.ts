import { supabase } from './supabase-config';
import { deferRealtimeSubscription } from './realtime-subscription';
import { browserNotificationService } from './browser-notification.service';

export interface Notification {
    id: string;
    user_id: string;
    title: string;
    message: string;
    type: 'booking' | 'message' | 'property' | 'system' | 'payment' | 'refund' | 'settlement' | 'ticket';
    is_read: boolean;
    created_at: string;
    data?: Record<string, unknown>;
}

type NotificationSubscriber = (notifications: Notification[]) => void;

type NotificationStore = {
    notifications: Notification[];
    listeners: Set<NotificationSubscriber>;
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
    if (type.includes('refund')) return '/refunds';
    if (type.includes('settlement') || type.includes('payout') || type.includes('payment')) return '/settlements';
    if (type.includes('ticket') || type.includes('support')) return '/tickets';
    if (type.includes('booking')) return '/bookings';
    return '/dashboard';
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
    store.listeners.forEach((listener) => listener([...store.notifications]));
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
            .channel(`admin-notifications-${userId}`)
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

export const NotificationService = {
    getNotifications: async (userId: string, limit = 20): Promise<Notification[]> => {
        await refreshStore(userId);
        return getStore(userId).notifications.slice(0, limit);
    },

    markAsRead: async (notificationId: string): Promise<void> => {
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notificationId);

        if (error) throw error;
    },

    markAllAsRead: async (userId: string): Promise<void> => {
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        if (error) throw error;
        await refreshStore(userId);
    },

    subscribeToNotifications: (userId: string, onNotifications: NotificationSubscriber): (() => void) => {
        const store = getStore(userId);
        store.listeners.add(onNotifications);
        ensureRealtime(userId);

        if (store.initialized) {
            emitStore(store);
        } else {
            void refreshStore(userId);
        }

        return () => {
            const currentStore = stores.get(userId);
            if (!currentStore) return;
            currentStore.listeners.delete(onNotifications);
            teardownStoreIfUnused(userId);
        };
    },
};
