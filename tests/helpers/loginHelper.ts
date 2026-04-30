import type { Page } from '@playwright/test';
import { BASE_URLS } from './e2e-config';
import { gotoAppRoute, primeAppStorage } from './app-shell';
import { ensureLoggedIn } from './auth-session';
import { TEST_USERS, type TestIdentity, type TestRole } from '../data/test-users';

type LoginHelperOptions = {
    role: TestRole;
    email?: string;
    password?: string;
    baseUrl?: string;
    postLoginPath?: string;
    mode?: 'bypass' | 'ui';
};

type LogoutHelperOptions = {
    role: TestRole;
    baseUrl?: string;
};

const loginSubmitButtonPattern = /Log ?In|Sign In|Enter Admin Console/i;

const resolveDefaultPostLoginPath = (role: TestRole) =>
    (role === 'admin' || role === 'owner') ? '/dashboard' : '/';

const hasAuthToken = async (page: Page) => page.evaluate(() => {
    try {
        return Object.keys(window.localStorage).some((key) => (
            key.includes('auth-token') && Boolean(window.localStorage.getItem(key))
        ));
    } catch {
        return false;
    }
}).catch(() => false);

const fillEmailField = async (page: Page, email: string) => {
    await page
        .locator('#email, input[autocomplete="email"], input[name*="email" i], input[placeholder*="email" i], input[type="email"]')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => undefined);

    const candidates = [
        page.locator('#email').first(),
        page.getByRole('textbox', { name: /Email/i }).first(),
        page.getByLabel(/Email/i).first(),
        page.locator('input[autocomplete="email"]').first(),
        page.locator('input[name*="email" i]').first(),
        page.locator('input[placeholder*="email" i]').first(),
        page.locator('input[type="email"]').first(),
    ];

    for (const candidate of candidates) {
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) {
            continue;
        }

        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.fill(email);
        return;
    }

    throw new Error('Unable to find a visible email input on the login form');
};

const resolveIdentity = (role: TestRole, options: LoginHelperOptions): TestIdentity => ({
    ...TEST_USERS[role],
    email: options.email || TEST_USERS[role].email,
    password: options.password || TEST_USERS[role].password,
});

export const loginHelper = async (page: Page, options: LoginHelperOptions) => {
    const identity = resolveIdentity(options.role, options);
    const baseUrl = (options.baseUrl || BASE_URLS[options.role]).replace(/\/$/, '');
    const postLoginPath = options.postLoginPath || resolveDefaultPostLoginPath(options.role);

    if (options.mode !== 'ui') {
        await ensureLoggedIn(page, {
            role: options.role,
            email: identity.email,
            baseUrl,
            postLoginPath,
        });
        return identity;
    }

    if (options.role === 'customer') {
        await primeAppStorage(page, 'customer');
    }

    await page.context().clearCookies().catch(() => undefined);
    await page.goto('about:blank').catch(() => undefined);
    await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
    }).catch(() => undefined);

    await gotoAppRoute(page, `${baseUrl}/login`);
    await fillEmailField(page, identity.email);

    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill(identity.password);

    await page.getByRole('button', { name: loginSubmitButtonPattern }).first().click();
    await Promise.race([
        page.waitForURL((url) => !/\/login(?:[/?#]|$)/i.test(url.toString()), { timeout: 15000 }),
        page.waitForFunction(() => {
            try {
                return Object.keys(window.localStorage).some((key) => (
                    key.includes('auth-token') && Boolean(window.localStorage.getItem(key))
                ));
            } catch {
                return false;
            }
        }, undefined, { timeout: 15000 }),
    ]).catch(() => undefined);

    if (/\/login(?:[/?#]|$)/i.test(page.url()) && await hasAuthToken(page)) {
        await gotoAppRoute(page, `${baseUrl}${postLoginPath}`);
    }

    await page.waitForURL((url) => !/\/login(?:[/?#]|$)/i.test(url.toString()), { timeout: 15000 }).catch(() => undefined);

    return identity;
};

export const logoutHelper = async (page: Page, options: LogoutHelperOptions) => {
    const baseUrl = (options.baseUrl || BASE_URLS[options.role]).replace(/\/$/, '');
    const isOnLoginRoute = () => /\/login(?:[/?#]|$)/i.test(page.url());
    const waitForSessionClear = async () => {
        await page.waitForFunction(() => {
            return Object.keys(window.localStorage).every((key) => {
                if (!key.includes('auth-token')) {
                    return true;
                }

                return !window.localStorage.getItem(key);
            });
        }, undefined, { timeout: 15000 }).catch(() => undefined);
    };

    if (options.role === 'customer') {
        await gotoAppRoute(page, `${baseUrl}/profile`);
        if (isOnLoginRoute() || !(await hasAuthToken(page))) {
            await waitForSessionClear();
            return;
        }

        const signOutButtons = [
            page.getByRole('button', { name: /Sign Out Account/i }).first(),
            page.getByRole('button', { name: /^Sign Out$/i }).first(),
            page.getByRole('button', { name: /Sign Out/i }).first(),
        ];

        let signOutClicked = false;
        for (const signOutButton of signOutButtons) {
            if (!(await signOutButton.isVisible().catch(() => false))) {
                continue;
            }

            await signOutButton.scrollIntoViewIfNeeded().catch(() => undefined);
            await signOutButton.click({ force: true });
            signOutClicked = true;
            break;
        }

        if (!signOutClicked) {
            if (isOnLoginRoute() || !(await hasAuthToken(page))) {
                await waitForSessionClear();
                return;
            }
            throw new Error('Unable to find a visible customer sign-out button.');
        }

        const dialog = page.getByRole('dialog').filter({ hasText: /Sign out of your account\?/i }).first();
        const confirmButtonInDialog = dialog.getByRole('button', { name: /^Sign Out$/i }).first();
        const fallbackConfirmButton = page.getByRole('button', { name: /^Sign Out$/i }).last();

        const dialogVisible = await dialog.isVisible().catch(() => false);
        if (!dialogVisible) {
            await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
        }

        if (await confirmButtonInDialog.isVisible().catch(() => false)) {
            await confirmButtonInDialog.click({ force: true });
        } else if (await fallbackConfirmButton.isVisible().catch(() => false)) {
            await fallbackConfirmButton.click({ force: true });
        }

        await waitForSessionClear();
        await page.waitForURL(/\/login|\/$/, { timeout: 15000 }).catch(() => undefined);
    } else if (options.role === 'owner') {
        await gotoAppRoute(page, `${baseUrl}/dashboard`);
        await page.getByRole('button', { name: /Sign Out/i }).first().click();
        await waitForSessionClear();
    } else {
        await gotoAppRoute(page, `${baseUrl}/dashboard`);
        await page.getByRole('button', { name: /Sign Out/i }).first().click();
        await waitForSessionClear();
    }
};
