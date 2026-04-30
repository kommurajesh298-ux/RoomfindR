import React, { useEffect, useRef, useState } from 'react';
import {
  canonicalizeLocationLabel,
  createStaticLocation,
  isLocationInsecureOriginError,
  isLocationPermissionDeniedError,
  isLocationServicesDisabledError,
  locationService,
} from '../../services/location.service';
import type { LocationState } from '../../services/location.service';
import { BENGALURU_LOCALITIES } from '../../data/bengaluru-locations';
import { HYDERABAD_LOCALITIES } from '../../data/hyderabad-locations';
import { useLayout } from '../../hooks/useLayout';
import { addNativeResumeListener } from '../../services/native-bridge.service';

interface LocationModalProps {
  onSelectLocation: (location: LocationState) => void;
  onClose: () => void;
}

const MAJOR_CITIES = ['Bengaluru', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi'];

const ALL_LOCALITIES = Array.from(
  new Set([
    ...BENGALURU_LOCALITIES,
    ...HYDERABAD_LOCALITIES,
  ].map((locality) => canonicalizeLocationLabel(locality)).filter(Boolean)),
).sort();

export const LocationModal: React.FC<LocationModalProps> = ({ onClose, onSelectLocation }) => {
  const { currentLocation: globalLocation } = useLayout();
  const selectedLocationLabel = globalLocation?.displayName || globalLocation?.city || '';
  const [loading, setLoading] = useState(false);
  const [openingLocationSettings, setOpeningLocationSettings] = useState(false);
  const [showLocationSettingsAction, setShowLocationSettingsAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const resumeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      resumeCleanupRef.current?.();
      resumeCleanupRef.current = null;
    };
  }, []);

  const detectCurrentLocation = async () => {
    setLoading(true);
    setError(null);
    setShowLocationSettingsAction(false);

    try {
      const location = await locationService.getCurrentLocation();
      onSelectLocation(location);
    } catch (err) {
      console.error('Location detection failed:', err);

      if (isLocationPermissionDeniedError(err)) {
        setError('Location permission denied. Please allow location access for RoomFindR.');
        setShowLocationSettingsAction(true);
      } else if (isLocationServicesDisabledError(err)) {
        setError('Location is turned off. Tap below to turn on GPS/location services.');
        setShowLocationSettingsAction(true);
      } else if (isLocationInsecureOriginError(err)) {
        setError('Location access requires a secure (HTTPS) connection.');
      } else {
        setError('Unable to detect location. Please turn on location and try again.');
        setShowLocationSettingsAction(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    await detectCurrentLocation();
  };

  const handleOpenLocationSettings = async () => {
    setOpeningLocationSettings(true);
    setError(null);

    resumeCleanupRef.current?.();
    resumeCleanupRef.current = addNativeResumeListener(() => {
      resumeCleanupRef.current?.();
      resumeCleanupRef.current = null;
      void detectCurrentLocation();
    });

    try {
      await locationService.openLocationSettings();
    } finally {
      setOpeningLocationSettings(false);
    }
  };

  const handleSelectCity = (cityName: string) => {
    const location = createStaticLocation(cityName, 'manual');
    if (!location) return;

    onSelectLocation(location);
  };

  const matchingLocalities = ALL_LOCALITIES.filter((locality) =>
    locality.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="
          max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-[32px] border-t border-gray-100 bg-white shadow-2xl
          animate-in slide-in-from-bottom duration-300 sm:max-h-[90vh] sm:rounded-3xl sm:border sm:zoom-in
        "
      >
        <div className="mx-auto mt-3 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-gray-200 sm:hidden" />

        <div className="px-6 pt-4 pb-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-black tracking-tight text-gray-900">Select Location</h2>
            <button
              onClick={onClose}
              className="rounded-full bg-gray-100 p-2 text-gray-500 transition-all hover:text-gray-700 active:scale-90"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="group relative mb-2">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg className="h-5 w-5 text-gray-400 transition-colors group-focus-within:text-[var(--rf-color-primary-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              id="location-search"
              name="locationSearch"
              aria-label="Search city"
              type="text"
              className="block w-full rounded-2xl border border-gray-100 bg-gray-50 py-3.5 pr-4 pl-12 font-medium placeholder-gray-400 transition-all focus:border-[var(--rf-color-primary-green)] focus:ring-0"
              placeholder="Search for your area or city"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto px-6 pb-10">
          <div className="space-y-4 pt-2">
            <button
              onClick={handleUseCurrentLocation}
              disabled={loading || openingLocationSettings}
              className="
                w-full rounded-2xl border border-[#DBEAFE] bg-[#EFF6FF] p-4 text-[#166534]
                transition-all hover:bg-[#DBEAFE] active:scale-[0.98] disabled:opacity-70
              "
            >
              <div className="flex items-center gap-4">
                {loading ? (
                  <div className="h-6 w-6 rounded-full border-[3px] border-[var(--rf-color-primary-green-dark)] border-t-transparent animate-spin" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                )}
                <div className="text-left">
                  <p className="text-lg font-black">Use Current Location</p>
                  <p className="text-xs font-bold text-[var(--rf-color-primary-green-dark)] opacity-80">Enable GPS</p>
                </div>
              </div>
            </button>

            {error && (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-3">
                <p className="text-sm font-bold text-red-500">{error}</p>
                {showLocationSettingsAction && (
                  <button
                    type="button"
                    onClick={handleOpenLocationSettings}
                    disabled={openingLocationSettings || loading}
                    className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-[var(--rf-color-primary-green)] px-4 text-sm font-black uppercase tracking-wide text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {openingLocationSettings ? 'Opening Settings...' : 'Turn On Location'}
                  </button>
                )}
              </div>
            )}

            <div className="mt-4">
              {!searchQuery && (
                <>
                  <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-gray-400">Major Cities</h3>
                  <div className="mb-8 grid grid-cols-2 gap-3">
                    {MAJOR_CITIES.map((city) => {
                      const isSelected = globalLocation?.city === city || selectedLocationLabel === city;
                      return (
                        <button
                          key={city}
                          onClick={() => handleSelectCity(city)}
                          className={`px-4 py-3 text-left text-sm font-bold rounded-2xl transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-[var(--rf-color-primary-green)] text-white shadow-lg shadow-[rgba(59,130,246,0.25)]'
                              : 'border border-gray-100 bg-white text-gray-700 hover:border-[#DBEAFE] hover:text-[var(--rf-color-primary-green-dark)]'
                          }`}
                        >
                          {city}
                          {isSelected && (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-gray-400">
                {searchQuery ? 'Search Results' : 'Popular Localities'}
              </h3>
              <div className="grid grid-cols-2 gap-3 pb-6">
                {matchingLocalities.slice(0, searchQuery ? 100 : 21).map((city) => {
                  const isSelected = selectedLocationLabel === city;
                  return (
                    <button
                      key={city}
                      onClick={() => handleSelectCity(city)}
                      className={`truncate rounded-2xl px-4 py-3 text-left text-sm font-bold transition-all ${
                        isSelected
                          ? 'bg-[var(--rf-color-primary-green)] text-white shadow-lg shadow-[rgba(59,130,246,0.25)]'
                          : 'border border-transparent bg-gray-50 text-gray-700 hover:border-[#DBEAFE] hover:bg-white hover:text-[var(--rf-color-primary-green-dark)] hover:shadow-lg'
                      }`}
                      title={city}
                    >
                      {city}
                    </button>
                  );
                })}
                {matchingLocalities.length === 0 && (
                  <div className="col-span-2 py-8 text-center font-medium italic text-gray-400">
                    No locations found
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
