jest.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => false,
    },
    registerPlugin: () => ({
        isLocationEnabled: jest.fn(),
        openLocationSettings: jest.fn(),
    }),
}));

jest.mock('@capacitor/geolocation', () => ({
    Geolocation: {
        checkPermissions: jest.fn(),
        requestPermissions: jest.fn(),
        getCurrentPosition: jest.fn(),
    },
}));

import { canonicalizeLocationLabel, createStaticLocation, locationService } from '../location.service';

describe('locationService', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        localStorage.clear();
        global.fetch = originalFetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('creates a stable static location from a saved profile city', () => {
        expect(createStaticLocation('Hyderabad', 'profile')).toEqual({
            lat: 17.385,
            lng: 78.4867,
            city: 'Hyderabad',
            displayName: 'Hyderabad',
            source: 'profile'
        });
    });

    it('canonicalizes legacy locality aliases before storing coordinates', () => {
        expect(canonicalizeLocationLabel('Madivala')).toBe('Madiwala');
        expect(createStaticLocation('Madivala', 'manual')).toEqual({
            lat: 12.9178,
            lng: 77.6199,
            city: 'Bengaluru',
            displayName: 'Madiwala',
            source: 'manual'
        });
    });

    it('prefers the nearer known locality when reverse geocode conflicts around BTM Layout', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                city: 'Bengaluru',
                locality: 'Bengaluru',
                postcode: '560029',
                localityInfo: {
                    administrative: [],
                    informative: [
                        { name: 'Madiwala' }
                    ]
                }
            })
        }) as unknown as typeof fetch;

        await expect(locationService.reverseGeocode(12.9166, 77.6101)).resolves.toBe('BTM Layout');
    });

    it('preserves the saved static city after live location is enabled', () => {
        const savedCity = createStaticLocation('Bengaluru', 'profile');
        expect(savedCity).not.toBeNull();

        locationService.setCachedLocation(savedCity!);
        locationService.setCachedLocation({
            lat: 12.974,
            lng: 77.6098,
            city: 'Bengaluru',
            displayName: 'MG Road',
            source: 'live'
        });

        expect(locationService.getCachedLocation()).toEqual({
            lat: 12.974,
            lng: 77.6098,
            city: 'Bengaluru',
            displayName: 'MG Road',
            source: 'live'
        });

        expect(locationService.getPreferredStaticLocation()).toEqual(savedCity);
    });

    it('migrates cached legacy locality labels to the canonical stored location', () => {
        localStorage.setItem('lastLocation', JSON.stringify({
            lat: 0,
            lng: 0,
            city: 'Bengaluru',
            displayName: 'Madivala',
            source: 'manual'
        }));

        expect(locationService.getCachedLocation()).toEqual({
            lat: 12.9178,
            lng: 77.6199,
            city: 'Bengaluru',
            displayName: 'Madiwala',
            source: 'manual'
        });

        expect(JSON.parse(localStorage.getItem('lastLocation') || 'null')).toEqual({
            lat: 12.9178,
            lng: 77.6199,
            city: 'Bengaluru',
            displayName: 'Madiwala',
            source: 'manual'
        });
    });
});
