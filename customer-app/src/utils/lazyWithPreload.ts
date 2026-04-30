import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- preserves prop inference for both default and named lazy imports with heterogeneous prop shapes.
type AnyComponent = ComponentType<any>;

type Loader<T extends AnyComponent> = () => Promise<{ default: T }>;

export type PreloadableComponent<T extends AnyComponent> = LazyExoticComponent<T> & {
    preload: Loader<T>;
};

const DYNAMIC_IMPORT_RELOAD_KEY = 'roomfindr:dynamic-import-reload-once';

const isLocalLikeHost = () => {
    if (typeof window === 'undefined') return false;
    const { hostname } = window.location;
    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname.startsWith('10.')
        || hostname.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
};

const isDynamicImportFetchError = (error: unknown) => {
    const message = String((error as { message?: string } | null)?.message || error || '').toLowerCase();
    return message.includes('failed to fetch dynamically imported module')
        || message.includes('importing a module script failed')
        || message.includes('dynamically imported module');
};

const canAutoReloadDynamicImportFailure = () =>
    typeof window !== 'undefined' && (import.meta.env.DEV || isLocalLikeHost());

export const loadLazyModuleWithRecovery = async <T extends AnyComponent>(loader: Loader<T>): Promise<{ default: T }> => {
    try {
        const module = await loader();
        if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
        }
        return module;
    } catch (error) {
        if (canAutoReloadDynamicImportFailure() && isDynamicImportFetchError(error)) {
            const hasReloaded = typeof window !== 'undefined' && window.sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) === '1';
            if (!hasReloaded && typeof window !== 'undefined') {
                window.sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, '1');
                window.location.reload();
                return new Promise<never>(() => {});
            }
        }

        throw error;
    }
};

export const lazyWithPreload = <T extends AnyComponent>(loader: Loader<T>): PreloadableComponent<T> => {
    const load = () => loadLazyModuleWithRecovery(loader);
    const Component = lazy(load) as PreloadableComponent<T>;
    Component.preload = load;
    return Component;
};
