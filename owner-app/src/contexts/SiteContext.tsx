import React, { useEffect, useState } from 'react';
import { siteService, type SiteSettings } from '../services/site.service';
import LoadingOverlay from '../components/common/LoadingOverlay';
import { SiteContext } from '../hooks/useSite';

export const SiteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<SiteSettings | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = siteService.subscribeToSettings((data) => {
            setSettings(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) {
        return <LoadingOverlay message="Loading Configuration..." />;
    }

    if (settings?.maintenanceMode) {
        return (
            <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
                <div className="w-24 h-24 bg-orange-100 rounded-full flex items-center justify-center mb-6 text-orange-600 animate-pulse">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h1 className="text-3xl font-black text-gray-900 mb-2">Under Maintenance</h1>
                <p className="text-gray-500 max-w-md">
                    The platform is currently undergoing scheduled maintenance to improve our services.
                    Please check back soon.
                </p>
                <div className="mt-8 pt-8 border-t border-gray-100 w-full max-w-xs">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Estimated Time</p>
                    <p className="text-sm font-bold text-gray-900 mt-1">~30-60 Minutes</p>
                </div>
            </div>
        );
    }

    return (
        <SiteContext.Provider value={{ settings, loading }}>
            {children}
        </SiteContext.Provider>
    );
};
