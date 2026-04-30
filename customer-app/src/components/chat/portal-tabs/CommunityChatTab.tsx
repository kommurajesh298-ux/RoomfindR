import React, { useEffect, useState } from 'react';
import ChatConversation from '../ChatConversation';
import { chatService } from '../../../services/chat.service';
import LoadingOverlay from '../../common/LoadingOverlay';
import type { Property } from '../../../types/property.types';

interface CommunityChatTabProps {
    property: Property;
    currentUser: { id: string };
}

const CommunityChatTab: React.FC<CommunityChatTabProps> = ({ property, currentUser }) => {
    const [chatId, setChatId] = useState<string | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [memberCount, setMemberCount] = useState(1);
    const [onlineCount, setOnlineCount] = useState(1);

    useEffect(() => {
        let isMounted = true;

        const initChat = async () => {
            // Optional: setChatId(null) here might trigger re-render loop if synchronous?
            // Better to handle loading state inside component or just update ID.
            if (isMounted) setChatId(null);

            try {
                const id = await chatService.getOrCreateCommunityChat(property.propertyId, property.title, currentUser.id);
                if (isMounted) setChatId(id);
            } catch (error) {
                console.error('Failed to init community chat:', error);
            }
        };
        initChat();

        return () => { isMounted = false; };
    }, [property.propertyId, property.title, currentUser.id, refreshTrigger]);

    useEffect(() => {
        if (!chatId) return;

        const unsubscribeChat = chatService.subscribeToChat(chatId, (chat) => {
            setMemberCount(Math.max(chat?.participants.length || 0, 1));
        });

        const unsubscribePresence = chatService.subscribeToChatPresence(chatId, currentUser.id, (onlineUserIds) => {
            setOnlineCount(Math.max(onlineUserIds.length, 1));
        });

        return () => {
            unsubscribeChat();
            unsubscribePresence();
        };
    }, [chatId, currentUser.id]);

    if (!chatId) return <LoadingOverlay />;

    return (
        <div className="flex h-[calc(100dvh-76px-53px)] min-h-0 w-full flex-1 flex-col overflow-hidden bg-white md:h-[calc(100vh-73px-53px)] lg:h-full">
            <ChatConversation
                chatId={chatId}
                currentUserId={currentUser.id}
                title={property.title}
                profileImageUrl={property.images?.[0]}
                propertyData={property}
                communityStats={{ memberCount, onlineCount }}
                onDelete={() => {
                    setRefreshTrigger(prev => prev + 1);
                }}
            />
        </div>
    );
};

export default CommunityChatTab;
