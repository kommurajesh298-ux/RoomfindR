import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { isRetryableSupabaseNetworkError, withSupabaseAdminRetry } from './supabase-auth-retry';

type SupabaseEnv = {
    supabaseUrl: string;
    anonKey: string;
    serviceKey: string;
};

export type AuthRole = 'customer' | 'owner' | 'admin';

type AuthBypassOptions = {
    role: AuthRole;
    email: string;
    baseUrl: string;
    supabaseUrl?: string;
    anonKey?: string;
    serviceKey?: string;
    postLoginPath?: string;
};

const DEFAULT_BYPASS_PASSWORD = 'password123';

const isSameRoute = (page: Page, targetUrl: string) => {
    try {
        const currentUrl = page.url();
        if (!currentUrl || currentUrl === 'about:blank') {
            return false;
        }

        const current = new URL(currentUrl);
        const target = new URL(targetUrl);
        return current.origin === target.origin && current.pathname === target.pathname;
    } catch {
        return false;
    }
};

const navigateAfterSessionBootstrap = async (page: Page, targetUrl: string) => {
    try {
        await page.goto(targetUrl, { waitUntil: 'commit', timeout: 60000 });
    } catch (error) {
        if (!isSameRoute(page, targetUrl)) {
            await page.waitForTimeout(1200);
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
    }
};

const buildSeedDisplayName = (email: string, role: AuthRole) => {
    const base = email.split('@')[0]?.trim();
    if (base) return base;
    if (role === 'admin') return 'Test Admin';
    if (role === 'owner') return 'Test Owner';
    return 'Test Customer';
};

const buildSeedPhone = (seed: string) => {
    let hash = 0;
    const source = seed.trim().toLowerCase();
    for (let i = 0; i < source.length; i += 1) {
        hash = (hash * 131 + source.charCodeAt(i)) % 1_000_000_000;
    }

    return `+919${String(hash).padStart(9, '0')}`;
};

const readEnvFile = (filePath: string): Record<string, string> => {
    try {
        if (!fs.existsSync(filePath)) return {};
        const raw = fs.readFileSync(filePath);
        return dotenv.parse(raw);
    } catch {
        return {};
    }
};

const resolveEnvFiles = () => {
    const root = path.resolve(__dirname, '../../');
    const localEnv = readEnvFile(path.join(root, 'supabase', '.env'));
    const remoteSupabaseEnv = readEnvFile(path.join(root, 'supabase', '.env.remote'));
    const projectEnv = readEnvFile(path.join(root, '.env'));
    const localOverride = readEnvFile(path.join(root, '.env.local'));
    const appEnvs = {
        customer: {
            ...readEnvFile(path.join(root, 'customer-app', '.env')),
            ...readEnvFile(path.join(root, 'customer-app', '.env.development'))
        },
        owner: {
            ...readEnvFile(path.join(root, 'owner-app', '.env')),
            ...readEnvFile(path.join(root, 'owner-app', '.env.development'))
        },
        admin: {
            ...readEnvFile(path.join(root, 'admin-panel', '.env')),
            ...readEnvFile(path.join(root, 'admin-panel', '.env.development'))
        }
    };
    return {
        local: localEnv,
        remote: { ...remoteSupabaseEnv, ...projectEnv, ...localOverride },
        apps: appEnvs
    };
};

const resolveAppEnv = (targetUrl?: string, appEnvs?: Record<string, Record<string, string>>) => {
    if (!targetUrl || !appEnvs) return {};
    try {
        const parsed = new URL(targetUrl);
        const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
        if (port === '5173') return appEnvs.customer || {};
        if (port === '5174') return appEnvs.owner || {};
        if (port === '5175') return appEnvs.admin || {};
        return {};
    } catch {
        if (targetUrl.includes('5173')) return appEnvs.customer || {};
        if (targetUrl.includes('5174')) return appEnvs.owner || {};
        if (targetUrl.includes('5175')) return appEnvs.admin || {};
        return {};
    }
};

const buildEnv = (env: Record<string, string | undefined>): SupabaseEnv => ({
    supabaseUrl: env.SUPABASE_URL || env.VITE_SUPABASE_URL || '',
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || ''
});

const normalizeHost = (value?: string) => {
    if (!value) return '';
    try {
        const parsed = new URL(value);
        return `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
    } catch {
        return value.replace('localhost', '127.0.0.1');
    }
};

export const resolveSupabaseEnv = (targetUrl?: string): SupabaseEnv => {
    const { local, remote, apps } = resolveEnvFiles();
    const fallback = buildEnv(process.env);
    const localEnv = buildEnv(local);

    const effectiveTarget = targetUrl
        || process.env.E2E_TARGET_SUPABASE_URL
        || process.env.VITE_SUPABASE_URL
        || process.env.SUPABASE_URL
        || '';

    const appEnv = resolveAppEnv(effectiveTarget, apps);
    const remoteEnv = buildEnv({ ...remote, ...appEnv });

    const appSupabaseUrl = appEnv.SUPABASE_URL || appEnv.VITE_SUPABASE_URL || '';
    const host = normalizeHost(appSupabaseUrl || effectiveTarget);
    const isLocal = /localhost|127\.0\.0\.1/.test(host);

    if (isLocal) {
        return localEnv.supabaseUrl ? localEnv : fallback;
    }

    if (remoteEnv.supabaseUrl) {
        return remoteEnv;
    }

    return fallback;
};

const getSupabaseEnv = (targetUrl?: string): SupabaseEnv => {
    const resolved = resolveSupabaseEnv(targetUrl);
    const supabaseUrl = resolved.supabaseUrl;
    const anonKey = resolved.anonKey;
    const serviceKey = resolved.serviceKey;

    if (!supabaseUrl || !anonKey || !serviceKey) {
        throw new Error('Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY for auth bypass.');
    }

    return { supabaseUrl, anonKey, serviceKey };
};

const getStorageKey = (supabaseUrl: string): string => {
    try {
        const hostname = new URL(supabaseUrl).hostname;
        const projectRef = hostname.split('.')[0];
        return `sb-${projectRef}-auth-token`;
    } catch {
        return 'supabase-auth';
    }
};

const ensureRoleRecords = async (
    supabaseUrl: string,
    serviceKey: string,
    userId: string,
    email: string,
    role: AuthRole
) => {
    const admin = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const now = new Date().toISOString();
    const name = buildSeedDisplayName(email, role);
    const phone = buildSeedPhone(`${role}:${email}`);

    await admin.from('accounts').upsert({
        id: userId,
        email,
        phone,
        role,
        updated_at: now
    });

    if (role === 'customer') {
        await admin.from('customers').upsert({
            id: userId,
            name,
            email,
            phone,
            city: 'Test City',
            updated_at: now
        });
    } else if (role === 'owner') {
        await admin.from('owners').upsert({
            id: userId,
            name,
            email,
            phone,
            verified: true,
            verification_status: 'approved',
            bank_verified: true,
            bank_verification_status: 'verified',
            cashfree_status: 'success',
            cashfree_transfer_id: `e2e_verify_${userId}`,
            updated_at: now
        });

        const helperModule = await import('./supabase-admin');
        const helper = new helperModule.SupabaseAdminHelper({ supabaseUrl, serviceKey });
        await helper.upsertOwnerVerificationRecord({
            ownerId: userId,
            email,
            phone,
            bankAccountNumber: 'XXXX5678',
            ifscCode: 'SBIN0000001',
            accountHolderName: name,
            transferAmount: 1,
            transferReferenceId: `e2e_verify_${userId}`,
            providerReferenceId: `e2e_provider_${userId}`,
            transferStatus: 'success',
            statusMessage: 'Verified for automated E2E auth bootstrap.',
            lastAttemptAt: now,
            verifiedAt: now,
            updatedAt: now
        });
    } else if (role === 'admin') {
        await admin.from('admins').upsert({
            id: userId,
            name,
            email,
            updated_at: now
        });
    }
};

const findAuthUserByEmail = async (
    adminClient: ReturnType<typeof createClient>,
    email: string
) => {
    const target = email.trim().toLowerCase();
    const { data: accountFallback } = await adminClient
        .from('accounts')
        .select('id, email')
        .eq('email', target)
        .limit(1)
        .maybeSingle();
    let page = 1;

    try {
        while (page <= 50) {
            const { data, error } = await withSupabaseAdminRetry(
                `listUsers(${target}) page ${page}`,
                () => adminClient.auth.admin.listUsers({ page, perPage: 1000 })
            );
            if (error) throw error;

            const match = data.users.find((user) => String(user.email || '').toLowerCase() === target);
            if (match) return match;

            if (data.users.length < 1000) break;
            page += 1;
        }
    } catch (error) {
        if (accountFallback?.id && isRetryableSupabaseNetworkError(error)) {
            return {
                id: String(accountFallback.id),
                email: String(accountFallback.email || target),
            };
        }
        throw error;
    }

    if (accountFallback?.id) {
        return {
            id: String(accountFallback.id),
            email: String(accountFallback.email || target),
        };
    }

    return null;
};

const generateOtp = async (supabaseUrl: string, serviceKey: string, email: string, role: AuthRole) => {
    const adminClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    let existingUser = await findAuthUserByEmail(adminClient, email);
    if (!existingUser) {
        const name = buildSeedDisplayName(email, role);
        const phone = buildSeedPhone(`${role}:${email}`);
        const { data: createdUser, error: createError } = await withSupabaseAdminRetry(
            `createUser(${email})`,
            () => adminClient.auth.admin.createUser({
                email,
                password: 'password123',
                phone,
                phone_confirm: true,
                email_confirm: true,
                user_metadata: {
                    role,
                    name,
                    phone,
                    phone_number: phone
                },
                app_metadata: { role, name }
            })
        );

        if (createError) {
            throw createError;
        }

        existingUser = createdUser.user || null;
    }

    const { data: linkData, error: linkError } = await withSupabaseAdminRetry(
        `generateLink(${email})`,
        () => adminClient.auth.admin.generateLink({
            type: 'magiclink',
            email
        })
    );

    if (!linkError && linkData?.properties?.email_otp) {
        return { otp: linkData.properties.email_otp, userId: linkData.user?.id || existingUser?.id };
    }

    throw linkError || new Error('Unable to generate admin OTP.');
};

export const loginWithOtpBypass = async (page: Page, options: AuthBypassOptions) => {
    const resolved = getSupabaseEnv(options.supabaseUrl);
    const supabaseUrl = options.supabaseUrl || resolved.supabaseUrl;
    const anonKey = options.anonKey || resolved.anonKey;
    const serviceKey = options.serviceKey || resolved.serviceKey;

    if (!supabaseUrl || !anonKey || !serviceKey) {
        throw new Error('Missing Supabase credentials for auth bypass.');
    }

    const client = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const adminClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    let session = null;
    const passwordLogin = await withSupabaseAdminRetry(
        `signInWithPassword(${options.email})`,
        async () => {
            const response = await client.auth.signInWithPassword({
                email: options.email,
                password: DEFAULT_BYPASS_PASSWORD
            });
            if (response.error && isRetryableSupabaseNetworkError(response.error)) {
                throw response.error;
            }
            return response;
        },
        { retries: 3, initialDelayMs: 500 }
    );
    if (!passwordLogin.error && passwordLogin.data?.session) {
        session = passwordLogin.data.session;
    } else {
        let existingUser = await findAuthUserByEmail(adminClient, options.email);
        if (!existingUser) {
            const name = buildSeedDisplayName(options.email, options.role);
            const phone = buildSeedPhone(`${options.role}:${options.email}`);
            const { data: createdUser, error: createError } = await withSupabaseAdminRetry(
                `createUser(${options.email})`,
                () => adminClient.auth.admin.createUser({
                    email: options.email,
                    password: DEFAULT_BYPASS_PASSWORD,
                    phone,
                    phone_confirm: true,
                    email_confirm: true,
                    user_metadata: {
                        role: options.role,
                        name,
                        phone,
                        phone_number: phone
                    },
                    app_metadata: { role: options.role, name }
                })
            );

            if (createError) {
                throw createError;
            }

            existingUser = createdUser.user || null;
        }

        const { otp, userId: generatedUserId } = await generateOtp(supabaseUrl, serviceKey, options.email, options.role);
        const { data: verifyData, error: verifyError } = await client.auth.verifyOtp({
            email: options.email,
            token: otp,
            type: 'email'
        });
        if (verifyError || !verifyData?.session) {
            throw verifyError || new Error('OTP verification failed.');
        }

        const resolvedUserId = verifyData.user?.id || verifyData.session.user?.id || generatedUserId;
        if (resolvedUserId) {
            await ensureRoleRecords(supabaseUrl, serviceKey, resolvedUserId, options.email, options.role);
        }
        session = verifyData.session;
    }

    const userId = session?.user?.id || null;
    if (userId) {
        await ensureRoleRecords(supabaseUrl, serviceKey, userId, options.email, options.role);
    }

    const storageKey = getStorageKey(supabaseUrl);
    await page.addInitScript(({ key, session }) => {
        const expiresAt = Math.floor(Date.now() / 1000) + Number(session?.expires_in || 3600);
        const persistedSession = {
            currentSession: session,
            expiresAt,
            access_token: session?.access_token,
            refresh_token: session?.refresh_token,
            expires_in: session?.expires_in,
            token_type: session?.token_type,
            user: session?.user,
        };

        localStorage.setItem(key, JSON.stringify(session));
        localStorage.setItem('supabase.auth.token', JSON.stringify(persistedSession));
    }, { key: storageKey, session });

    const postLoginPath = options.postLoginPath
        || (options.role === 'admin' || options.role === 'owner' ? '/dashboard' : '/');
    const targetUrl = options.baseUrl.replace(/\/$/, '') + postLoginPath;
    await navigateAfterSessionBootstrap(page, targetUrl);
};

export const loginAsAdminWithOtpBypass = async (page: Page, email: string, baseUrl: string) => {
    await loginWithOtpBypass(page, { email, role: 'admin', baseUrl });
};
