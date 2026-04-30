import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

// TextEncoder/Decoder mocks if needed (usually handled by jest-environment-jsdom)
if (typeof globalThis.TextEncoder === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TextEncoder, TextDecoder } = require('util');
    (globalThis as any).TextEncoder = TextEncoder;
    (globalThis as any).TextDecoder = TextDecoder;
}

// IntersectionObserver mock
class MockIntersectionObserver {
    callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
    }
    observe(element: HTMLElement) {
        this.callback([{ isIntersecting: true, target: element } as unknown as IntersectionObserverEntry], this as any);
    }
    unobserve = jest.fn();
    disconnect = jest.fn();
}
Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: MockIntersectionObserver
});
Object.defineProperty(global, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: MockIntersectionObserver
});

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock Supabase
const mockSupabaseQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    then: jest.fn().mockImplementation((callback) => {
        return Promise.resolve({ data: [] }).then(callback);
    }),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
};

jest.mock('../services/supabase-config', () => ({
    supabase: {
        from: jest.fn(() => mockSupabaseQueryBuilder),
        auth: {
            getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
            signUp: jest.fn().mockResolvedValue({ data: { user: { id: 'test-uid' } }, error: null }),
        },
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn(),
        })),
        removeChannel: jest.fn(),
        storage: {
            from: jest.fn(() => ({
                upload: jest.fn().mockResolvedValue({ data: {}, error: null }),
                getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'http://test.com/img.jpg' } })),
                remove: jest.fn().mockResolvedValue({ data: {}, error: null }),
            })),
        }
    }
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
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
