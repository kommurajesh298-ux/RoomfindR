import { supabase } from './supabase-config';

export const notificationTestService = {
    async sendToCurrentUser(userId: string) {
        const { error } = await supabase.from('notifications').insert({
            user_id: userId,
            title: 'Test notification',
            message: 'RoomFindR Owner test notification sent successfully.',
            type: 'booking',
            status: 'queued',
            data: {
                status: 'approved',
                route: '/bookings',
                source: 'owner-self-test',
            },
            is_read: false,
        });

        if (error) {
            throw error;
        }
    },
};
