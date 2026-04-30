import { supabase } from './supabase-config';
import { pushService } from './push.service';
import type { UserData } from '../types/user.types';
import { deferRealtimeSubscription } from './realtime-subscription';

type OwnerUserRow = {
    id: string;
    name: string;
    email: string;
    phone: string;
    created_at: string;
    verified?: boolean | null;
};

const mapOwnerRowToUserData = (row: OwnerUserRow): UserData => ({
    uid: row.id,
    role: 'owner',
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    emailVerified: false,
    phoneVerified: false,
    verified: row.verified ?? undefined,
});

export const userService = {
    createUserDocument: async (uid: string) => {
        // Call the secure repair RPC to ensure all tables (accounts, owners, etc) are synchronized
        const { data, error } = await supabase.rpc('repair_my_profile');
        if (error) {
            console.error("Profile repair failed:", error);
            // Fallback: Manually try to fetch to see if it exists
            return await userService.getUserDocument(uid);
        }
        return data;
    },

    getUserDocument: async (uid: string): Promise<UserData | null> => {
        const { data, error } = await supabase.from('owners').select('*').eq('id', uid).maybeSingle();

        // If owner row is missing, try a one-time repair
        if (!data && !error) {
            await userService.createUserDocument(uid);
            const retry = await supabase.from('owners').select('*').eq('id', uid).maybeSingle();
            if (retry.data) return mapOwnerRowToUserData(retry.data as OwnerUserRow);
        }

        if (error) throw error;
        if (!data) return null;
        return mapOwnerRowToUserData(data as OwnerUserRow);
    },

    subscribeToUserDocument: (uid: string, callback: (userData: UserData | null) => void) => {
        userService.getUserDocument(uid).then(callback).catch((error) => {
            console.error("[userService] Unable to load owner user document:", error);
            callback(null);
        });
        return deferRealtimeSubscription(() => {
            const channel = supabase.channel('owner-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'owners', filter: `id=eq.${uid}` }, async () => {
                try {
                    callback(await userService.getUserDocument(uid));
                } catch (error) {
                    console.error("[userService] Owner user document subscription failed:", error);
                    callback(null);
                }
            }).subscribe();
            return () => supabase.removeChannel(channel);
        });
    },

    updateUserProfile: (uid: string, updates: Partial<UserData>) => {
        return supabase.from('owners').update(updates).eq('id', uid);
    },

    checkEmailExists: async (email: string) => {
        const { data } = await supabase.from('accounts').select('id').eq('email', email.toLowerCase().trim()).limit(1);
        return (data?.length ?? 0) > 0;
    },

    checkPhoneExists: async (phone: string) => {
        const { data } = await supabase.from('accounts').select('id').eq('phone', phone).limit(1);
        return (data?.length ?? 0) > 0;
    },

    registerFCMToken: async () => pushService.register(),
    unregisterFCMToken: async () => pushService.unregister()
};
