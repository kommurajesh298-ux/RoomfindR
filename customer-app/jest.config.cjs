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
                VITE_AMERICA_BING_MAP_KEY: 'mock-bing-key'
            }
        }
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@/(.*)$': '<rootDir>/src/$1',
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    },
    transform: {
        '^.+\\.(ts|tsx|js|jsx|mjs)$': ['ts-jest', {
            tsconfig: 'tsconfig.test.json',
            useESM: true,
        }],
    },
    transformIgnorePatterns: [
        '/node_modules/(?!(react-router-dom|react-router|@remix-run|@testing-library|framer-motion|dexie|react-hot-toast|lucide-react|react-icons)/)',
    ],
    testPathIgnorePatterns: ['<rootDir>/e2e/'],
};
