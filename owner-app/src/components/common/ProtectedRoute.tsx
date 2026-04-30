import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useOwner } from '../../hooks/useOwner';
import LoadingOverlay from './LoadingOverlay';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { currentUser, userData, ownerData, loading } = useAuth();
    const { verificationStatus } = useOwner();
    const location = useLocation();
    const isPendingApprovalOwner =
        !!currentUser &&
        !verificationStatus &&
        (userData?.role === 'owner' || !!ownerData);

    if (loading) {
        return <LoadingOverlay message="Authenticating..." />;
    }

    if (!currentUser) {
        // Redirect to login but save the attempted location
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // Check if user is an owner or admin
    if (userData && userData.role !== 'owner' && userData.role !== 'admin') {
        console.error("Access denied: User is not an owner or admin");
        return <Navigate to="/login" replace />;
    }

    if (isPendingApprovalOwner && location.pathname !== '/verification-status') {
        return <Navigate to="/verification-status" replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
