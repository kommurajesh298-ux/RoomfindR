import React from 'react';
import { useNetwork } from '../../hooks/useNetwork';
import { IoCloudOffline } from 'react-icons/io5';

const OfflineBanner: React.FC = () => {
    const { isOnline } = useNetwork();

    if (isOnline) return null;

    return (
        <div className="bg-gray-900/95 backdrop-blur-md text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest fixed top-0 left-0 right-0 z-[100] animate-in slide-in-from-top duration-300">
            <IoCloudOffline className="text-red-400" size={16} />
            <span>Offline Mode Enabled • Changes saved locally</span>
        </div>
    );
};

export default OfflineBanner;
