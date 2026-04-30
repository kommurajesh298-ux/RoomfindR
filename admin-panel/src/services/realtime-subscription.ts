export const deferRealtimeSubscription = (
    start: () => void | (() => void),
) => {
    let disposed = false;
    let cleanup: void | (() => void);
    const REALTIME_SUBSCRIPTION_DELAY_MS = 180;

    const timer = globalThis.setTimeout(() => {
        if (disposed) return;
        cleanup = start();
    }, REALTIME_SUBSCRIPTION_DELAY_MS);

    return () => {
        disposed = true;
        globalThis.clearTimeout(timer);
        cleanup?.();
    };
};
