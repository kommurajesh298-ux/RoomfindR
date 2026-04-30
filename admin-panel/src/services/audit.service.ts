import { supabase } from './supabase-config';

export const auditService = {
    logAction: async (action: string, adminId: string, adminEmail: string, details: object = {}, oldValue: unknown = null, newValue: unknown = null, targetId: string | null = null) => {
        await supabase.from('audit_logs').insert({
            user_id: adminId, action, resource_type: 'admin_action', resource_id: targetId,
            details: { adminEmail, details, oldValue, newValue }
        });
    },
    getRecentLogs: (count: number = 10, callback: (logs: unknown[]) => void) => {
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(count).then(({ data }) => { if (data) callback(data); });
        return supabase.channel('audit-logs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, async () => {
            const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(count);
            if (data) callback(data);
        }).subscribe();
    }
};
