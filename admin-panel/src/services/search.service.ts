import { supabase } from './supabase-config';

export interface SearchResult {
    id: string;
    type: 'user' | 'property' | 'booking' | 'navigation';
    title: string;
    subtitle: string;
    link: string;
    metadata?: Record<string, unknown>;
}

export const SearchService = {
    globalSearch: async (query: string): Promise<SearchResult[]> => {
        if (!query || query.length < 2) return [];

        const lowercaseQuery = query.toLowerCase();

        // 1. Search Accounts/Users
        const userPromise = supabase
            .from('accounts')
            .select('id, email, role')
            .or(`email.ilike.%${query}%`)
            .limit(3);

        // 2. Search Properties
        const propertyPromise = supabase
            .from('properties')
            .select('id, title, city')
            .or(`title.ilike.%${query}%,city.ilike.%${query}%`)
            .limit(3);

        // 3. Search Bookings
        const bookingPromise = supabase
            .from('bookings')
            .select('id, customer_name, status')
            .or(`customer_name.ilike.%${query}%,status.ilike.%${query}%`)
            .limit(3);

        try {
            const [users, properties, bookings] = await Promise.all([
                userPromise,
                propertyPromise,
                bookingPromise
            ]);

            const results: SearchResult[] = [];

            // Map Users
            users.data?.forEach(u => {
                results.push({
                    id: u.id,
                    type: 'user',
                    title: u.email || 'Unknown User',
                    subtitle: `Role: ${u.role}`,
                    link: `/owners` // Assuming owners page handles accounts or add a general users page if exists
                });
            });

            // Map Properties
            properties.data?.forEach(p => {
                results.push({
                    id: p.id,
                    type: 'property',
                    title: p.title,
                    subtitle: `Location: ${p.city}`,
                    link: `/properties`
                });
            });

            // Map Bookings
            bookings.data?.forEach(b => {
                results.push({
                    id: b.id,
                    type: 'booking',
                    title: `Booking: ${b.customer_name}`,
                    subtitle: `Status: ${b.status}`,
                    link: `/bookings`
                });
            });

            // Add Navigation shortcuts
            const navShortcuts: SearchResult[] = [
                { id: 'nav-dash', type: 'navigation', title: 'Go to Dashboard', subtitle: 'Platform overview', link: '/' },
                { id: 'nav-props', type: 'navigation', title: 'Manage Properties', subtitle: 'View all listings', link: '/properties' },
                { id: 'nav-rent', type: 'navigation', title: 'Rent Collections', subtitle: 'Monitor monthly rent payments', link: '/rent' },
                { id: 'nav-reports', type: 'navigation', title: 'Financial Reports', subtitle: 'Export data', link: '/reports' },
                { id: 'nav-chats', type: 'navigation', title: 'Messages & Chats', subtitle: 'Communication center', link: '/tickets' },
            ];

            const filteredNav = navShortcuts.filter(n => n.title.toLowerCase().includes(lowercaseQuery));
            results.push(...filteredNav);

            return results;
        } catch (_error) {
            console.error('Search error:', _error);
            return [];
        }
    }
};
