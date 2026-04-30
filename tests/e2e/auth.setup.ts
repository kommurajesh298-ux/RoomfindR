import { test as setup } from '@playwright/test';
import { seedAuthState, writeEmptyAuthState } from '../helpers/auth-state';
import { getRequestedRoles, loadE2eEnv } from '../helpers/e2e-config';

setup('seed auth storage states', async ({ browser }) => {
    setup.setTimeout(300000);
    loadE2eEnv();
    await Promise.all(getRequestedRoles().map(async (role) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await Promise.race([
                seedAuthState(page, role),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Auth bootstrap timed out for ${role}`)), 90000);
                })
            ]);
        } catch (error) {
            await page.screenshot({ path: `auth-failure-${role}.png`, timeout: 5000 }).catch(() => undefined);
            writeEmptyAuthState(role);
            console.warn(`Auth bootstrap fell back to an empty storage state for ${role}:`, error);
        } finally {
            await context.close().catch(() => undefined);
        }
    }));
});
