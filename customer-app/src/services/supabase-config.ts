import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../utils/env';

// These should be in your environment variables (.env)
export const supabaseUrl = getEnv('VITE_SUPABASE_URL');
export const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY');

const isLocalSupabaseUrl = (url: string) => /^(http:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
const isPlaceholderSupabaseValue = (value: string) => /^your[_-]/i.test(value.trim());

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = typeof atob === 'function'
            ? atob(base64)
            : Buffer.from(base64, 'base64').toString('utf-8');
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
};

if (import.meta.env.PROD) {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase configuration missing in production.');
    }
    if (isPlaceholderSupabaseValue(supabaseUrl) || isPlaceholderSupabaseValue(supabaseAnonKey)) {
        throw new Error('Placeholder Supabase configuration detected. Replace it with real project values.');
    }
    if (supabaseUrl && isLocalSupabaseUrl(supabaseUrl)) {
        throw new Error('Local Supabase URLs are forbidden in production. Use hosted Supabase.');
    }
    if (supabaseUrl && supabaseUrl.startsWith('http://')) {
        throw new Error('Supabase URL must use HTTPS in production.');
    }

    const payload = decodeJwtPayload(supabaseAnonKey || '');
    if (payload?.role === 'service_role') {
        throw new Error('Service role keys are forbidden in the frontend. Use the anon public key.');
    }
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
    global: {
        fetch: async (url, options) => {
            const urlString = url instanceof Request ? url.url : url.toString();

            const isOtpAuth = /\/auth\/v1\/(otp|verify)/i.test(urlString);
            if (isOtpAuth) {
                const headers = new Headers(options?.headers);

                if (url instanceof Request) {
                    url.headers.forEach((v, k) => {
                        if (!headers.has(k)) headers.set(k, v);
                    });
                }

                headers.set('Pragma', 'no-cache');
                headers.set('Cache-Control', 'no-cache');
                headers.set('x-client-info', 'roomfindr-web');

                if (!headers.has('apikey')) {
                    headers.set('apikey', supabaseAnonKey || '');
                }

                if (url instanceof Request) {
                    return globalThis.fetch(new Request(url, { headers, cache: 'no-store' }));
                }

                return globalThis.fetch(url, {
                    ...options,
                    cache: 'no-store',
                    headers
                });
            }

            // Intercept payment-related requests for cache-busting and reliable header injection
            if (urlString.includes('/rest/v1/payments') || urlString.includes('/functions/v1/cashfree-')) {
                const headers = new Headers(options?.headers);

                // Merge headers from the Request object if it exists
                if (url instanceof Request) {
                    url.headers.forEach((v, k) => {
                        if (!headers.has(k)) headers.set(k, v);
                    });
                }

                // Force no-cache to avoid stale states during reconciliation/polling
                headers.set('Pragma', 'no-cache');
                headers.set('Cache-Control', 'no-cache');

                // Standard apikey injection
                if (!headers.has('apikey')) {
                    headers.set('apikey', supabaseAnonKey || '');
                }

                // Create a clone of the request with updated headers
                if (url instanceof Request) {
                    return globalThis.fetch(new Request(url, { headers }));
                }

                return globalThis.fetch(url, {
                    ...options,
                    headers
                });
            }

            return globalThis.fetch(url, options);
        }
    }
});

