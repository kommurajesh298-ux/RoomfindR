import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type ActionPerformed,
  type Channel,
} from '@capacitor/push-notifications';
import { supabase } from './supabase-config';
import { authService } from './auth.service';

const TOKEN_KEY = 'roomfindr_push_token';
const PENDING_PUSH_ROUTE_KEY = 'roomfindr_pending_push_route';
const PUSH_OPEN_EVENT = 'roomfindr:push-open';
const DEFAULT_CHANNEL_ID = 'default';
const DEVICE_TOKENS_SCHEMA_MISSING = 'PGRST205';
const DEFAULT_CHANNEL: Channel = {
  id: DEFAULT_CHANNEL_ID,
  name: 'RoomFindR Alerts',
  description: 'Booking, payment, refund, and message updates',
  importance: 5,
  visibility: 1,
};
let listenersAttached = false;

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

const isMissingFcmTokensTable = (error: SupabaseErrorLike | null | undefined) =>
  error?.code === DEVICE_TOKENS_SCHEMA_MISSING ||
  /fcm_tokens/i.test(String(error?.message || '')) && /not found|schema cache/i.test(String(error?.message || ''));

const resolveNotificationRoute = (
  notification: PushNotificationSchema | ActionPerformed['notification'],
): string => {
  const data = (notification?.data || {}) as Record<string, unknown>;
  const explicitRoute = String(data.route || '').trim();
  if (explicitRoute) return explicitRoute;

  const type = String(data.type || '').trim().toLowerCase();
  if (type.includes('chat') || type.includes('message')) return '/chat';
  if (type.includes('booking') || type.includes('payment') || type.includes('refund')) return '/bookings';
  return '/';
};

const dispatchPushOpen = (route: string) => {
  if (typeof window === 'undefined' || !route) return;
  window.localStorage.setItem(PENDING_PUSH_ROUTE_KEY, route);
  window.dispatchEvent(new CustomEvent(PUSH_OPEN_EVENT, { detail: { route } }));
};

const upsertUserDevice = async (token: string) => {
  const user = await authService.getCurrentUser();
  if (!user?.id) return false;

  const platform = Capacitor.getPlatform();
  const timestamp = new Date().toISOString();
  const nextToken = {
    user_id: user.id,
    token,
    app: 'customer',
    device_type: platform,
    platform,
    is_active: true,
    last_seen_at: timestamp,
  };

  const { error } = await supabase.from('fcm_tokens').upsert(nextToken, {
    onConflict: 'user_id,token',
  });

  if (error && !isMissingFcmTokensTable(error)) {
    throw error;
  }

  return true;
};

const disableUserDevice = async (token: string) => {
  const user = await authService.getCurrentUser();
  if (!user?.id) return;

  const timestamp = new Date().toISOString();
  const { error } = await supabase
    .from('fcm_tokens')
    .update({
      is_active: false,
      updated_at: timestamp,
    })
    .eq('user_id', user.id)
    .eq('token', token);

  if (error && !isMissingFcmTokensTable(error)) {
    throw error;
  }
};

const ensureAndroidChannel = async () => {
  if (Capacitor.getPlatform() !== 'android') return;
  await PushNotifications.createChannel(DEFAULT_CHANNEL);
};

const attachListeners = () => {
  if (listenersAttached) return;
  listenersAttached = true;

  PushNotifications.addListener('registration', async (token) => {
    try {
      localStorage.setItem(TOKEN_KEY, token.value);
      await upsertUserDevice(token.value);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Push registration error:', error);
      }
    }
  });

  PushNotifications.addListener('registrationError', (error) => {
    if (import.meta.env.DEV) {
      console.error('Push registration failed:', error);
    }
  });

  PushNotifications.addListener('pushNotificationReceived', () => {
    // Foreground state relies on Supabase Realtime for UI updates.
  });

  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    dispatchPushOpen(resolveNotificationRoute(notification));
  });
};

export const pushService = {
  pendingRouteKey: PENDING_PUSH_ROUTE_KEY,
  openEventName: PUSH_OPEN_EVENT,

  register: async () => {
    if (!Capacitor.isNativePlatform()) return;
    attachListeners();

    try {
      await ensureAndroidChannel();
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (storedToken) {
        await upsertUserDevice(storedToken);
      }
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') return;
      await PushNotifications.register();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Native push registration skipped:', error);
      }
    }
  },

  unregister: async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;

    try {
      if (Capacitor.isNativePlatform()) {
        await disableUserDevice(storedToken);
      }
    } finally {
      localStorage.removeItem(TOKEN_KEY);
    }
  },
};
