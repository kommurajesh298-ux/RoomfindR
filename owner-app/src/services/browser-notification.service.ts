const shownNotifications = new Set<string>();

const canUseBrowserNotifications = () =>
  typeof window !== 'undefined' &&
  typeof Notification !== 'undefined';

const normalizeRoute = (route?: string | null) => {
  const nextRoute = String(route || '').trim();
  return nextRoute.startsWith('/') ? nextRoute : '';
};

export const browserNotificationService = {
  isSupported() {
    return canUseBrowserNotifications();
  },

  async requestPermission() {
    if (!canUseBrowserNotifications()) return 'denied' as NotificationPermission;
    if (Notification.permission !== 'default') return Notification.permission;

    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  },

  show({
    id,
    title,
    body,
    route,
  }: {
    id: string;
    title: string;
    body: string;
    route?: string | null;
  }) {
    if (!canUseBrowserNotifications()) return;
    if (Notification.permission !== 'granted') return;
    if (!id || shownNotifications.has(id)) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;

    shownNotifications.add(id);
    const nextRoute = normalizeRoute(route);
    const notification = new Notification(title, {
      body,
      tag: id,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      if (nextRoute && window.location.pathname !== nextRoute) {
        window.location.assign(nextRoute);
      }
      notification.close();
    };
  },
};
