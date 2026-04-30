import * as dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

let loaded = false;

export const loadE2eEnv = () => {
    if (loaded) return;
    const root = path.resolve(__dirname, '../../');
    const remoteEnvPath = path.resolve(root, 'supabase/.env.remote');
    const useRemote = process.env.E2E_USE_REMOTE_SUPABASE === '1';
    if (useRemote) {
        dotenv.config({ path: path.resolve(root, '.env.local'), override: true });
        dotenv.config({ path: path.resolve(root, '.env') });
        dotenv.config({ path: path.resolve(root, 'supabase/.env') });
    } else {
        dotenv.config({ path: path.resolve(root, 'supabase/.env'), override: true });
        dotenv.config({ path: path.resolve(root, '.env.local') });
        dotenv.config({ path: path.resolve(root, '.env') });
    }

    if ((!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) && fs.existsSync(remoteEnvPath)) {
        const remoteParsed = dotenv.parse(fs.readFileSync(remoteEnvPath));
        process.env.SUPABASE_URL ||= remoteParsed.SUPABASE_URL;
        process.env.SUPABASE_ANON_KEY ||= remoteParsed.SUPABASE_ANON_KEY;
        process.env.SUPABASE_SERVICE_ROLE_KEY ||= remoteParsed.SUPABASE_SERVICE_ROLE_KEY;
    }

    const localUrl = process.env.SUPABASE_URL;
    const localAnonKey = process.env.SUPABASE_ANON_KEY;
    const isLocal = !!localUrl && /(127\.0\.0\.1|localhost)/.test(localUrl);
    if (isLocal && localAnonKey) {
        process.env.VITE_SUPABASE_URL = localUrl;
        process.env.VITE_SUPABASE_ANON_KEY = localAnonKey;
    } else {
        process.env.VITE_SUPABASE_URL ||= process.env.SUPABASE_URL;
        process.env.VITE_SUPABASE_ANON_KEY ||= process.env.SUPABASE_ANON_KEY;
        process.env.E2E_OTP_SOURCE ||= 'admin';
    }
    loaded = true;
};

export const requireEnv = (keys: string[]): string[] => {
    return keys.filter((key) => !process.env[key]);
};

const normalizeLocalhost = (url: string): string => {
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'localhost') {
            parsed.hostname = '127.0.0.1';
        }
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return url.replace('localhost', '127.0.0.1').replace(/\/$/, '');
    }
};

export const isLocalUrl = (url?: string): boolean => {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch {
        return /localhost|127\.0\.0\.1/.test(url);
    }
};

export const checkUrlReachable = async (
    url: string,
    timeoutMs = 3000
): Promise<{ ok: boolean; error?: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        await fetch(url, { method: 'GET', signal: controller.signal });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
        clearTimeout(timeout);
    }
};

export const BASE_URLS = {
    customer: normalizeLocalhost(process.env.E2E_CUSTOMER_URL || 'http://127.0.0.1:5173'),
    owner: normalizeLocalhost(process.env.E2E_OWNER_URL || 'http://127.0.0.1:5174'),
    admin: normalizeLocalhost(process.env.E2E_ADMIN_URL || 'http://127.0.0.1:5175'),
};

export const INBUCKET_URL = normalizeLocalhost(process.env.INBUCKET_URL || 'http://127.0.0.1:54324');

export const getRequestedRoles = (): Array<'customer' | 'owner' | 'admin'> => {
    const requested = (process.env.E2E_ROLES || 'customer,owner,admin')
        .split(',')
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);

    const roles: Array<'customer' | 'owner' | 'admin'> = [];
    if (requested.includes('customer')) roles.push('customer');
    if (requested.includes('owner')) roles.push('owner');
    if (requested.includes('admin')) roles.push('admin');
    return roles;
};
