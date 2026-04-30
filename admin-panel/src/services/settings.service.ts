import { supabase } from './supabase-config';

export const SettingsService = {
    getSettings: (callback: (settings: Record<string, unknown>) => void) => {
        supabase.from('settings').select('value').eq('id', 'site').maybeSingle().then(({ data }) => { if (data) callback(data.value); });
        return supabase.channel('site-settings').on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'id=eq.site' }, async () => {
            const { data } = await supabase.from('settings').select('value').eq('id', 'site').maybeSingle(); if (data) callback(data.value);
        }).subscribe();
    },
    updateSetting: async (key: string, value: unknown, adminId: string, adminEmail: string, oldValue: unknown) => {
        const { data: cur } = await supabase.from('settings').select('value').eq('id', 'site').single();
        const next = { ...(cur?.value || {}), [key]: value };
        if (key.includes('.')) {
            const parts = key.split('.'); let t = next;
            for (let i = 0; i < parts.length - 1; i++) { t[parts[i]] = { ...(t[parts[i]] || {}) }; t = t[parts[i]]; }
            t[parts[parts.length - 1]] = value;
        }
        await supabase.from('settings').update({ value: next, updated_at: new Date().toISOString() }).eq('id', 'site');
        await supabase.from('audit_logs').insert({ user_id: adminId, action: 'setting_change', details: { key, oldValue, newValue: value, adminEmail } });
    },
    toggleFeature: async (feature: string, enabled: boolean, adminId: string, adminEmail: string) => {
        const { data: cur } = await supabase.from('settings').select('value').eq('id', 'site').single();
        const next = { ...(cur?.value || {}), features: { ...(cur?.value?.features || {}), [feature]: enabled } };
        await supabase.from('settings').update({ value: next, updated_at: new Date().toISOString() }).eq('id', 'site');
        await supabase.from('audit_logs').insert({ user_id: adminId, action: 'toggle_feature', details: { feature, enabled, adminEmail } });
    },
    toggleMaintenanceMode: async (enabled: boolean, adminId: string, adminEmail: string) => {
        const { data: cur } = await supabase.from('settings').select('value').eq('id', 'site').single();
        const next = { ...(cur?.value || {}), maintenanceMode: enabled };
        await supabase.from('settings').update({ value: next, updated_at: new Date().toISOString() }).eq('id', 'site');
        await supabase.from('audit_logs').insert({ user_id: adminId, action: 'toggle_maintenance', details: { enabled, adminEmail } });
    },
    updateAdvanceAmount: async (amount: number, adminId: string, adminEmail: string) => {
        const { data: cur } = await supabase.from('settings').select('value').eq('id', 'site').single();
        const next = { ...(cur?.value || {}), advanceAmount: amount };
        await supabase.from('settings').update({ value: next, updated_at: new Date().toISOString() }).eq('id', 'site');
        await supabase.from('audit_logs').insert({ user_id: adminId, action: 'update_advance_amount', details: { amount, adminEmail } });
    },
    updateTaxRate: async (rate: number, adminId: string, adminEmail: string) => {
        const { data: cur } = await supabase.from('settings').select('value').eq('id', 'site').single();
        const next = { ...(cur?.value || {}), taxRate: rate };
        await supabase.from('settings').update({ value: next, updated_at: new Date().toISOString() }).eq('id', 'site');
        await supabase.from('audit_logs').insert({ user_id: adminId, action: 'update_tax_rate', details: { rate, adminEmail } });
    },
    subscribeToAuditLogs: (callback: (logs: unknown[]) => void) => {
        const fetch = async () => {
            const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50);
            if (data) callback(data);
        };
        fetch();
        const channel = supabase.channel('audit-logs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, fetch).subscribe();
        return () => { supabase.removeChannel(channel); };
    }
};
