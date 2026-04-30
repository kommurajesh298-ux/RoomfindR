import { createContext, useContext } from 'react';
import type { LocationState } from '../services/location.service';

export interface LayoutContextType {
    showNavbarSearch: boolean;
    setShowNavbarSearch: (show: boolean) => void;
    isFilterPanelOpen: boolean;
    setFilterPanelOpen: (open: boolean) => void;
    currentLocation: LocationState | null;
    updateLocation: (location: LocationState) => void;
    isFiltered: boolean;
    setIsFiltered: (filtered: boolean) => void;
}

export const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export const useLayout = () => {
    const context = useContext(LayoutContext);
    if (!context) {
        throw new Error('useLayout must be used within a LayoutProvider');
    }
    return context;
};
