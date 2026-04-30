import { Geolocation } from '@capacitor/geolocation';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { BENGALURU_LOCALITIES } from '../data/bengaluru-locations';
import { HYDERABAD_LOCALITIES } from '../data/hyderabad-locations';
import { getPincodeLocation, PINCODE_MAP } from '../data/pincode-map';

const LOCATION_KEY = 'lastLocation';
const PREFERRED_STATIC_LOCATION_KEY = 'preferredStaticLocation';
const BENGALURU_LOCALITY_LOOKUP = new Set(BENGALURU_LOCALITIES.map((locality) => locality.toLowerCase()));
const HYDERABAD_LOCALITY_LOOKUP = new Set(HYDERABAD_LOCALITIES.map((locality) => locality.toLowerCase()));
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const KNOWN_LOCALITY_LOOKUP = new Map<string, string>([
    ...BENGALURU_LOCALITIES.map((locality) => [locality.toLowerCase(), locality] as const),
    ...HYDERABAD_LOCALITIES.map((locality) => [locality.toLowerCase(), locality] as const),
    ...Object.values(PINCODE_MAP).map((locality) => [locality.toLowerCase(), locality] as const),
]);
const CANONICAL_LOCATION_LABELS: Record<string, string> = {
    'btm': 'BTM Layout',
    'btm layout': 'BTM Layout',
    'hsr': 'HSR Layout',
    'hsr layout': 'HSR Layout',
    'j p nagar': 'JP Nagar',
    'jp nagar': 'JP Nagar',
    'kalyan nagar': 'Kalyan Nagar',
    'madivala': 'Madiwala',
    'madiwala': 'Madiwala',
    'mg road': 'MG Road',
};
const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
    Bengaluru: { lat: 12.9716, lng: 77.5946 },
    Hyderabad: { lat: 17.3850, lng: 78.4867 },
    Chennai: { lat: 13.0827, lng: 80.2707 },
    Mumbai: { lat: 19.0760, lng: 72.8777 },
    Pune: { lat: 18.5204, lng: 73.8567 },
    Delhi: { lat: 28.7041, lng: 77.1025 },
};
const LOCALITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
    'BTM Layout': { lat: 12.9166, lng: 77.6101 },
    Bommanahalli: { lat: 12.9089, lng: 77.6239 },
    'HSR Layout': { lat: 12.9121, lng: 77.6446 },
    Koramangala: { lat: 12.9352, lng: 77.6245 },
    Indiranagar: { lat: 12.9784, lng: 77.6408 },
    Madiwala: { lat: 12.9178, lng: 77.6199 },
    Marathahalli: { lat: 12.9592, lng: 77.6974 },
    Whitefield: { lat: 12.9698, lng: 77.7499 },
    Jayanagar: { lat: 12.9250, lng: 77.5938 },
    'JP Nagar': { lat: 12.9081, lng: 77.5850 },
};

export interface LocationState {
    lat: number;
    lng: number;
    city: string;
    displayName?: string;
    source?: 'profile' | 'manual' | 'live' | 'pincode';
}

type LocationErrorReason = 'insecure-origin' | 'permission-denied';
type LocationServiceError = Error & {
    code?: number;
    reason?: LocationErrorReason;
};

type LocationSettingsPlugin = {
    isLocationEnabled: () => Promise<{ enabled: boolean }>;
    openLocationSettings: () => Promise<void>;
};

const NativeLocationSettings = registerPlugin<LocationSettingsPlugin>('LocationSettings');

const createLocationError = (message: string, reason: LocationErrorReason, code?: number): LocationServiceError => {
    const error = new Error(message) as LocationServiceError;
    error.reason = reason;

    if (typeof code === 'number') {
        error.code = code;
    }

    return error;
};

const getLocationErrorMessage = (error: unknown): string => {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        return String((error as { message?: unknown }).message || '');
    }
    return String(error);
};

const getLocationErrorReason = (error: unknown): string => {
    if (typeof error === 'object' && error !== null && 'reason' in error) {
        return String((error as { reason?: unknown }).reason || '');
    }
    return '';
};

const getLocationErrorCode = (error: unknown): number | null => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = Number((error as { code?: unknown }).code);
        return Number.isFinite(code) ? code : null;
    }
    return null;
};

const normalizeLocalityCandidate = (value: string | null | undefined) => {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[().,]/g, '')
        .replace(/\s+/g, ' ');
};

