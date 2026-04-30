/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-require-imports */
 
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

// Mock import.meta for Jest compatibility

Object.defineProperty(window, 'import', {
    value: {
        meta: {
            env: {
                VITE_IS_PRODUCTION: 'false',
                DEV: true,
                PROD: false,
                MODE: 'test'
            }
        }
    },
    writable: true,
});

// import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock Supabase
jest.mock('../services/supabase-config', () => ({
    supabase: {
        from: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
        })),
        auth: {
            getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
            getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
            onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        },
        storage: {
            from: jest.fn(() => ({
                upload: jest.fn().mockResolvedValue({ data: null, error: null }),
                getPublicUrl: jest.fn(() => ({ data: { publicUrl: '' } })),
            })),
        },
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn().mockReturnThis(),
        })),
        removeChannel: jest.fn().mockResolvedValue('ok'),
    },
}));

// Mock react-router-dom
jest.mock('react-router-dom', () => {
    const React = require('react');
    return {
        BrowserRouter: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'browser-router' }, children),
        MemoryRouter: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'memory-router' }, children),
        Navigate: ({ to }: { to: string }) => React.createElement('div', { 'data-testid': 'navigate', 'data-to': to }),
        Link: ({ children, to }: { children: React.ReactNode, to: string }) => React.createElement('a', { href: to }, children),
        useNavigate: () => jest.fn(),
        useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
        useParams: () => ({}),
        useSearchParams: () => [new URLSearchParams(), jest.fn()],
        Routes: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'routes' }, children),
        Route: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'route' }, children),
    };
});

// Mock framer-motion
jest.mock('framer-motion', () => {
    const React = require('react');
    return {
        motion: {
            div: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('div', props as React.Attributes, children),
            button: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('button', props as React.Attributes, children),
            h2: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('h2', props as React.Attributes, children),
            p: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('p', props as React.Attributes, children),
            span: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('span', props as React.Attributes, children),
            section: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('section', props as React.Attributes, children),
            nav: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('nav', props as React.Attributes, children),
            ul: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('ul', props as React.Attributes, children),
            li: ({ children, ...props }: { children?: React.ReactNode, [key: string]: unknown }) => React.createElement('li', props as React.Attributes, children),
        },
        AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    };
});

// Mocks for browser APIs

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

// Mock Dexie DB to avoid ESM issues in Jest
jest.mock('../db', () => ({
    db: {
        bookings: {
            toArray: jest.fn().mockResolvedValue([]),
            filter: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
            add: jest.fn(),
            get: jest.fn(),
            put: jest.fn(),
            delete: jest.fn(),
        },
        properties: {
            get: jest.fn(),
            put: jest.fn(),
            clear: jest.fn(),
        },
        syncQueue: {
            add: jest.fn(),
            where: jest.fn(() => ({ equals: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })) })),
        },
    },
    addToSyncQueue: jest.fn(),
}));

// Mock Global Objects
Object.defineProperty(global, 'ResizeObserver', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
    })),
});

jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        error: jest.fn(),
        loading: jest.fn(),
        dismiss: jest.fn(),
    },
    toast: {
        success: jest.fn(),
        error: jest.fn(),
        loading: jest.fn(),
        dismiss: jest.fn(),
    }
}));
