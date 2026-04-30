import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserData } from '../services/user.service';

export interface AuthContextType {
    currentUser: User | null;
    userData: UserData | null;
    loading: boolean;
    profileResolved: boolean;
    error: string | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
