import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import type { NavigateFunction } from 'react-router-dom';
import { getEnv } from '../utils/env';

const DEFAULT_MOBILE_APP_URL = 'roomfinder://app';
const APP_ACTIVE_EVENT = 'roomfindr:app-active';
const PUSH_OPEN_EVENT = 'roomfindr:push-open';
const PENDING_PUSH_ROUTE_KEY = 'roomfindr_pending_push_route';

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const normalizeIntentUrl = (rawUrl: string): string => {
  const trimmed = String(rawUrl || '').trim();
  if (!/^intent:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^intent:\/\/([^#]+)#Intent;(.+);end$/i);
  if (!match) {
    return trimmed;
  }

  const [, pathAndQuery, intentMeta] = match;
  const schemePart = intentMeta
    .split(';')
    .find((part) => part.startsWith('scheme='));
  const scheme = schemePart ? schemePart.slice('scheme='.length).trim() : '';
  if (!scheme) {
    return trimmed;
  }

  return `${scheme}://${pathAndQuery}`;
};

const normalizeCustomSchemeUrl = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
};

export const isNativeApp = Capacitor.isNativePlatform();

export const getMobileAppBaseUrl = (): string => {
  if (!isNativeApp) return '';
  return normalizeCustomSchemeUrl(getEnv('VITE_MOBILE_APP_URL') || DEFAULT_MOBILE_APP_URL);
};

export const openExternalUrl = async (url: string): Promise<void> => {
  if (!url) return;

  if (isNativeApp && isHttpUrl(url)) {
    await Browser.open({ url });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
};

const resolveInAppRoute = (rawUrl: string): string | null => {
  try {
    const url = new URL(normalizeIntentUrl(rawUrl));
    const appBaseUrl = getMobileAppBaseUrl();
    const configuredScheme = appBaseUrl ? new URL(appBaseUrl).protocol : '';
    const isConfiguredScheme = configuredScheme && url.protocol === configuredScheme;

    if (!isConfiguredScheme) return null;

    let path = url.pathname || '';
    const host = url.hostname || '';

    if ((!path || path === '/') && host && host !== 'app') {
      path = `/${host}`;
    }

    if (host && host !== 'app' && path && path !== `/${host}` && !path.startsWith(`/${host}/`)) {
      path = `/${host}${path.startsWith('/') ? path : `/${path}`}`;
    }

    if (!path) {
      path = '/';
    }

    return `${path}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

export const registerNativeAppBridge = (navigate: NavigateFunction): (() => void) => {
  if (!isNativeApp) {
    return () => undefined;
  }

  let cancelled = false;
  let handles: PluginListenerHandle[] = [];
  let lastHandledUrl = '';

  const consumePendingPushRoute = () => {
    if (typeof window === 'undefined') return;
    const route = String(window.localStorage.getItem(PENDING_PUSH_ROUTE_KEY) || '').trim();
    if (!route) return;
    window.localStorage.removeItem(PENDING_PUSH_ROUTE_KEY);
    navigate(route, { replace: true });
  };

  const handleIncomingUrl = (rawUrl: string | null | undefined) => {
    const normalized = String(rawUrl || '').trim();
    if (!normalized || normalized === lastHandledUrl) return;

    const route = resolveInAppRoute(normalized);
    if (!route) return;

    lastHandledUrl = normalized;
    void Browser.close().catch(() => undefined);
    navigate(route, { replace: true });
  };

  const listenerPromises = [
    App.addListener('appUrlOpen', ({ url }) => {
      handleIncomingUrl(url);
    }),
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive || typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent(APP_ACTIVE_EVENT));
      consumePendingPushRoute();
    }),
  ];

  const pushRouteListener = (event: Event) => {
    const route = String((event as CustomEvent<{ route?: string }>).detail?.route || '').trim();
    if (!route) return;
    navigate(route, { replace: true });
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(PUSH_OPEN_EVENT, pushRouteListener);
  }

  void Promise.all(listenerPromises).then((resolvedHandles) => {
    if (cancelled) {
      resolvedHandles.forEach((handle) => {
        void handle.remove();
      });
      return;
    }
    handles = resolvedHandles;
  });

  void App.getLaunchUrl()
    .then((launchData) => {
      if (cancelled) return;
      handleIncomingUrl(launchData?.url);
      consumePendingPushRoute();
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener(PUSH_OPEN_EVENT, pushRouteListener);
    }
    handles.forEach((handle) => {
      void handle.remove();
    });
  };
};

export const addNativeResumeListener = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handler = () => callback();
  window.addEventListener(APP_ACTIVE_EVENT, handler);
  return () => window.removeEventListener(APP_ACTIVE_EVENT, handler);
};
