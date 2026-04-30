import { expect, type Locator, type Page } from '@playwright/test';

export const waitForDocumentReady = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => undefined);
    await page.waitForFunction(
        () => document.readyState === 'interactive' || document.readyState === 'complete',
        { timeout: 10000 },
    ).catch(() => undefined);
    await page.waitForFunction(
        () => Boolean(document.documentElement && document.body),
        { timeout: 10000 },
    ).catch(() => undefined);
};

export const waitForSplashToDisappear = async (page: Page, selector = '#initial-splash') => {
    const splash = page.locator(selector);
    if (!(await splash.count())) {
        return;
    }

    await splash.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(async () => {
        await page.evaluate((targetSelector) => {
            document.querySelector(targetSelector)?.remove();
        }, selector);
    });
};

export const waitForAppShell = async (page: Page) => {
    await waitForDocumentReady(page);
    await waitForSplashToDisappear(page);
    await page.waitForFunction(() => {
        const body = document.body;
        if (!body) return false;

        const text = String(body.textContent || '').trim();
        if (/^initializing\.{0,3}$/i.test(text)) {
            return false;
        }

        const hasRouteLoader = /loading page\.\.\./i.test(text);
        const compactText = text.replace(/\s+/g, '');
        const onlyRouteLoaderVisible = compactText.length > 0
            && compactText.replace(/loadingpage\.\.\./gi, '').length === 0;

        if (onlyRouteLoaderVisible || hasRouteLoader) {
            return false;
        }

        return true;
    }, { timeout: 20000 }).catch(() => undefined);
};

export const expectToStayVisible = async (
    locator: Locator,
    options?: { timeout?: number; message?: string },
) => {
    await expect.poll(
        async () => locator.isVisible().catch(() => false),
        {
            timeout: options?.timeout ?? 3000,
            message: options?.message,
        },
    ).toBe(true);
};
