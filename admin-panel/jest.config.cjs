module.exports = {
    preset: 'ts-jest',
    testEnvironment: '@happy-dom/jest-environment',
    setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
    globals: {
        'import.meta': {
            env: {
                VITE_IS_PRODUCTION: 'false',
                DEV: true,
                PROD: false,
                MODE: 'test',
                VITE_SUPABASE_URL: 'https://mock.supabase.co',
                VITE_SUPABASE_ANON_KEY: 'mock-key',
                VITE_APP_TYPE: 'admin',
            }
        }
    },
    moduleNameMapper: {
        '^\\./protected-edge\\.service$': '<rootDir>/src/test/mocks/protected-edge.service.ts',
        '^\\./supabase-config$': '<rootDir>/src/test/mocks/supabase-config.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    },
    transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', {
            tsconfig: 'tsconfig.test.json',
        }],
    },
    testMatch: [
        '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
        '<rootDir>/src/**/*.{spec,test}.{ts,tsx}',
    ],
    testPathIgnorePatterns: ['<rootDir>/e2e/'],
};
