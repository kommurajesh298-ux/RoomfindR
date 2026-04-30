/// <reference types="jest" />
/* eslint-disable react-refresh/only-export-components */

import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { type User } from '@supabase/supabase-js';
import { type UserData } from '../services/user.service';

// Mock Supabase User
const mockFirebaseUser: User = {
    id: 'test-user-id',
    email: 'test@example.com',
    phone: '+919876543210',
    user_metadata: {
        full_name: 'Test User'
    },
    app_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString()
} as unknown as User;

// Mock UserData
const mockUserData: UserData = {
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    phone: '+919876543210',
    role: 'customer',
    location: { city: 'Bangalore' },
    status: 'active',
    emailVerified: true,
    phoneVerified: true,
    createdAt: new Date().toISOString(),
};

// Mock AuthContext value
const mockAuthContextValue = {
    currentUser: mockFirebaseUser,
    userData: mockUserData,
    loading: false,
    error: null,
};

// Mock the shared auth hook
jest.mock('../hooks/useAuth', () => ({
    useAuth: () => mockAuthContextValue,
}));

// Mock services to prevent actual Firebase calls
jest.mock('../services/auth.service', () => ({
    authService: {
        onAuthChange: jest.fn(),
        subscribeToAccountRole: jest.fn(),
        signOut: jest.fn(),
    },
}));

jest.mock('../services/user.service', () => ({
    userService: {
        subscribeToUserDocument: jest.fn(),
    },
}));

// Mock the shared layout hook
const mockLayoutContextValue = {
    showNavbarSearch: true,
    setShowNavbarSearch: jest.fn(),
    isFilterPanelOpen: false,
    setFilterPanelOpen: jest.fn(),
    currentLocation: {
        city: 'Bangalore',
        lat: 12.9716,
        lng: 77.5946,
        state: 'Karnataka',
        country: 'India',
        formattedAddress: 'Bangalore, Karnataka, India'
    },
    updateLocation: jest.fn(),
};

jest.mock('../hooks/useLayout', () => ({
    useLayout: () => mockLayoutContextValue,
}));

// Create a custom render function that wraps with BrowserRouter
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
    initialRoute?: string;
}

function customRender(
    ui: ReactElement,
    { initialRoute = '/', ...renderOptions }: CustomRenderOptions = {}
) {
    // Set initial route if needed
    if (initialRoute !== '/') {
        window.history.pushState({}, 'Test page', initialRoute);
    }

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
        return (
            <BrowserRouter>
                {children}
            </BrowserRouter>
        );
    };

    return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// Re-export everything
export * from '@testing-library/react';
export * from '@testing-library/dom';
export { customRender as render, mockFirebaseUser, mockUserData, mockAuthContextValue, mockLayoutContextValue };
