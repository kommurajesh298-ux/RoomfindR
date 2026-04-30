import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'node:path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, 'supabase', '.env') });

const localSupabaseUrl = process.env.SUPABASE_URL;
const localAnonKey = process.env.SUPABASE_ANON_KEY;
if (localSupabaseUrl && localAnonKey) {
    process.env.VITE_SUPABASE_URL = localSupabaseUrl;
    process.env.VITE_SUPABASE_ANON_KEY = localAnonKey;
}

const webServerEnv = { ...process.env } as Record<string, string>;
if (localSupabaseUrl && localAnonKey) {
    webServerEnv.VITE_SUPABASE_URL = localSupabaseUrl;
    webServerEnv.VITE_SUPABASE_ANON_KEY = localAnonKey;
}

const enableCrossBrowserMatrix = process.env.E2E_CROSS_BROWSER === '1';
const commonDesktopUse = {
    viewport: { width: 1440, height: 960 },
};

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 120000,
    expect: {
        timeout: 15000,
    },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 2 : undefined,
    outputDir: 'tests/results',
    reporter: [
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['json', { outputFile: 'tests/reports/playwright-report.json' }],
        ['junit', { outputFile: 'tests/reports/playwright-report.xml' }],
        ['list']
    ],
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        baseURL: 'http://127.0.0.1:5173', // Default to customer app
        actionTimeout: 15000,
        navigationTimeout: 30000,
    },

    projects: [
        {
            name: 'setup',
            testMatch: /global\.setup\.ts/,
        },
        {
            name: 'auth-setup',
            testMatch: /auth\.setup\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://127.0.0.1:5173',
            },
            dependencies: ['setup']
        },
        {
            name: 'auth',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                baseURL: 'http://127.0.0.1:5173',
            },
            testDir: './tests/e2e/auth',
            dependencies: ['setup']
        },
        {
            name: 'customer',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                storageState: 'playwright/.auth/customer.json',
                baseURL: 'http://127.0.0.1:5173',
            },
            testDir: './tests/e2e/customer',
            testIgnore: /mobile\.spec\.ts/,
            dependencies: ['setup', 'auth-setup'],
        },
        {
            name: 'customer-mobile',
            use: {
                ...devices['Pixel 5'],
                storageState: 'playwright/.auth/customer.json',
                baseURL: 'http://127.0.0.1:5173',
            },
            testDir: './tests/e2e/customer',
            testMatch: /mobile\.spec\.ts|account\.spec\.ts|public-browse\.spec\.ts/,
            dependencies: ['setup', 'auth-setup'],
        },
        {
            name: 'owner',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                storageState: 'playwright/.auth/owner.json',
                baseURL: 'http://127.0.0.1:5174',
            },
            dependencies: ['setup', 'auth-setup'],
            testDir: './tests/e2e/owner',
        },
        {
            name: 'admin',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                storageState: 'playwright/.auth/admin.json',
                baseURL: 'http://127.0.0.1:5175',
            },
            dependencies: ['setup', 'auth-setup'],
            testDir: './tests/e2e/admin',
        },
        {
            name: 'payments',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                storageState: 'playwright/.auth/customer.json',
                baseURL: 'http://127.0.0.1:5173', // Payments usually start from Customer App
            },
            dependencies: ['setup', 'auth-setup'],
            testDir: './tests/e2e/payments',
        },
        {
            name: 'booking',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                baseURL: 'http://127.0.0.1:5173',
            },
            dependencies: ['setup'],
            testDir: './tests/e2e/booking',
        },
        {
            name: 'refunds',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                baseURL: 'http://127.0.0.1:5173',
            },
            dependencies: ['setup'],
            testDir: './tests/e2e/refunds',
        },
        {
            name: 'database',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
            },
            dependencies: ['setup'],
            testDir: './tests/e2e/database',
        },
        {
            name: 'realtime',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                storageState: 'playwright/.auth/customer.json',
                baseURL: 'http://127.0.0.1:5173',
            },
            dependencies: ['setup', 'auth-setup'],
            testDir: './tests/e2e/realtime',
        },
        {
            name: 'system',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
                baseURL: 'http://127.0.0.1:5173',
            },
            dependencies: ['setup', 'auth-setup'],
            testDir: './tests',
            testMatch: /(?:auth|payments|booking|settlement|refund|rent|realtime)\/.*\.spec\.ts/,
            testIgnore: /e2e[\\/]/,
        },
        {
            name: 'android-validation',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
            },
            dependencies: ['setup'],
            testDir: './tests/android',
        },
        {
            name: 'ios-validation',
            use: {
                ...devices['Desktop Chrome'],
                ...commonDesktopUse,
            },
            dependencies: ['setup'],
            testDir: './tests/ios',
        },
        ...(enableCrossBrowserMatrix
            ? [
                {
                    name: 'auth-firefox',
                    use: {
                        ...devices['Desktop Firefox'],
                        ...commonDesktopUse,
                        baseURL: 'http://127.0.0.1:5173',
                    },
                    dependencies: ['setup'],
                    testDir: './tests/e2e/auth',
                    testMatch: /public-auth\.spec\.ts|access-control\.spec\.ts|auth-flow\.spec\.ts/,
                },
                {
                    name: 'customer-webkit',
                    use: {
                        ...devices['Desktop Safari'],
                        viewport: { width: 1280, height: 900 },
                        baseURL: 'http://127.0.0.1:5173',
                    },
                    dependencies: ['setup'],
                    testDir: './tests/e2e/customer',
                    testMatch: /public-browse\.spec\.ts|search-filter\.spec\.ts/,
                }
            ]
            : [])
    ],

    /* Run your local dev server before starting the tests */
    webServer: [
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5173',
            url: 'http://127.0.0.1:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            stdout: 'pipe',
            env: webServerEnv,
            cwd: path.resolve(__dirname, 'customer-app'),
        },
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5174',
            url: 'http://127.0.0.1:5174',
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            stdout: 'pipe',
            env: webServerEnv,
            cwd: path.resolve(__dirname, 'owner-app'),
        },
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5175',
            url: 'http://127.0.0.1:5175',
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            stdout: 'pipe',
            env: webServerEnv,
            cwd: path.resolve(__dirname, 'admin-panel'),
        },
    ],

});
