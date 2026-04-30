import React, { useState, useEffect } from 'react';
import type { Chat, ChatWithParticipant } from '../../types/chat.types';
import { userService } from '../../services/user.service';
import { formatDistanceToNow } from 'date-fns';

interface ChatSidebarProps {
    chats: Chat[];
    selectedChatId: string | null;
    onSelectChat: (chatId: string) => void;
    currentUserId: string;
    showExploreAction?: boolean;
    onExplorePg?: () => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
    chats,
    selectedChatId,
    onSelectChat,
    currentUserId,
    showExploreAction = false,
    onExplorePg
}) => {
    const [chatsWithParticipants, setChatsWithParticipants] = useState<ChatWithParticipant[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchParticipants = async () => {
            setLoading(true);
            const updatedChats = await Promise.all(
                chats.map(async (chat) => {
                    if (chat.isCommunity) {
                        return { ...chat, otherUser: { name: chat.title || 'Community', profilePhotoUrl: '' } };
                    }

                    const otherUserId = chat.participants.find((id) => id !== currentUserId);
                    if (!otherUserId) return { ...chat, otherUser: null };

                    const userData = await userService.getUserDocument(otherUserId);
                    return { ...chat, otherUser: userData };
                })
            );
            setChatsWithParticipants(
                updatedChats
                    .filter(chat => chat.otherUser)
                    .sort((a, b) => {
                        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0);
                        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0);
                        return timeB - timeA;
                    }) as ChatWithParticipant[]
            );
            setLoading(false);
        };

        if (chats.length > 0) {
            fetchParticipants();
        } else {
            setTimeout(() => setLoading(false), 0);
        }
    }, [chats, currentUserId]);

    if (loading) {
        return (
            <div className="flex flex-col h-full bg-white">
                <div className="p-6 border-b">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight">Messages</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="flex items-center space-x-4 animate-pulse p-2">
                            <div className="w-14 h-14 bg-gray-100 rounded-full"></div>
                            <div className="flex-1 space-y-3">
                                <div className="h-4 bg-gray-100 rounded w-1/3"></div>
                                <div className="h-3 bg-gray-100 rounded w-3/4"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white/60 backdrop-blur-xl border-r border-white/50">
            <div className="p-6 border-b border-gray-100/50 bg-white/40 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
                <div>
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight">Messages</h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Your Conversations</p>
                </div>
                <div className="flex space-x-2">
                    <button className="p-2 hover:bg-white rounded-full text-gray-500 transition-all shadow-sm hover:shadow-md">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 no-scrollbar">
                {chatsWithParticipants.length === 0 ? (
                    <div className="px-6 py-12 text-center">
                        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-gray-100 shadow-lg shadow-gray-200/50">
                            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <p className="text-gray-900 font-bold mb-1">No chats yet</p>
                        <p className="text-xs text-gray-500 font-medium">
                            {showExploreAction
                                ? 'You are not staying in any PG yet. Explore available PGs to get started.'
                                : 'Book a room to start chatting with your community.'}
                        </p>
                        {showExploreAction && onExplorePg && (
                            <button
                                type="button"
                                onClick={onExplorePg}
                                className="mt-5 inline-flex h-[42px] items-center justify-center rounded-[12px] bg-gradient-to-r from-orange-500 to-orange-600 px-5 text-[13px] font-bold text-white shadow-[0_10px_20px_rgba(249,115,22,0.28)] transition-all hover:-translate-y-[1px] hover:shadow-[0_14px_26px_rgba(249,115,22,0.34)]"
                            >
                                Explore PGs
                            </button>
                        )}
                    </div>
                ) : (
                    chatsWithParticipants.map((chat) => {
                        const isSelected = selectedChatId === chat.chatId;
                        const unreadCount = chat.unreadCounts[currentUserId] || 0;

                        return (
                            <button
                                key={chat.chatId}
                                onClick={() => onSelectChat(chat.chatId)}
                                className={`w-full flex items-center p-3 sm:p-4 rounded-2xl transition-all duration-300 group relative border ${isSelected
                                    ? 'bg-blue-50/80 border-blue-100 shadow-lg shadow-blue-100'
                                    : 'bg-white/40 border-transparent hover:bg-white hover:border-white hover:shadow-md'
                                    }`}
                            >
                                <div className="relative flex-shrink-0">
                                    <div className="relative">
                                        <img
                                            src={chat.isCommunity ? `https://ui-avatars.com/api/?name=${encodeURIComponent(chat.otherUser.name)}&background=3B82F6&color=fff` : (chat.otherUser.profilePhotoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(chat.otherUser.name)}&background=random`)}
                                            alt={chat.otherUser.name}
                                            className={`w-14 h-14 rounded-2xl object-cover shadow-sm transition-transform duration-300 ${isSelected ? 'scale-105 ring-2 ring-blue-500 ring-offset-2' : 'group-hover:scale-105 ring-1 ring-gray-100'}`}
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(chat.otherUser.name)}&background=3B82F6&color=fff`;
                                            }}
                                        />
                                        {chat.isCommunity && (
                                            <div className="absolute -bottom-1 -right-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg p-1 border-2 border-white shadow-sm">
                                                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                                                </svg>
                                            </div>
                                        )}
                                    </div>
                                    {unreadCount > 0 && (
                                        <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-xl bg-gradient-to-r from-red-500 to-pink-600 text-[10px] font-black text-white ring-4 ring-white shadow-lg animate-bounce-subtle">
                                            {unreadCount}
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 ml-4 text-left">
                                    <div className="flex justify-between items-center mb-1">
                                        <h3 className={`text-[15px] font-black truncate leading-tight ${isSelected ? 'text-blue-700' : 'text-gray-900 group-hover:text-blue-600 transition-colors'}`}>
                                            {chat.otherUser.name}
                                        </h3>
                                        {chat.lastMessage && chat.lastMessage.timestamp && (
                                            <span className={`text-[10px] font-bold whitespace-nowrap ml-2 ${isSelected ? 'text-blue-400' : 'text-gray-400'}`}>
                                                {formatDistanceToNow(new Date(chat.lastMessage.timestamp), { addSuffix: false })}
                                            </span>
                                        )}
                                    </div>
                                    <h4 className={`text-xs font-bold truncate mb-1 uppercase tracking-wider ${unreadCount > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {chat.isCommunity ? chat.title : 'Direct Message'}
                                    </h4>
                                    <p className={`text-xs truncate transition-colors ${unreadCount > 0 ? 'font-bold text-gray-900' : 'text-gray-500 font-medium'}`}>
                                        {chat.lastMessage?.text || 'No messages yet'}
                                    </p>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default ChatSidebar;
