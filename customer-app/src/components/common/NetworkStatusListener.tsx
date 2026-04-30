import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const NetworkStatusListener: React.FC = () => {
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return (
        <AnimatePresence>
            {isOffline && (
                <motion.div
                    initial={{ y: -100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -100, opacity: 0 }}
                    className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white py-2 px-4 flex items-center justify-center gap-2 shadow-lg"
                >
                    <WifiOff size={16} className="animate-pulse" />
                    <span className="text-xs font-black uppercase tracking-widest">
                        You are offline. Checking your connection...
                    </span>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default NetworkStatusListener;
