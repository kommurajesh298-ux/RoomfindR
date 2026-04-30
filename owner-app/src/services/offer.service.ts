import { supabase } from './supabase-config';

export const offerService = {
    createOffer: async (offerData: unknown) => {
        const data = offerData as Record<string, unknown>;
        await supabase.from('offers').insert({
            code: data['code'], discount_type: data['type'], discount_value: data['value'],
            valid_until: data['expiry'], is_active: true
        });
    },
    getOffers: async () => {
        const { data, error } = await supabase.from('offers').select('*').order('created_at', { ascending: false });
        if (error) throw error; return data;
    }
};
