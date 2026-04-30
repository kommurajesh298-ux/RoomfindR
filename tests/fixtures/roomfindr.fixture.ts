import { test as base, expect } from '@playwright/test';
import { loadE2eEnv, BASE_URLS } from '../helpers/e2e-config';
import { SupabaseAdminHelper } from '../helpers/supabase-admin';
import { CleanupRegistry } from '../utils/cleanup-registry';
import { createBookingHelper } from '../helpers/createBookingHelper';
import { createPaymentHelper } from '../helpers/paymentHelper';
import { createOwnerApprovalHelper } from '../helpers/ownerApprovalHelper';
import { cleanupTestData } from '../helpers/cleanupTestData';
import { loginHelper, logoutHelper } from '../helpers/loginHelper';
import { signupHelper } from '../helpers/signupHelper';
import { CustomerApp } from '../helpers/pom/CustomerApp';
import { OwnerApp } from '../helpers/pom/OwnerApp';
import { AdminOwnersPage } from '../helpers/pom/AdminOwnersPage';
import { AdminRefundsPage } from '../helpers/pom/AdminRefundsPage';

type BoundLoginHelper = (options: Parameters<typeof loginHelper>[1]) => ReturnType<typeof loginHelper>;
type BoundLogoutHelper = (options: Parameters<typeof logoutHelper>[1]) => ReturnType<typeof logoutHelper>;
type BoundCleanupHelper = (request: Parameters<typeof cleanupTestData>[1]) => ReturnType<typeof cleanupTestData>;

type RoomFindrFixtures = {
    appUrls: typeof BASE_URLS;
    adminHelper: SupabaseAdminHelper;
    cleanupRegistry: CleanupRegistry;
    login: BoundLoginHelper;
    logout: BoundLogoutHelper;
    signup: (options: Parameters<typeof signupHelper>[2]) => ReturnType<typeof signupHelper>;
    bookingHelper: ReturnType<typeof createBookingHelper>;
    paymentHelper: ReturnType<typeof createPaymentHelper>;
    ownerApprovalHelper: ReturnType<typeof createOwnerApprovalHelper>;
    cleanupTestData: BoundCleanupHelper;
    customerApp: CustomerApp;
    ownerApp: OwnerApp;
    adminOwnersPage: AdminOwnersPage;
    adminRefundsPage: AdminRefundsPage;
    diagnostics: void;
};

export const test = base.extend<RoomFindrFixtures>({
    appUrls: [async ({}, use) => {
        loadE2eEnv();
        await use(BASE_URLS);
    }, { scope: 'worker' }],

    adminHelper: [async ({}, use) => {
        loadE2eEnv();
        const admin = new SupabaseAdminHelper();
        await use(admin);
    }, { scope: 'worker' }],

    cleanupRegistry: async ({}, use) => {
        const registry = new CleanupRegistry();
        await use(registry);
        await registry.runAll();
    },

    login: async ({ page }, use) => {
        await use((...args) => loginHelper(page, ...args));
    },

    logout: async ({ page }, use) => {
        await use((...args) => logoutHelper(page, ...args));
    },

    signup: async ({ page, adminHelper }, use) => {
        await use((options) => signupHelper(page, adminHelper, options));
    },

    bookingHelper: async ({ adminHelper }, use) => {
        await use(createBookingHelper(adminHelper));
    },

    paymentHelper: async ({ adminHelper }, use) => {
        await use(createPaymentHelper(adminHelper));
    },

    ownerApprovalHelper: async ({ adminHelper }, use) => {
        await use(createOwnerApprovalHelper(adminHelper));
    },

    cleanupTestData: async ({ adminHelper }, use) => {
        await use((request) => cleanupTestData(adminHelper, request));
    },

    customerApp: async ({ page }, use) => {
        await use(new CustomerApp(page));
    },

    ownerApp: async ({ page }, use) => {
        await use(new OwnerApp(page));
    },

    adminOwnersPage: async ({ page }, use) => {
        await use(new AdminOwnersPage(page));
    },

    adminRefundsPage: async ({ page }, use) => {
        await use(new AdminRefundsPage(page));
    },
    diagnostics: [async ({ page }, use, testInfo) => {
        const consoleMessages: string[] = [];
        const pageErrors: string[] = [];
        const failedRequests: string[] = [];

        page.on('console', (message) => {
            consoleMessages.push(`[${message.type()}] ${message.text()}`);
        });
        page.on('pageerror', (error) => {
            pageErrors.push(error.message);
        });
        page.on('requestfailed', (request) => {
            failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown failure'}`);
        });

        await use();

        if (testInfo.status === testInfo.expectedStatus) {
            return;
        }

        const diagnostics = [
            'Console',
            consoleMessages.join('\n') || '(none)',
            '',
            'Page Errors',
            pageErrors.join('\n') || '(none)',
            '',
            'Failed Requests',
            failedRequests.join('\n') || '(none)',
        ].join('\n');

        await testInfo.attach('browser-diagnostics.txt', {
            contentType: 'text/plain',
            body: Buffer.from(diagnostics, 'utf8'),
        });
    }, { auto: true }],
});

export { expect };