const calculateDistanceKm = (
    leftLat: number,
    leftLng: number,
    rightLat: number,
    rightLng: number
) => {
    const earthRadiusKm = 6371;
    const dLat = (rightLat - leftLat) * Math.PI / 180;
    const dLng = (rightLng - leftLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(leftLat * Math.PI / 180) * Math.cos(rightLat * Math.PI / 180)
        * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

export const canonicalizeLocationLabel = (value: string | null | undefined): string => {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';

    const normalized = normalizeLocalityCandidate(rawValue);
    return CANONICAL_LOCATION_LABELS[normalized] || KNOWN_LOCALITY_LOOKUP.get(normalized) || rawValue;
};

const getNearestKnownLocality = (lat: number, lng: number, maxDistanceKm = 1.8): string | null => {
    let bestMatch: { locality: string; distanceKm: number } | null = null;

    for (const [locality, coords] of Object.entries(LOCALITY_COORDINATES)) {
        const distanceKm = calculateDistanceKm(lat, lng, coords.lat, coords.lng);
        if (distanceKm > maxDistanceKm) continue;

        if (!bestMatch || distanceKm < bestMatch.distanceKm) {
            bestMatch = { locality, distanceKm };
        }
    }

    return bestMatch?.locality || null;
};

const findKnownLocalityMatch = (...candidates: Array<string | null | undefined>) => {
    for (const candidate of candidates) {
        const normalized = normalizeLocalityCandidate(candidate);
        if (!normalized) continue;

        const directMatch = KNOWN_LOCALITY_LOOKUP.get(normalized);
        if (directMatch) {
            return canonicalizeLocationLabel(directMatch);
        }

        if (normalized.includes('btm')) return 'BTM Layout';
        if (normalized.includes('hsr')) return 'HSR Layout';
        if (normalized.includes('koramangala')) return 'Koramangala';
        if (normalized.includes('madiwala') || normalized.includes('madivala')) return 'Madiwala';
        if (normalized.includes('bommanahalli')) return 'Bommanahalli';
    }

    return null;
};

const isSecureWebGeolocationContext = (): boolean => {
    if (typeof window === 'undefined') return true;
    return window.isSecureContext || LOCALHOST_HOSTNAMES.has(window.location.hostname);
};

export const isLocationInsecureOriginError = (error: unknown): boolean => {
    if (getLocationErrorReason(error) === 'insecure-origin') return true;

    const message = getLocationErrorMessage(error).toLowerCase();
    return message.includes('only secure origins are allowed')
        || message.includes('secure (https) connection');
};

export const isLocationPermissionDeniedError = (error: unknown): boolean => {
    if (getLocationErrorReason(error) === 'permission-denied') return true;

    const message = getLocationErrorMessage(error).toLowerCase();
    const code = getLocationErrorCode(error);
    return !isLocationInsecureOriginError(error) && (
        code === 1
        || message.includes('permission denied')
        || message.includes('location permission denied')
    );
};

export const isLocationServicesDisabledError = (error: unknown): boolean => {
    if (isLocationInsecureOriginError(error) || isLocationPermissionDeniedError(error)) {
        return false;
    }

    const message = getLocationErrorMessage(error).toLowerCase();
    const code = getLocationErrorCode(error);
    return code === 2
        || message.includes('location disabled')
        || message.includes('gps')
        || message.includes('network provider')
        || message.includes('timed out')
        || message.includes('timeout expired')
        || message.includes('unable to obtain location');
};

export const normalizeLocationCity = (value: string | null | undefined): string => {
    const rawValue = String(value || '').trim();
    if (!rawValue) return 'Bengaluru';

    const lowerValue = rawValue.toLowerCase();

    if (lowerValue === 'bangalore' || lowerValue === 'bengaluru' || BENGALURU_LOCALITY_LOOKUP.has(lowerValue) || lowerValue.includes('btm')) {
        return 'Bengaluru';
    }

    if (lowerValue === 'hyderabad' || HYDERABAD_LOCALITY_LOOKUP.has(lowerValue)) {
        return 'Hyderabad';
    }

    if (lowerValue === 'delhi') return 'Delhi';
    if (lowerValue === 'mumbai') return 'Mumbai';
    if (lowerValue === 'pune') return 'Pune';
    if (lowerValue === 'chennai') return 'Chennai';

    return rawValue;
};

export const getLocationDisplayName = (location: Pick<LocationState, 'city' | 'displayName'> | null | undefined): string => {
    if (!location) return 'Select Location';
    return String(location.displayName || location.city || 'Select Location');
};

export const isLiveLocation = (location: Pick<LocationState, 'source'> | null | undefined): boolean => {
    return location?.source === 'live';
};

const normalizeStoredLocation = (location: LocationState | null | undefined): LocationState | null => {
    if (!location) return null;

    const rawLabel = String(location.displayName || location.city || '').trim();
    if (!rawLabel) return null;

    const canonicalLabel = canonicalizeLocationLabel(rawLabel);
    const normalizedCity = normalizeLocationCity(location.city || canonicalLabel || rawLabel);
    const fallbackCoords = LOCALITY_COORDINATES[canonicalLabel] || LOCALITY_COORDINATES[rawLabel] || CITY_COORDINATES[normalizedCity] || CITY_COORDINATES.Bengaluru;

    return {
        lat: Number.isFinite(location.lat) && location.lat !== 0 ? location.lat : fallbackCoords.lat,
        lng: Number.isFinite(location.lng) && location.lng !== 0 ? location.lng : fallbackCoords.lng,
        city: normalizedCity,
        displayName: canonicalLabel || location.displayName || rawLabel,
        source: location.source || 'profile'
    };
};

const readNormalizedStoredLocation = (storageKey: string): LocationState | null => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;

    const normalizedLocation = normalizeStoredLocation(JSON.parse(stored) as LocationState);
    if (!normalizedLocation) return null;

    const normalizedSerialized = JSON.stringify(normalizedLocation);
    if (normalizedSerialized !== stored) {
        localStorage.setItem(storageKey, normalizedSerialized);
    }

    return normalizedLocation;
};

export const createStaticLocation = (
    value: string | null | undefined,
    source: 'profile' | 'manual' | 'pincode' = 'manual'
): LocationState | null => {
    const label = String(value || '').trim();
    if (!label) return null;

    const canonicalLabel = canonicalizeLocationLabel(label);
    const city = normalizeLocationCity(canonicalLabel || label);
    const coords = LOCALITY_COORDINATES[canonicalLabel] || LOCALITY_COORDINATES[label] || CITY_COORDINATES[city] || CITY_COORDINATES.Bengaluru;

    return {
        lat: coords.lat,
        lng: coords.lng,
        city,
        displayName: canonicalLabel || label,
        source
    };
};

export const locationService = {
    isLocationEnabled: async (): Promise<boolean> => {
        if (!Capacitor.isNativePlatform()) {
            return true;
        }

        try {
            const result = await NativeLocationSettings.isLocationEnabled();
            return Boolean(result.enabled);
        } catch (error) {
            console.error('Error checking device location services:', error);
            return true;
        }
    },

    openLocationSettings: async (): Promise<void> => {
        if (!Capacitor.isNativePlatform()) return;

        try {
            await NativeLocationSettings.openLocationSettings();
            return;
        } catch (error) {
            console.error('Error opening native location settings:', error);
        }
    },

    getCurrentLocation: async (): Promise<LocationState> => {
        try {
            if (!Capacitor.isNativePlatform() && !isSecureWebGeolocationContext()) {
                throw createLocationError(
                    'Location access requires a secure (HTTPS) connection.',
                    'insecure-origin'
                );
            }

            // Check & Request permissions (Only for Native Platforms - Android/iOS)
            // Browsers handle this automatically via getCurrentPosition
            if (Capacitor.isNativePlatform()) {
                const permission = await Geolocation.checkPermissions();
                if (permission.location !== 'granted') {
                    const requested = await Geolocation.requestPermissions();
                    if (requested.location !== 'granted') {
                        throw createLocationError('Location permission denied', 'permission-denied', 1);
                    }
                }

                const locationEnabled = await locationService.isLocationEnabled();
                if (!locationEnabled) {
                    const disabledError = new Error('Device location is turned off');
                    (disabledError as LocationServiceError).code = 2;
                    throw disabledError;
                }
            }

            let position;
            try {
                // Try high accuracy first
                position = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 15000, // Increased to 15s
                    maximumAge: 3000
                });
            } catch (highAccError) {
                if (isLocationInsecureOriginError(highAccError) || isLocationPermissionDeniedError(highAccError)) {
                    throw highAccError;
                }
                // Fallback to low accuracy
                position = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: false,
                    timeout: 20000, // Increased to 20s
                    maximumAge: 10000
                });
            }

            const { latitude, longitude } = position.coords;
            const locationLabel = await locationService.reverseGeocode(latitude, longitude);

            return {
                lat: latitude,
                lng: longitude,
                city: normalizeLocationCity(locationLabel),
                displayName: locationLabel,
                source: 'live'
            };

        } catch (error) {
            if (!isLocationInsecureOriginError(error) && !isLocationPermissionDeniedError(error)) {
                console.error('Error getting location:', error);
            }
            throw error;
        }
    },

    getCachedLocation: (): LocationState | null => {
        try {
            return readNormalizedStoredLocation(LOCATION_KEY);
        } catch (e) {
            console.error('Error reading location from storage', e);
            return null;
        }
    },

    getPreferredStaticLocation: (): LocationState | null => {
        try {
            const preferredStaticLocation = readNormalizedStoredLocation(PREFERRED_STATIC_LOCATION_KEY);
            if (preferredStaticLocation) {
                return preferredStaticLocation;
            }

            const current = locationService.getCachedLocation();
            return current && !isLiveLocation(current) ? current : null;
        } catch (e) {
            console.error('Error reading preferred static location from storage', e);
            return null;
        }
    },

    setCachedLocation: (location: LocationState) => {
        try {
            const normalizedLocation = normalizeStoredLocation(location);
            if (!normalizedLocation) return;

            localStorage.setItem(LOCATION_KEY, JSON.stringify(normalizedLocation));
            if (!isLiveLocation(normalizedLocation)) {
                localStorage.setItem(PREFERRED_STATIC_LOCATION_KEY, JSON.stringify(normalizedLocation));
            }
        } catch (e) {
            console.error('Error saving location to storage', e);
        }
    },

    setPreferredStaticLocation: (location: LocationState) => {
        try {
            const normalizedLocation = normalizeStoredLocation(location);
            if (!normalizedLocation || isLiveLocation(normalizedLocation)) return;

            localStorage.setItem(PREFERRED_STATIC_LOCATION_KEY, JSON.stringify(normalizedLocation));
        } catch (e) {
            console.error('Error saving preferred static location to storage', e);
        }
    },

    reverseGeocode: async (lat: number, lng: number): Promise<string> => {
        try {
            // Using BDC API
            const response = await fetch(
                `https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
            );

            if (!response.ok) throw new Error(`Geocoding API error: ${response.status}`);

            const data = await response.json();

            // 1. Gather all administrative and informative levels
            const allLevels = [
                ...(data.localityInfo?.administrative || []),
                ...(data.localityInfo?.informative || [])
            ];

            const exactLocalityMatch = findKnownLocalityMatch(
                data.locality,
                data.localityInfo?.principalSubdivision,
                data.city,
                ...allLevels.map((level: { name?: string }) => level?.name)
            );
            const nearestKnownLocality = getNearestKnownLocality(lat, lng);
            const postcodeLocation = getPincodeLocation(String(data.postcode || '').trim());

            if (
                exactLocalityMatch
                && nearestKnownLocality
                && exactLocalityMatch !== nearestKnownLocality
                && postcodeLocation?.locality === nearestKnownLocality
            ) {
                return nearestKnownLocality;
            }

            if (exactLocalityMatch && exactLocalityMatch.toLowerCase() !== String(data.city || '').trim().toLowerCase()) {
                return exactLocalityMatch;
            }

            // 2. Look for keywords in ANY level (Neighborhood/Area)
            // We search from specific to broad
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const preciseArea = allLevels.find((a: any) =>
                (a.name as string).includes('Layout') ||
                a.name.includes('Nagar') ||
                a.name.includes('Stage') ||
                a.name.includes('Sector') ||
                a.name.includes('Colony') ||
                a.name.includes('BTM')
            );

            if (preciseArea) {
                return canonicalizeLocationLabel(preciseArea.name);
            }

            // 3. Coordinate fallback for localities the reverse-geocode API flattens to a nearby area.
            if (nearestKnownLocality) {
                return nearestKnownLocality;
            }

            // 4. Postcode fallback for localities the reverse-geocode API flattens to the city.
            if (postcodeLocation?.locality) {
                return postcodeLocation.locality;
            }

            // 5. Fallback to locality if distinct from city
            if (data.locality && data.locality !== data.city && !data.locality.includes('Karnataka')) {
                return canonicalizeLocationLabel(data.locality);
            }

            // 6. City Fallback
            if (data.city && !data.city.includes('Karnataka')) {
                return canonicalizeLocationLabel(data.city);
            }

            // 7. Ultimate Fallback (Try to avoid State names if possible)
            return canonicalizeLocationLabel(data.locality || data.city || 'Bengaluru');
        } catch (error) {
            console.error('[LocationService] Geocoding failed:', error);
            return 'Bengaluru';
        }
    },

    searchLocation: async (query: string): Promise<string[]> => {
        const cities = ['Bengaluru', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi'];
        return cities.filter(city => city.toLowerCase().includes(query.toLowerCase()));
    }
};
