import type { Page } from '@playwright/test';
import { waitForAppShell } from '../utils/wait';

type AppRole = 'customer' | 'owner' | 'admin';

const DEFAULT_LOCATION = {
    city: 'Bengaluru',
    lat: 12.9716,
    lng: 77.5946
};

export const primeAppStorage = async (page: Page, role: AppRole) => {
    await page.addInitScript(({ appRole, location }) => {
        try {
            if (appRole !== 'customer') {
                return;
            }

            localStorage.setItem('app_reset_v4', 'true');
            if (!localStorage.getItem('lastLocation')) {
                localStorage.setItem('lastLocation', JSON.stringify(location));
            }
        } catch {
            // Ignore storage priming failures in test bootstrap.
        }
    }, { appRole: role, location: DEFAULT_LOCATION });
};

export const waitForAppReady = async (page: Page) => {
    await waitForAppShell(page);
    await page.waitForFunction(() => {
        const root = document.getElementById('root');
        if (!root) return false;

        const text = String(root.textContent || '').trim();
        const hasRenderedChildren = root.childElementCount > 0;
        const isInitOnly = /^initializing\.{0,3}$/i.test(text);
        const compactText = text.replace(/\s+/g, '');
        const hasRouteLoader = /loading page\.\.\./i.test(text);
        const isRouteLoaderOnly = compactText.length > 0
            && compactText.replace(/loadingpage\.\.\./gi, '').length === 0;

        return (hasRenderedChildren || (text.length > 0 && !isInitOnly))
            && !isRouteLoaderOnly
            && !hasRouteLoader;
    }, { timeout: 30000 }).catch(() => undefined);
};

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

export const gotoAppRoute = async (page: Page, url: string) => {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
        if (!isSameRoute(page, url)) {
            await page.waitForTimeout(1000);
            await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
        }
    }

    await waitForAppReady(page);

    const isUnexpectedLoginRedirect = (() => {
        try {
            const current = new URL(page.url());
            const target = new URL(url);
            return target.pathname !== '/login' && /\/login(?:[/?#]|$)/i.test(current.pathname);
        } catch {
            return false;
        }
    })();

    if (isUnexpectedLoginRedirect) {
        const hasStoredSession = await page.evaluate(() => {
            try {
                return Object.keys(window.localStorage).some((key) => {
                    return /auth-token/i.test(key) && Boolean(window.localStorage.getItem(key));
                });
            } catch {
                return false;
            }
        }).catch(() => false);

        if (hasStoredSession) {
            await page.waitForTimeout(1500);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (error) {
                if (!isSameRoute(page, url)) {
                    throw error;
                }
            }
            await waitForAppReady(page);
        }
    }

    const body = page.locator('body');
    const bodyText = ((await body.textContent().catch(() => '')) || '').trim();
    if (/^initializing\.{0,3}$/i.test(bodyText)) {
        await page.waitForFunction(() => {
            const text = String(document.body?.textContent || '').trim();
            return !/^initializing\.{0,3}$/i.test(text);
        }, { timeout: 15000 }).catch(() => undefined);

        const refreshedBodyText = ((await body.textContent().catch(() => '')) || '').trim();
        if (/^initializing\.{0,3}$/i.test(refreshedBodyText)) {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
            await waitForAppReady(page);
        }
    }
};
