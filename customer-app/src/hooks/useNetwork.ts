import { createContext, useContext } from 'react';

interface NetworkContextType {
    isOnline: boolean;
}

export const NetworkContext = createContext<NetworkContextType>({ isOnline: true });

export const useNetwork = () => useContext(NetworkContext);
