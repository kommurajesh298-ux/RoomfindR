import { createContext, useContext } from 'react';
import type { Owner } from '../types/owner.types';

export interface OwnerContextType {
    verificationStatus: boolean;
    ownerActive: boolean;
    bankVerified: boolean;
    propertiesCount: number;
    pendingBookingsCount: number;
    ownerData: Owner | null;
}

export const OwnerContext = createContext<OwnerContextType | undefined>(undefined);

export const useOwner = () => {
    const context = useContext(OwnerContext);
    if (context === undefined) {
        throw new Error('useOwner must be used within an OwnerProvider');
    }
    return context;
};
