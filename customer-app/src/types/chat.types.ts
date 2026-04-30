// Removed legacy firebase imports
import type { UserData } from '../services/user.service';

/**
 * Chat and Message types for RoomFindR
 */

export type Chat = {
    chatId: string;
    participants: string[];
    lastMessage: {
        text: string;
        senderId: string;
        timestamp: string;
    } | null;
    unreadCounts: {
        [userId: string]: number;
    };
    createdAt: string;
    updatedAt: string;
    propertyId?: string;
    title?: string;
    isCommunity?: boolean;
    mutedUsers?: string[];
};

export type Message = {
    id: string;
    senderId: string;
    senderName?: string;
    text: string;
    ts: string;
    type: 'text' | 'image';
    read: boolean;
    imageUrl?: string;
    imagePath?: string;
    imageSizeMB?: number;
    pgName?: string; // Added for notifications
};

export type ChatNotification = {
    id: string;
    type: string;
    roomId: string;
    senderName: string;
    message: string;
    pgName: string;
    read: boolean;
    timestamp: string;
};

export type ChatWithParticipant = Chat & {
    otherUser: UserData;
};
