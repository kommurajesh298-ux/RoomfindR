import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { BASE_URLS, loadE2eEnv } from './e2e-config';
import { primeAppStorage, waitForAppReady } from './app-shell';
import { type AuthRole, loginWithOtpBypass, resolveSupabaseEnv } from './supabase-auth';
import { SupabaseAdminHelper } from './supabase-admin';
import { TEST_USERS } from './test-data';

const AUTH_DIR = path.resolve(__dirname, '../../playwright/.auth');

const POST_LOGIN_PATHS: Record<AuthRole, string> = {
    customer: '/',
    owner: '/dashboard',
    admin: '/dashboard'
};

export const authStatePathForRole = (role: AuthRole) => path.join(AUTH_DIR, `${role}.json`);

export const writeEmptyAuthState = (role: AuthRole) => {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(
        authStatePathForRole(role),
        JSON.stringify({ cookies: [], origins: [] }, null, 2),
        'utf8'
    );
};

export const resolveRoleEmail = (role: AuthRole) => {
    if (role === 'admin') {
        return (
            process.env.E2E_ADMIN_EMAIL
            || process.env.VITE_ADMIN_BOOTSTRAP_EMAIL
            || TEST_USERS.admin.email
        ).toLowerCase().trim();
    }
    return TEST_USERS[role].email;
};

export const resolveAuthEmail = async (
    role: AuthRole,
    env?: { supabaseUrl: string; serviceKey: string }
) => {
    if (role !== 'admin') {
        return resolveRoleEmail(role);
    }

    if (process.env.E2E_ADMIN_EMAIL) {
        return resolveRoleEmail(role);
    }

    return resolveRoleEmail(role);
};

export const seedAuthState = async (page: Page, role: AuthRole) => {
    loadE2eEnv();
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const baseUrl = BASE_URLS[role];
    const env = resolveSupabaseEnv(baseUrl);
    const email = await resolveAuthEmail(role, env);
    const admin = new SupabaseAdminHelper({
        supabaseUrl: env.supabaseUrl,
        serviceKey: env.serviceKey
    });

    try {
        const user = await admin.createTestUser(email, TEST_USERS[role].password, role);
        if (user && role === 'customer') {
            await admin.ensureCustomerProfile(user.id, email);
        }
        if (user && role === 'owner') {
            await admin.ensureOwnerProfile(user.id, email);
        }
    } catch (error) {
        console.warn(`[E2E Auth Bootstrap] Pre-seeding ${role} user failed, continuing with login bypass flow:`, error);
    }

    await primeAppStorage(page, role);
    await loginWithOtpBypass(page, {
        role,
        email,
        baseUrl,
        supabaseUrl: env.supabaseUrl,
        anonKey: env.anonKey,
        serviceKey: env.serviceKey,
        postLoginPath: POST_LOGIN_PATHS[role]
    });
    await waitForAppReady(page);
    await page.context().storageState({ path: authStatePathForRole(role) });
};
