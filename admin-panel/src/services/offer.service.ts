import { supabase } from './supabase-config';

export const offerService = {
    getAllOffers: async () => {
        const { data, error } = await supabase.from('offers').select('*').order('created_at', { ascending: false });
        if (error) throw error; return data;
    },
    createOffer: async (offer: Record<string, unknown>) => {
        await supabase.from('offers').insert(offer);
    },
    deleteOffer: async (id: string) => {
        await supabase.from('offers').delete().eq('id', id);
    },
    subscribeToOffers: (callback: (offers: unknown[]) => void) => {
        const fetch = async () => {
            const { data } = await supabase.from('offers').select('*').order('created_at', { ascending: false });
            if (data) callback(data);
        };
        fetch();
        const channel = supabase.channel('offers-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, fetch).subscribe();
        return () => { supabase.removeChannel(channel); };
    },
    toggleStatus: async (id: string, isActive: boolean) => {
        const { error } = await supabase.from('offers').update({ is_active: isActive }).eq('id', id);
        if (error) throw error;
    }
};
