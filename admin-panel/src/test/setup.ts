import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { TextEncoder as TE, TextDecoder as TD } from 'util';

Object.assign(globalThis, {
    TextEncoder: TE,
    TextDecoder: TD
});

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock Supabase
const mockSupabaseQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    order: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation((callback) => {
        return Promise.resolve({ data: [] }).then(callback);
    }),
};

jest.mock('../services/supabase-config', () => ({
    supabase: {
        from: jest.fn(() => mockSupabaseQueryBuilder),
        auth: {
            getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
            signInWithPassword: jest.fn().mockResolvedValue({ data: { user: { id: 'test-uid' } }, error: null }),
            signOut: jest.fn().mockResolvedValue({ error: null }),
        },
    }
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    })),
});
