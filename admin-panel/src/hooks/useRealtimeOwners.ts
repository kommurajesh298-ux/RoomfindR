import { useState, useEffect } from 'react';
import { ownerService } from '../services/owner.service';
import type { Owner } from '../types/owner.types';

export const useRealtimeOwners = (status: 'pending' | 'verified' | 'rejected') => {
    const [owners, setOwners] = useState<Owner[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let isCancelled = false;
        ownerService.getAllOwners()
            .then((data) => {
                if (!isCancelled) {
                    setOwners(data as Owner[]);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!isCancelled) {
                    setError(err as Error);
                    setLoading(false);
                }
            });
        return () => { isCancelled = true; };
    }, [status]);

    return { owners, loading, error };
};
