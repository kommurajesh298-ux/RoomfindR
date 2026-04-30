import { useState, useEffect } from 'react';

export const useRealtimeReports = () => {
    const [reportCount] = useState(0);

    // Placeholder - in production this would use Supabase realtime
    useEffect(() => {
        // No-op for now
    }, []);

    return { reportCount };
};
