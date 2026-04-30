import type { Page } from '@playwright/test';
import { loadE2eEnv, BASE_URLS } from './e2e-config';
import { primeAppStorage, waitForAppReady } from './app-shell';
import { resolveAuthEmail } from './auth-state';
import { loginWithOtpBypass, resolveSupabaseEnv } from './supabase-auth';
import { SupabaseAdminHelper } from './supabase-admin';
import { TEST_USERS } from './test-data';

type EnsureAuthOptions = {
    role: 'customer' | 'owner' | 'admin';
    email: string;
    baseUrl: string;
    postLoginPath?: string;
};

const canReuseNavigationAfterTimeout = (page: Page, targetUrl: string) => {
    try {
        const currentUrl = page.url();
        if (!currentUrl || currentUrl === 'about:blank') {
            return false;
        }

        const target = new URL(targetUrl);
        const current = new URL(currentUrl);
        return current.origin === target.origin && current.pathname === target.pathname;
    } catch {
        return false;
    }
};

const navigateForAuth = async (page: Page, url: string) => {
    try {
        await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
    } catch (error) {
        if (!canReuseNavigationAfterTimeout(page, url)) {
            await page.waitForTimeout(1200);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (retryError) {
                if (!canReuseNavigationAfterTimeout(page, url)) {
                    throw retryError;
                }
            }
        }
    }

    await waitForAppReady(page);
};

const getUiSupabaseUrl = async (_page: Page): Promise<string> => {
    // Prefer Node-side env to avoid import.meta access in page context.
    return process.env.VITE_SUPABASE_URL
        || process.env.SUPABASE_URL
        || '';
};

const isLoginScreenVisible = async (page: Page): Promise<boolean> => {
    if (/\/login(?:[/?#]|$)/i.test(page.url())) {
        return true;
    }

    const emailInput = page.getByLabel(/Email/i).first();
    const loginHeading = page.getByRole('heading', { name: /Login/i }).first();

    if (await emailInput.isVisible().catch(() => false)) {
        return true;
    }

    return loginHeading.isVisible().catch(() => false);
};

const getCurrentSessionEmail = async (page: Page): Promise<string | null> => {
    return page.evaluate(() => {
        try {
            for (const key of Object.keys(window.localStorage)) {
                if (!key.includes('auth-token')) continue;
                const rawValue = window.localStorage.getItem(key);
                if (!rawValue) continue;
                const parsed = JSON.parse(rawValue);
                const email = parsed?.user?.email
                    || parsed?.currentSession?.user?.email
                    || parsed?.session?.user?.email
                    || null;
                if (typeof email === 'string' && email.trim()) {
                    return email.trim().toLowerCase();
                }
            }
        } catch {
            return null;
        }

        return null;
    }).catch(() => null);
};

export const ensureLoggedIn = async (page: Page, options: EnsureAuthOptions) => {
    loadE2eEnv();
    const baseUrl = options.baseUrl.replace(/\/$/, '');
    const postLoginPath = options.postLoginPath
        || (options.role === 'admin' || options.role === 'owner' ? '/dashboard' : '/');
    const loginUrl = `${baseUrl}/login`;

    await primeAppStorage(page, options.role);
    await navigateForAuth(page, loginUrl);

    const hasSession = await page.evaluate(() => {
        return Object.keys(localStorage).some((k) => k.includes('auth-token') && localStorage.getItem(k));
    });
    const targetEmail = options.email.trim().toLowerCase();

    if (hasSession) {
        const currentSessionEmail = await getCurrentSessionEmail(page);
        await navigateForAuth(page, `${baseUrl}${postLoginPath}`);
        if (currentSessionEmail === targetEmail && !(await isLoginScreenVisible(page))) {
            return;
        }

        await page.context().clearCookies();
        await page.evaluate(() => {
            Object.keys(window.localStorage)
                .filter((key) => key.includes('auth-token'))
                .forEach((key) => window.localStorage.removeItem(key));
            window.sessionStorage.clear();
        });
    }

    await navigateForAuth(page, loginUrl);

    const uiSupabaseUrl = await getUiSupabaseUrl(page);
    if (uiSupabaseUrl) {
        process.env.E2E_TARGET_SUPABASE_URL = uiSupabaseUrl;
    }

    const env = resolveSupabaseEnv(uiSupabaseUrl || process.env.VITE_SUPABASE_URL || baseUrl);
    await loginWithOtpBypass(page, {
        role: options.role,
        email: options.email,
        baseUrl,
        supabaseUrl: env.supabaseUrl,
        anonKey: env.anonKey,
        serviceKey: env.serviceKey,
        postLoginPath
    });
    await waitForAppReady(page);

    if (await isLoginScreenVisible(page)) {
        throw new Error(`Failed to establish a valid ${options.role} session for ${options.email}`);
    }
};

export const ensureCustomerLoggedIn = async (page: Page) => {
    await ensureLoggedIn(page, {
        role: 'customer',
        email: TEST_USERS.customer.email,
        baseUrl: BASE_URLS.customer,
        postLoginPath: '/'
    });
};

export const ensureCustomerLoggedInAs = async (
    page: Page,
    email: string,
    options?: { password?: string },
) => {
    try {
        const admin = new SupabaseAdminHelper();
        let customer = await admin.findUserByEmail(email);
        if (!customer) {
            customer = await admin.createTestUser(
                email,
                options?.password || TEST_USERS.customer.password,
                'customer',
            );
        }
        if (customer) {
            await admin.ensureCustomerProfile(customer.id, email);
        }
    } catch (error) {
        console.warn('[E2E Customer Auth] Customer bootstrap failed, continuing with login bypass flow:', error);
    }

    await ensureLoggedIn(page, {
        role: 'customer',
        email,
        baseUrl: BASE_URLS.customer,
        postLoginPath: '/',
    });
};

export const ensureOwnerLoggedIn = async (page: Page) => {
    try {
        const admin = new SupabaseAdminHelper();
        let owner = await admin.findUserByEmail(TEST_USERS.owner.email);
        if (!owner) {
            owner = await admin.createTestUser(TEST_USERS.owner.email, TEST_USERS.owner.password, 'owner');
        }
        if (owner) {
            await admin.ensureOwnerVerified(owner.id, TEST_USERS.owner.email);
        }
    } catch (error) {
        console.warn('[E2E Owner Auth] Owner bootstrap failed, continuing with login bypass flow:', error);
    }

    await ensureLoggedIn(page, {
        role: 'owner',
        email: TEST_USERS.owner.email,
        baseUrl: BASE_URLS.owner
    });
};

export const ensureOwnerLoggedInAs = async (
    page: Page,
    email: string,
    options?: { password?: string },
) => {
    try {
        const admin = new SupabaseAdminHelper();
        let owner = await admin.findUserByEmail(email);
        if (!owner) {
            owner = await admin.createTestUser(
                email,
                options?.password || TEST_USERS.owner.password,
                'owner',
            );
        }
        if (owner) {
            await admin.ensureOwnerVerified(owner.id, email);
        }
    } catch (error) {
        console.warn('[E2E Owner Auth] Owner bootstrap failed, continuing with login bypass flow:', error);
    }

    await ensureLoggedIn(page, {
        role: 'owner',
        email,
        baseUrl: BASE_URLS.owner,
    });
};

export const ensureAdminLoggedIn = async (page: Page) => {
    const adminEmail = await resolveAuthEmail('admin', resolveSupabaseEnv(BASE_URLS.admin));
    await ensureLoggedIn(page, {
        role: 'admin',
        email: adminEmail,
        baseUrl: BASE_URLS.admin
    });
};
