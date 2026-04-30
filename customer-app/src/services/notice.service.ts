import { supabase } from './supabase-config';
import type { Notice, NoticeType } from '../types/notice.types';

const mapNoticeTypeFromPriority = (priority: unknown): NoticeType => {
    switch (String(priority || '').toLowerCase()) {
        case 'urgent':
            return 'urgent';
        case 'high':
            return 'payment';
        case 'low':
            return 'info';
        default:
            return 'info';
    }
};

export const noticeService = {
    subscribeToNotices: (propertyId: string, callback: (notices: Notice[]) => void) => {
        const mapNotice = (m: {
            id: string | number;
            property_id: string | number;
            title: string;
            content?: string;
            message?: string;
            type?: string;
            priority?: string;
            visible_to?: string;
            created_by?: string;
            created_at: string;
        }): Notice => ({
            noticeId: String(m.id),
            propertyId: String(m.property_id),
            title: String(m.title),
            message: String(m.content || m.message || ''),
            type: ((m.type || mapNoticeTypeFromPriority(m.priority)) || 'info') as NoticeType,
            createdAt: String(m.created_at),
            createdBy: String(m.created_by || 'owner'),
            visibleTo: (String(m.visible_to || 'all') as Notice['visibleTo'])
        });

        supabase.from('notices').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }).then(({ data }) => {
            if (data) callback(data.map(mapNotice));
        });

        const channel = supabase.channel(`notices-${propertyId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notices', filter: `property_id=eq.${propertyId}` }, async () => {
            const { data } = await supabase.from('notices').select('*').eq('property_id', propertyId).order('created_at', { ascending: false });
            if (data) callback(data.map(mapNotice));
        }).subscribe();

        return () => { supabase.removeChannel(channel); };
    }
};
