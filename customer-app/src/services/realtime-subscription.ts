import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase-config';

const REALTIME_SUBSCRIPTION_DELAY_MS = 180;
const REALTIME_EARLY_REMOVE_DELAY_MS = 450;

type RealtimeChannelStatus =
    | 'SUBSCRIBED'
    | 'TIMED_OUT'
    | 'CHANNEL_ERROR'
    | 'CLOSED'
    | string;

const TERMINAL_CHANNEL_STATUSES = new Set<RealtimeChannelStatus>([
    'SUBSCRIBED',
    'TIMED_OUT',
    'CHANNEL_ERROR',
    'CLOSED',
]);

export const deferRealtimeSubscription = (
    start: () => void | (() => void),
) => {
    let disposed = false;
    let cleanup: void | (() => void);

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

export const createSafeRealtimeChannelCleanup = (channel: RealtimeChannel) => {
    let disposed = false;
    let removing = false;
    let hasSettled = false;
    let earlyRemovalTimer: ReturnType<typeof setTimeout> | undefined;

    const finalizeRemoval = () => {
        if (removing) return;
        removing = true;

        if (earlyRemovalTimer) {
            globalThis.clearTimeout(earlyRemovalTimer);
            earlyRemovalTimer = undefined;
        }

        void Promise.resolve().then(async () => {
            try {
                await channel.unsubscribe();
            } catch {
                // Best effort cleanup only.
            }

            try {
                await supabase.removeChannel(channel);
            } catch {
                // Best effort cleanup only.
            }
        });
    };

    return {
        handleStatus: (status: RealtimeChannelStatus) => {
            if (TERMINAL_CHANNEL_STATUSES.has(status)) {
                hasSettled = true;
            }

            if (disposed && hasSettled) {
                finalizeRemoval();
            }
        },
        cleanup: () => {
            if (disposed) return;
            disposed = true;

            if (hasSettled) {
                finalizeRemoval();
                return;
            }

            earlyRemovalTimer = globalThis.setTimeout(() => {
                finalizeRemoval();
            }, REALTIME_EARLY_REMOVE_DELAY_MS);
        },
    };
};
