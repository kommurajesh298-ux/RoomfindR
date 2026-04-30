import { supabase } from './supabase-config';
import type { Owner } from '../types/owner.types';

const mapOwner = (data: {
    id: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    verified?: boolean | null;
    avatar_url?: string | null;
}) => ({
    ownerId: data.id,
    name: data.name || 'Property Owner',
    phone: data.phone || '',
    email: data.email || '',
    profilePhotoUrl: data.avatar_url || undefined,
    verified: Boolean(data.verified),
} as Owner);

export const ownerService = {
    getOwnerById: async (ownerId: string): Promise<Owner | null> => {
        const { data, error } = await supabase
            .from('owners')
            .select('*')
            .eq('id', ownerId)
            .maybeSingle();

        if (error || !data) return null;
        return mapOwner(data);
    },
    getOwnersByIds: async (ownerIds: string[]): Promise<Record<string, Owner>> => {
        const uniqueIds = [...new Set(ownerIds.filter(Boolean))];
        if (uniqueIds.length === 0) {
            return {};
        }

        const { data, error } = await supabase
            .from('owners')
            .select('*')
            .in('id', uniqueIds);

        if (error) {
            throw error;
        }

        return (data || []).reduce<Record<string, Owner>>((accumulator, owner) => {
            accumulator[owner.id] = mapOwner(owner);
            return accumulator;
        }, {});
    },
    subscribeToOwner: (ownerId: string, callback: (owner: Owner) => void) => {
        ownerService.getOwnerById(ownerId).then(o => { if (o) callback(o); });
        const channel = supabase.channel(`owner-${ownerId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'owners', filter: `id=eq.${ownerId}` }, async () => {
            const o = await ownerService.getOwnerById(ownerId); if (o) callback(o);
        }).subscribe();
        return () => { supabase.removeChannel(channel); };
    }
};
