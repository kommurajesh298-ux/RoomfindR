import { supabase } from './supabase-config';
import type { Notice } from '../types/notice.types';

const mapNoticeTypeFromPriority = (priority: unknown): Notice['type'] => {
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

const mapPriorityFromNoticeType = (type: string): 'low' | 'normal' | 'high' | 'urgent' => {
    switch (String(type || '').toLowerCase()) {
        case 'urgent':
            return 'urgent';
        case 'payment':
        case 'maintenance':
        case 'rule':
            return 'high';
        case 'festival':
        case 'food':
            return 'low';
        default:
            return 'normal';
    }
};

export const noticeService = {
    createNotice: async (propertyId: string, userId: string, data: { title: string; message: string; type: string }) => {
        const basePayload = {
            property_id: propertyId,
            title: data.title,
            content: data.message,
            priority: mapPriorityFromNoticeType(data.type),
        };
        const extendedPayload = {
            ...basePayload,
            type: data.type,
            created_by: userId,
            visible_to: 'all',
        };

        let error = (await supabase.from('notices').insert(extendedPayload)).error;

        if (error && error.code === 'PGRST204') {
            error = (await supabase.from('notices').insert(basePayload)).error;
        }

        if (error) {
            console.error('Notice creation error:', error);
            throw new Error(`Failed to create notice: ${error.message}`);
        }
    },
    getNotices: async (propertyId: string): Promise<Notice[]> => {
        const { data, error } = await supabase.from('notices').select('*').eq('property_id', propertyId).order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(noticeService.mapToNotice);
    },
    deleteNotice: async (noticeId: string) => {
        await supabase.from('notices').delete().eq('id', noticeId);
    },
    clearNotices: async (propertyId: string) => {
        const { error } = await supabase.from('notices').delete().eq('property_id', propertyId);
        if (error) {
            throw new Error(`Failed to clear notices: ${error.message}`);
        }
    },
    subscribeToNotices: (propertyId: string, callback: (notices: Notice[]) => void) => {
        noticeService.getNotices(propertyId).then(callback);
        const channel = supabase.channel(`notices-${propertyId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'notices', filter: `property_id=eq.${propertyId}`
        }, async () => {
            const notices = await noticeService.getNotices(propertyId);
            callback(notices);
        }).subscribe();
        return () => { supabase.removeChannel(channel); };
    },
    mapToNotice: (data: unknown): Notice => {
        const d = data as Record<string, unknown>;
        return {
            noticeId: d['id'] as string,
            propertyId: d['property_id'] as string,
            title: d['title'] as string,
            message: d['content'] as string,
            type: ((d['type'] as Notice['type'] | undefined) || mapNoticeTypeFromPriority(d['priority'])),
            createdAt: d['created_at'] as string,
            createdBy: (d['created_by'] as string) || '',
            visibleTo: (d['visible_to'] as Notice['visibleTo']) || 'all'
        };
    }
};
