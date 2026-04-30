import type { Page } from '@playwright/test';
import { gotoAppRoute, primeAppStorage } from './app-shell';
import { BASE_URLS } from './e2e-config';
import { loginWithOtpBypass } from './supabase-auth';
import { SupabaseAdminHelper } from './supabase-admin';
import { TEST_USERS, type TestIdentity, type TestRole, createTestIdentity } from '../data/test-users';

type SignupHelperOptions = {
    role: TestRole;
    identity?: Partial<TestIdentity>;
    completeWithBypass?: boolean;
};

const ensureStrongSignupPassword = (password: string) => {
    const value = String(password || '').trim();
    const hasMinLength = value.length >= 8;
    const hasDigit = /\d/.test(value);
    const hasSpecial = /[^a-zA-Z0-9]/.test(value);

    if (hasMinLength && hasDigit && hasSpecial) {
        return value;
    }

    return 'Password@123';
};

const fillCustomerSignup = async (page: Page, identity: TestIdentity) => {
    await primeAppStorage(page, 'customer');
    await gotoAppRoute(page, `${BASE_URLS.customer}/signup`);

    const signupPassword = ensureStrongSignupPassword(identity.password);

    await page.getByLabel(/Full Name/i).fill(identity.fullName);
    await page.getByLabel(/Email/i).fill(identity.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(signupPassword);
    await page.getByRole('textbox', { name: 'Confirm Password', exact: true }).fill(signupPassword);
    await page.getByRole('button', { name: /^Next$/i }).click();
    await page.locator('#phone').waitFor({ state: 'visible', timeout: 15000 });

    await page.locator('#phone').fill(identity.phone.replace(/^\+91/, ''));
    await page.locator('#city').selectOption(identity.city || 'Bengaluru');
    await page.getByRole('button', { name: /^Next$/i }).click();
};

export const signupHelper = async (
    page: Page,
    admin: SupabaseAdminHelper,
    options: SignupHelperOptions,
) => {
    const baseIdentity = options.identity?.email
        ? createTestIdentity('signup', options.role, options.identity)
        : createTestIdentity('signup', options.role);
    const identity = {
        ...TEST_USERS[options.role],
        ...baseIdentity,
        ...options.identity,
        role: options.role,
        password: options.role === 'customer'
            ? ensureStrongSignupPassword(options.identity?.password || baseIdentity.password || TEST_USERS.customer.password)
            : (options.identity?.password || baseIdentity.password || TEST_USERS[options.role].password),
    } as TestIdentity;

    if (options.role === 'customer') {
        await fillCustomerSignup(page, identity);

        if (options.completeWithBypass) {
            await loginWithOtpBypass(page, {
                role: 'customer',
                email: identity.email,
                baseUrl: BASE_URLS.customer,
                postLoginPath: '/',
            });
        }

        return identity;
    }

    const user = await admin.createTestUser(identity.email, identity.password, options.role);
    if (user?.id && options.role === 'owner') {
        await admin.ensureOwnerProfile(user.id, identity.email);
    }
    if (user?.id && options.role === 'admin') {
        await admin.supabase.from('admins').upsert({
            id: user.id,
            name: identity.fullName,
            email: identity.email,
            updated_at: new Date().toISOString(),
        });
    }

    if (options.completeWithBypass) {
        await loginWithOtpBypass(page, {
            role: options.role,
            email: identity.email,
            baseUrl: BASE_URLS[options.role],
            postLoginPath: options.role === 'customer' ? '/' : '/dashboard',
        });
    }

    return identity;
};
