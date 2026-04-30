import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import LoadingOverlay from './LoadingOverlay';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { admin, loading, error } = useAuth();
    const location = useLocation();

    if (loading) {
        return <LoadingOverlay message="Verifying admin access..." />;
    }

    if (!admin) {
        // If there's an error (e.g., non-admin user), redirect to login with state
        return <Navigate to="/login" state={{ from: location, error }} replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
