import { createClient } from '@supabase/supabase-js';

// These should be in your environment variables (.env)
let supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (typeof supabaseUrl === 'string') supabaseUrl = supabaseUrl.trim();
if (typeof supabaseAnonKey === 'string') supabaseAnonKey = supabaseAnonKey.trim();

const isLocalSupabaseUrl = (url: string) => /^(http:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
const isPlaceholderSupabaseValue = (value: string) => /^your[_-]/i.test(value.trim());

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const normalizedBase64 = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=');
        const json = globalThis.atob(normalizedBase64);
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
};

if ((supabaseUrl && isPlaceholderSupabaseValue(supabaseUrl)) || (supabaseAnonKey && isPlaceholderSupabaseValue(supabaseAnonKey))) {
    throw new Error('Placeholder Supabase configuration detected. Replace it with real project values.');
}

if (import.meta.env.PROD) {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase configuration missing in production.');
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
        fetch: (url, options) => {
            const urlString = url instanceof Request ? url.url : url.toString();

            // Handle high-priority/payment requests that need zero caching and explicit headers
            if (urlString.includes('/rest/v1/payments') || urlString.includes('/functions/v1/cashfree-')) {
                const headers = new Headers(options?.headers);
                headers.set('Pragma', 'no-cache');
                headers.set('Cache-Control', 'no-cache');

                if (!headers.has('apikey')) {
                    headers.set('apikey', supabaseAnonKey || '');
                }

                return globalThis.fetch(url, {
                    ...options,
                    cache: 'no-store',
                    headers
                });
            }
            return globalThis.fetch(url, options);
        }
    }
});
