import { publicSupabase } from './supabase-config';
import { deferRealtimeSubscription } from './realtime-subscription';

export interface SiteSettings {
    maintenanceMode: boolean;
    bannerMessage?: string;
    version: string;
}

const defaultSettings: SiteSettings = {
    maintenanceMode: false,
    version: 'default'
};

export const siteService = {
    subscribeToSettings: (callback: (settings: SiteSettings) => void) => {
        void (async () => {
            try {
                const { data } = await publicSupabase
                    .from('settings')
                    .select('value')
                    .eq('id', 'site')
                    .maybeSingle();

                if (data?.value) {
                    callback(data.value as SiteSettings);
                } else {
                    callback(defaultSettings);
                }
            } catch {
                callback(defaultSettings);
            }
        })();
        return deferRealtimeSubscription(() => {
            const channel = publicSupabase.channel('site-settings').on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'id=eq.site' }, async () => {
                const { data } = await publicSupabase.from('settings').select('value').eq('id', 'site').maybeSingle();
                if (data?.value) {
                    callback(data.value as SiteSettings);
                } else {
                    callback(defaultSettings);
                }
            }).subscribe();
            return () => { publicSupabase.removeChannel(channel); };
        });
    }
};
