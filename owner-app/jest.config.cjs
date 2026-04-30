module.exports = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: '@happy-dom/jest-environment',
    extensionsToTreatAsEsm: ['.ts', '.tsx'],
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
                VITE_APP_TYPE: 'owner',
            }
        }
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^\\./protected-edge\\.service$': '<rootDir>/src/test/mocks/protected-edge.service.ts',
        '^\\./supabase-config$': '<rootDir>/src/test/mocks/supabase-config.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@components/(.*)$': '<rootDir>/src/components/$1',
        '^@services/(.*)$': '<rootDir>/src/services/$1',
        '^@pages/(.*)$': '<rootDir>/src/pages/$1',
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
        '^@types/(.*)$': '<rootDir>/src/types/$1',
        '^@contexts/(.*)$': '<rootDir>/src/contexts/$1',
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    },
    transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', {
            tsconfig: 'tsconfig.test.json',
            useESM: true,
        }],
    },
    testMatch: [
        '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
        '<rootDir>/src/**/*.{spec,test}.{ts,tsx}',
    ],
    testPathIgnorePatterns: ['<rootDir>/e2e/'],
};
