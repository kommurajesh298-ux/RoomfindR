import { createContext, useContext } from 'react';
import type { AdminUser } from '../types/admin.types';

export interface AuthContextType {
    admin: AdminUser | null;
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
