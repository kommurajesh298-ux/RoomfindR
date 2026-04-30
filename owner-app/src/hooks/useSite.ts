import { createContext, useContext } from 'react';
import { type SiteSettings } from '../services/site.service';

export interface SiteContextType {
    settings: SiteSettings | null;
    loading: boolean;
}

export const SiteContext = createContext<SiteContextType | undefined>(undefined);

export const useSite = () => {
    const context = useContext(SiteContext);
    if (context === undefined) {
        throw new Error('useSite must be used within a SiteProvider');
    }
    return context;
};
