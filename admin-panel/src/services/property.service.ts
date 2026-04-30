import { supabase } from './supabase-config';

export interface Property {
    id: string;
    title: string;
    owner_id: string;
    city: string;
    monthly_rent: number;
    status: string;
    rooms_available: number;
    created_at: string;
    images?: string[];
    verified?: boolean;
    published?: boolean;
    price?: number;
    address?: {
        street: string;
        city: string;
        state: string;
        zipcode: string;
    };
}

export const propertyService = {
    getProperties: async () => {
        const { data, error } = await supabase
            .from('properties')
            .select('id, title, owner_id, city, monthly_rent, status, rooms_available, created_at, images, address, owners(id, name, email)')
            .order('created_at', { ascending: false });
        if (error) throw error;

        // Map status to published boolean for UI compatibility
        return data.map(p => ({
            ...p,
            price: Number(p.monthly_rent ?? 0),
            monthly_rent: Number(p.monthly_rent ?? 0),
            published: p.status === 'published',
            verified: p.status === 'published' || p.status === 'approved'
        }));
    },
    verifyProperty: async (id: string, status: 'published' | 'draft' | 'archived') => {
        const { error } = await supabase.from('properties').update({ status }).eq('id', id);
        if (error) throw error;
    },
    deleteProperty: async (id: string) => {
        await supabase.from('properties').delete().eq('id', id);
    },
    getPropertyReports: async (propertyId: string) => {
        const { data, error } = await supabase.from('reports').select('*').eq('property_id', propertyId).order('created_at', { ascending: false });
        const missingReportsTable =
            !!error &&
            (
                error.code === 'PGRST205'
                || /relation .*reports.* does not exist/i.test(error.message || '')
                || /Could not find the table .*reports/i.test(error.message || '')
            );

        if (missingReportsTable) {
            return [];
        }

        if (error) throw error;
        return data;
    },
    suspendProperty: async (id: string) => {
        const { error } = await supabase.from('properties').update({ status: 'archived' }).eq('id', id);
        if (error) throw error;
    },
    requireChanges: async (id: string, reason: string) => {
        const notePayload = { status: 'draft', admin_review_notes: reason };
        const { error } = await supabase.from('properties').update(notePayload).eq('id', id);
        const missingNotesColumn =
            !!error &&
            (
                error.code === 'PGRST204'
                || /admin_review_notes/i.test(error.message || '')
            );
        if (missingNotesColumn) {
            const fallback = await supabase.from('properties').update({ status: 'draft' }).eq('id', id);
            if (fallback.error) throw fallback.error;
            return;
        }
        if (error) throw error;
    }
};
