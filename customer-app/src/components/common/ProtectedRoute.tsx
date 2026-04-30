import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { currentUser, loading, userData } = useAuth();
    const location = useLocation();

    // Never trap the native app behind an auth spinner. If we already have a
    // cached user, let the protected screen render while profile data catches up.
    if (currentUser) {
        if (userData && userData.role !== 'customer') {
            // If an owner or admin tries to access customer app, they might need to logout or be handled differently
            // For now, let's just allow it or redirect if strictly enforcing role
        }

        return <>{children}</>;
    }

    // If Android session restore is still loading without a cached user, fail open
    // to login instead of leaving the user on an indefinite full-screen loader.
    if (loading || !currentUser) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
