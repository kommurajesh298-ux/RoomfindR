import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type EmptyProps = Record<string, never>;
type AnyComponent = ComponentType<EmptyProps>;

type Loader<T extends AnyComponent> = () => Promise<{ default: T }>;

export type PreloadableComponent<T extends AnyComponent> = LazyExoticComponent<T> & {
    preload: Loader<T>;
};

export const lazyWithPreload = <T extends AnyComponent>(loader: Loader<T>): PreloadableComponent<T> => {
    const load = () => loader();
    const Component = lazy(load) as PreloadableComponent<T>;
    Component.preload = load;
    return Component;
};
