import * as Sentry from '@sentry/react';

let monitoringInitialized = false;

const getEnv = (key: string): string | undefined => {
    try {
        const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
        return viteEnv?.[key];
    } catch {
        return undefined;
    }
};

const parseSampleRate = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
};

export const initializeMonitoring = () => {
    if (monitoringInitialized) {
        return;
    }

    const dsn = getEnv('VITE_SENTRY_DSN') || getEnv('SENTRY_DSN');
    if (!dsn) {
        return;
    }

    Sentry.init({
        dsn,
        enabled: true,
        environment: getEnv('VITE_SENTRY_ENVIRONMENT') || getEnv('SENTRY_ENVIRONMENT') || 'production',
        release: getEnv('VITE_SENTRY_RELEASE') || getEnv('VITE_RELEASE') || 'admin-panel@local',
        tracesSampleRate: parseSampleRate(getEnv('VITE_SENTRY_TRACES_SAMPLE_RATE'), 0.1),
        initialScope: {
            tags: {
                app: 'admin-panel',
            },
        },
    });

    monitoringInitialized = true;
};

export const captureMonitoringError = (error: unknown, context?: Record<string, unknown>) => {
    if (!monitoringInitialized) {
        return;
    }

    Sentry.withScope((scope) => {
        Object.entries(context || {}).forEach(([key, value]) => {
            scope.setExtra(key, value);
        });
        Sentry.captureException(error);
    });
};
