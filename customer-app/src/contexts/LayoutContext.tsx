import React, { useState, type ReactNode } from 'react';
import {
    createStaticLocation,
    getLocationDisplayName,
    isLiveLocation,
    locationService,
    normalizeLocationCity,
    type LocationState
} from '../services/location.service';
import { LayoutContext } from '../hooks/useLayout';
import { useAuth } from '../hooks/useAuth';

const isSameLocation = (left: LocationState | null, right: LocationState | null) => {
    if (!left && !right) return true;
    if (!left || !right) return false;

    return left.city === right.city
        && left.displayName === right.displayName
        && left.lat === right.lat
        && left.lng === right.lng
        && left.source === right.source;
};

export const LayoutProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { currentUser, userData } = useAuth();
    const [showNavbarSearch, setShowNavbarSearch] = useState(true);
    const [isFilterPanelOpen, setFilterPanelOpen] = useState(false);
    const [isFiltered, setIsFiltered] = useState(false);
    const previousUserIdRef = React.useRef<string | null>(null);
    const [currentLocation, setCurrentLocation] = useState<LocationState | null>(() => {
        return locationService.getCachedLocation() || locationService.getPreferredStaticLocation();
    });

    const updateLocation = React.useCallback((location: LocationState) => {
        setCurrentLocation(location);
        locationService.setCachedLocation(location);
    }, []);

    React.useEffect(() => {
        const userId = currentUser?.id || null;
        const profileCity = userData?.location?.city?.trim();

        if (!userId) {
            previousUserIdRef.current = null;
            return;
        }

        if (!profileCity) {
            previousUserIdRef.current = userId;
            return;
        }

        const profileLocation = createStaticLocation(profileCity, 'profile');
        if (!profileLocation) {
            previousUserIdRef.current = userId;
            return;
        }

        const switchedUser = Boolean(previousUserIdRef.current && previousUserIdRef.current !== userId);
        const shouldUseProfileLocation = switchedUser
            || !currentLocation
            || currentLocation.source === 'profile'
            || !currentLocation.source;

        if (shouldUseProfileLocation && !isSameLocation(currentLocation, profileLocation)) {
            updateLocation(profileLocation);
        } else {
            const preferredStaticLocation = locationService.getPreferredStaticLocation();
            if (!preferredStaticLocation || preferredStaticLocation.source === 'profile') {
                locationService.setPreferredStaticLocation(profileLocation);
            }
        }

        previousUserIdRef.current = userId;
    }, [currentLocation, currentUser?.id, updateLocation, userData?.location?.city]);

    React.useEffect(() => {
        const enrichCachedLocationLabel = async () => {
            if (!currentLocation || !isLiveLocation(currentLocation)) return;

            const displayName = getLocationDisplayName(currentLocation);
            if (displayName && displayName !== currentLocation.city) return;

            try {
                const resolvedLabel = await locationService.reverseGeocode(currentLocation.lat, currentLocation.lng);
                const normalizedCity = normalizeLocationCity(resolvedLabel);
                if (!resolvedLabel || (resolvedLabel === displayName && normalizedCity === currentLocation.city)) {
                    return;
                }

                updateLocation({
                    ...currentLocation,
                    city: normalizedCity,
                    displayName: resolvedLabel
                });
            } catch (err) {
                void err;
            }
        };

        void enrichCachedLocationLabel();
    }, [currentLocation, updateLocation]);

    return (
        <LayoutContext.Provider value={{
            showNavbarSearch,
            setShowNavbarSearch,
            isFilterPanelOpen,
            setFilterPanelOpen,
            currentLocation,
            updateLocation,
            isFiltered,
            setIsFiltered
        }}>
            {children}
        </LayoutContext.Provider>
    );
};

