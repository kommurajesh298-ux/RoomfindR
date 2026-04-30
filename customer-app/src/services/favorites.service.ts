import { supabase } from './supabase-config';

export const favoritesService = {
    getFavorites: async (userId: string): Promise<string[]> => {
        const { data, error } = await supabase
            .from('favorites')
            .select('property_id')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data.map((favorite) => favorite.property_id);
    },

    toggleFavorite: async (userId: string, propertyId: string): Promise<boolean> => {
        const { data: existing } = await supabase
            .from('favorites')
            .select('id')
            .eq('user_id', userId)
            .eq('property_id', propertyId)
            .maybeSingle();

        if (existing) {
            const { error } = await supabase
                .from('favorites')
                .delete()
                .eq('user_id', userId)
                .eq('property_id', propertyId);

            if (error) throw error;
            return false;
        }

        const { error } = await supabase
            .from('favorites')
            .insert({ user_id: userId, property_id: propertyId });

        if (error) throw error;
        return true;
    },
};
