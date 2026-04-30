import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { NetworkContext } from '../hooks/useNetwork';

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            toast.success('Back online!', { id: 'network-status' });
            // Trigger Sync
            import('../services/sync.service').then(({ syncService }) => {
                syncService.startSync();
            });
        };

        const handleOffline = () => {
            setIsOnline(false);
            toast('You are offline. Data will sync when you reconnect.', {
                icon: '📡',
                id: 'network-status',
                duration: 5000
            });
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return (
        <NetworkContext.Provider value={{ isOnline }}>
            {children}
        </NetworkContext.Provider>
    );
};

