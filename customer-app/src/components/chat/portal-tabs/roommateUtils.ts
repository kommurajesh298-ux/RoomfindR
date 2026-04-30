import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import type { User } from '@supabase/supabase-js';
import { chatService } from '../../../services/chat.service';

export interface Roommate {
    customer_id?: string;
    customer_name: string;
    created_at: string;
    is_me: boolean;
}

export const startRoommateChat = async (
    currentUser: User | null,
    roommate: Roommate,
    navigate: (path: string) => void
) => {
    if (!currentUser || !roommate.customer_id) return;

    try {
        const chatId = await chatService.getOrCreateChat(currentUser.id, roommate.customer_id);
        navigate(`/chat/${chatId}`);
    } catch (error) {
        console.error('Failed to start chat:', error);
        toast.error('Failed to start chat');
    }
};

export const formatResidentDate = (date: string | Date | null | undefined, fmt: string) => {
    try {
        if (!date) return 'N/A';
        return format(new Date(date), fmt);
    } catch (error) {
        console.error('Date formatting error:', error);
        return 'Invalid Date';
    }
};
