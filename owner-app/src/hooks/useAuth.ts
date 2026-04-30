import { createContext, useContext } from 'react';
import { type User } from '@supabase/supabase-js';
import type { UserData } from '../types/user.types';
import type { Owner } from '../types/owner.types';

export interface ShimmedUser extends User {
    uid: string;
    displayName: string | null;
    phoneNumber: string | null;
    photoURL: string | null;
    emailVerified: boolean;
}

export interface AuthContextType {
    currentUser: ShimmedUser | null;
    userData: UserData | null;
    ownerData: Owner | null;
    loading: boolean;
    error: string | null;
    signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
