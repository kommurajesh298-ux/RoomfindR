import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../ProtectedRoute';

jest.mock('../../../hooks/useAuth', () => ({
    useAuth: jest.fn(),
}));

jest.mock('../../../hooks/useOwner', () => ({
    useOwner: jest.fn(),
}));

const { useAuth } = jest.requireMock('../../../hooks/useAuth') as {
    useAuth: jest.Mock;
};

const { useOwner } = jest.requireMock('../../../hooks/useOwner') as {
    useOwner: jest.Mock;
};

describe('ProtectedRoute', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders children for approved owners on /verification-status', async () => {
        useAuth.mockReturnValue({
            currentUser: { uid: 'owner-1' },
            userData: { role: 'owner' },
            ownerData: { id: 'owner-1', verified: true, verification_status: 'approved' },
            loading: false,
        });
        useOwner.mockReturnValue({
            verificationStatus: true,
            ownerActive: true,
            bankVerified: true,
            propertiesCount: 1,
            pendingBookingsCount: 0,
            ownerData: { id: 'owner-1', verified: true, verification_status: 'approved' },
        });

        render(
            <MemoryRouter initialEntries={['/verification-status']}>
                <Routes>
                    <Route
                        path="/verification-status"
                        element={(
                            <ProtectedRoute>
                                <div>Locked View</div>
                            </ProtectedRoute>
                        )}
                    />
                    <Route path="/dashboard" element={<div>Dashboard View</div>} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByText('Locked View')).toBeInTheDocument();
        expect(screen.queryByText('Dashboard View')).not.toBeInTheDocument();
    });

    it('redirects pending approval owners to verification status', async () => {
        useAuth.mockReturnValue({
            currentUser: { uid: 'owner-2' },
            userData: { role: 'owner' },
            ownerData: { id: 'owner-2', verified: false, verification_status: 'pending' },
            loading: false,
        });
        useOwner.mockReturnValue({
            verificationStatus: false,
            ownerActive: false,
            bankVerified: false,
            propertiesCount: 0,
            pendingBookingsCount: 0,
            ownerData: { id: 'owner-2', verified: false, verification_status: 'pending' },
        });

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <Routes>
                    <Route
                        path="/dashboard"
                        element={(
                            <ProtectedRoute>
                                <div>Dashboard View</div>
                            </ProtectedRoute>
                        )}
                    />
                    <Route path="/verification-status" element={<div>Verification Status View</div>} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByText('Verification Status View')).toBeInTheDocument();
        expect(screen.queryByText('Dashboard View')).not.toBeInTheDocument();
    });
});
