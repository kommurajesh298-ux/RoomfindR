import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { bookingService } from '../services/booking.service';
import { showToast } from '../utils/toast';
import type { Booking } from '../types/booking.types';
import { resolveOwnerVerificationState } from '../utils/ownerVerification';

import { OwnerContext } from '../hooks/useOwner';

export const OwnerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { ownerData: authOwnerData, currentUser } = useAuth();
    const [pendingBookingsCount, setPendingBookingsCount] = useState<number>(0);

    // Derive values directly from auth context instead of syncing
    const ownerData = authOwnerData;
    const propertiesCount = authOwnerData?.propertiesCount || 0;
    const verificationState = resolveOwnerVerificationState(ownerData);
    const ownerActive = verificationState.ownerActive;
    const bankVerified = verificationState.bankVerified;
    const verificationStatus = ownerActive;

    // Show toast when bank verification changes to true
    const prevVerifiedRef = React.useRef(bankVerified);
    useEffect(() => {
        if (bankVerified && !prevVerifiedRef.current && currentUser) {
            showToast.success('Your bank account is verified. You can now create and publish properties.');
        }
        prevVerifiedRef.current = bankVerified;
    }, [bankVerified, currentUser]);

    // Listener for pending bookings
    useEffect(() => {
        if (!currentUser) return;

        const unsubscribe = bookingService.subscribeToPendingBookings(
            currentUser.uid,
            (bookings: Booking[]) => {
                const pending = bookings.length;
                setPendingBookingsCount(pending);
            }
        );

        return () => unsubscribe();
    }, [currentUser]);

    const value = useMemo(() => ({
        verificationStatus,
        ownerActive,
        bankVerified,
        propertiesCount,
        pendingBookingsCount,
        ownerData
    }), [verificationStatus, ownerActive, bankVerified, propertiesCount, pendingBookingsCount, ownerData]);

    return (
        <OwnerContext.Provider value={value}>
            {children}
        </OwnerContext.Provider>
    );
};
