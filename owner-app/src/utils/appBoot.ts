type PreloadTask = (() => unknown) | null | undefined;

type SplashOptions = {
    minimumVisibleMs?: number;
    maximumVisibleMs?: number;
    exitAnimationMs?: number;
};

const scheduleIdleTask = (callback: () => void, timeout = 1500) => {
    const browserWindow = globalThis.window;
    if (!browserWindow) {
        return () => undefined;
    }

    if (typeof browserWindow.requestIdleCallback === 'function') {
        const idleId = browserWindow.requestIdleCallback(() => callback(), { timeout });
        return () => browserWindow.cancelIdleCallback(idleId);
    }

    const timer = globalThis.setTimeout(callback, 160);
    return () => globalThis.clearTimeout(timer);
};

export const preloadTasksWhenIdle = (tasks: PreloadTask[], timeout = 1500) => {
    const safeTasks = tasks.filter((task): task is () => unknown => typeof task === 'function');
    if (safeTasks.length === 0) {
        return () => undefined;
    }

    return scheduleIdleTask(() => {
        safeTasks.forEach((task) => {
            try {
                void task();
            } catch {
                // Best-effort warmup only.
            }
        });
    }, timeout);
};

export const hideInitialSplash = ({
    minimumVisibleMs = 2200,
    maximumVisibleMs = 2400,
    exitAnimationMs = 420,
}: SplashOptions = {}) => {
    const browserWindow = globalThis.window;
    if (!browserWindow) {
        return () => undefined;
    }

    const splashElement = document.getElementById('initial-splash');
    if (!(splashElement instanceof HTMLElement)) {
        return () => undefined;
    }

    document.body.classList.add('rfm-splash-active');

    const start = performance.now();
    let disposed = false;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;

    const dismiss = () => {
        if (disposed) return;

        const elapsed = performance.now() - start;
        if (elapsed < minimumVisibleMs) {
            globalThis.setTimeout(dismiss, minimumVisibleMs - elapsed);
            return;
        }

        splashElement.classList.add('splash-exit');
        splashElement.style.opacity = '0';
        splashElement.style.visibility = 'hidden';
        splashElement.style.pointerEvents = 'none';
        document.body.classList.remove('rfm-splash-active');
        document.body.classList.add('rfm-app-enter');

        globalThis.setTimeout(() => {
            if (!disposed) {
                document.body.classList.remove('rfm-app-enter');
            }
        }, exitAnimationMs + 260);

        exitTimer = globalThis.setTimeout(() => {
            if (!disposed) {
                splashElement.style.display = 'none';
            }
        }, exitAnimationMs);
    };

    const scheduleDismiss = () => {
        browserWindow.requestAnimationFrame(() => {
            browserWindow.requestAnimationFrame(dismiss);
        });
    };

    maxTimer = globalThis.setTimeout(dismiss, maximumVisibleMs);

    if (document.readyState === 'complete') {
        scheduleDismiss();
    } else {
        browserWindow.addEventListener('load', scheduleDismiss, { once: true });
    }

    return () => {
        disposed = true;
        if (maxTimer) {
            globalThis.clearTimeout(maxTimer);
        }
        if (exitTimer) {
            globalThis.clearTimeout(exitTimer);
        }
        document.body.classList.remove('rfm-splash-active');
        document.body.classList.remove('rfm-app-enter');
    };
};
