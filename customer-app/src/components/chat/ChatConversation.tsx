/* eslint-disable no-irregular-whitespace */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatService } from '../../services/chat.service';
import type { Message } from '../../types/chat.types';

import type { UserData } from '../../services/user.service';
import { userService } from '../../services/user.service';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { FaPaperPlane, FaChevronLeft, FaEllipsisV, FaSmile, FaTrash, FaInfoCircle, FaVolumeMute, FaMapMarkerAlt, FaUtensils, FaWifi, FaTimes, FaUsers } from 'react-icons/fa';
import { toast } from 'react-hot-toast';
import MediaManager from './portal-tabs/MediaManager';
import ImagePreviewModal from './ImagePreviewModal';
import type { Property } from '../../types/property.types';

interface ChatConversationProps {
    chatId: string;
    currentUserId: string;
    otherUser?: UserData;
    title?: string;
    fallbackLastMessage?: string;
    onBack?: () => void;
    hideHeader?: boolean;
    profileImageUrl?: string;
    propertyData?: Property;
    communityStats?: {
        memberCount: number;
        onlineCount: number;
    };
    onDelete?: () => void;
}

const ChatConversation: React.FC<ChatConversationProps> = ({ chatId, currentUserId, otherUser, title, fallbackLastMessage, onBack, hideHeader, profileImageUrl, propertyData: propsPropertyData, communityStats, onDelete }) => {
    const navigate = useNavigate();
    const [messages, setMessages] = useState<Message[]>([]);
    const [currentUserData, setCurrentUserData] = useState<UserData | null>(null);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [otherUserTyping, setOtherUserTyping] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [showMenu, setShowMenu] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showStorageModal, setShowStorageModal] = useState(false);
    const [showMediaManager, setShowMediaManager] = useState(false);
    const [showPGInfo, setShowPGInfo] = useState(false);
    const [propertyData, setPropertyData] = useState<Property | null>(propsPropertyData || null);

    useEffect(() => {
        if (propsPropertyData) {
            setPropertyData(propsPropertyData);
        }
    }, [propsPropertyData]);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shouldAutoScrollRef = useRef(true);
    const pendingScrollRestoreRef = useRef<{ previousScrollHeight: number; previousScrollTop: number } | null>(null);
    const isCommunityChat = Boolean(propertyData);
    const memberCount = Math.max(communityStats?.memberCount || 1, 1);
    const onlineCount = Math.max(communityStats?.onlineCount || 1, 1);
    const memberLabel = `${memberCount} member${memberCount === 1 ? '' : 's'}`;
    const onlineLabel = `${onlineCount} online`;
    const communityTag = propertyData?.tags?.[0] || 'Community';
    const fallbackConversationText = String(fallbackLastMessage || '').trim();
    const displayMessages = useMemo(
        () => [...messages].sort((a, b) => (new Date(a.ts).getTime() || 0) - (new Date(b.ts).getTime() || 0)),
        [messages]
    );

    useEffect(() => {
        const fetchCurrentUserData = async () => {
            try {
                const data = await userService.getUserDocument(currentUserId);
                setCurrentUserData(data);
            } catch (error) {
                console.error('Error fetching current user data:', error);
            }
        };
        fetchCurrentUserData();
    }, [currentUserId]);

    useEffect(() => {
        if (!chatId || isDeleting) return;
        const unsubscribeMessages = chatService.subscribeToMessages(chatId, (snapshotMessages) => {
            if (isDeleting) return;
            setMessages(prevMessages => {
                const merged = [...snapshotMessages];
                const snapshotIds = new Set(snapshotMessages.map(m => m.id));
                const realSignatures = new Set(snapshotMessages.map(m =>
                    `${m.senderId}|${m.text || ''}|${m.imageUrl || ''}`
                ));

                prevMessages.forEach(msg => {
                    if (snapshotIds.has(msg.id)) return;
                    if (msg.id.startsWith('temp-')) {
                        const sig = `${msg.senderId}|${msg.text || ''}|${msg.imageUrl || ''}`;
                        if (realSignatures.has(sig)) return;
                        merged.push(msg);
                    }
                });

                return merged.sort((a, b) => (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0));
            });
            chatService.markAsRead(chatId, currentUserId);
        });

        const unsubscribeTyping = chatService.subscribeToTypingStatus(chatId, (typingUsers) => {
            const othersTyping = Object.entries(typingUsers)
                .some(([id, typing]) => id !== currentUserId && typing);
            setOtherUserTyping(othersTyping);
        });

        return () => {
            unsubscribeMessages();
            unsubscribeTyping();
        };
    }, [chatId, currentUserId, isDeleting]);

    useEffect(() => {
        if (!chatId || isDeleting || messages.length > 0) return;

        let cancelled = false;

        const hydrateProtectedMessages = async () => {
            try {
                const snapshot = await chatService.getProtectedChatSnapshot(chatId);
                if (cancelled || snapshot.messages.length === 0) return;

                setMessages((previous) => {
                    if (previous.length > 0) return previous;
                    return [...snapshot.messages].sort(
                        (a, b) => (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0),
                    );
                });
            } catch {
                // Fall back to the public realtime/subscription path.
            }
        };

        void hydrateProtectedMessages();

        return () => {
            cancelled = true;
        };
    }, [chatId, isDeleting, messages.length]);

    useEffect(() => {
        if (pendingScrollRestoreRef.current && scrollContainerRef.current) {
            const { previousScrollHeight, previousScrollTop } = pendingScrollRestoreRef.current;
            const nextScrollHeight = scrollContainerRef.current.scrollHeight;
            scrollContainerRef.current.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight);
            pendingScrollRestoreRef.current = null;
            return;
        }

        if (shouldAutoScrollRef.current && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [displayMessages.length, otherUserTyping]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        const text = input.trim();
        setInput('');

        const tempId = 'temp-' + Date.now();
        const mockTs = new Date().toISOString();
        const optimisticMsg: Message = {
            id: tempId,
            senderId: currentUserId,
            senderName: currentUserData?.name || 'Me',
            text,
            type: 'text',
            read: false,
            ts: mockTs
        };
        shouldAutoScrollRef.current = true;
        setMessages(prev => [optimisticMsg, ...prev]);

        try {
            await chatService.sendMessage(chatId, {
                senderId: currentUserId,
                senderName: currentUserData?.name,
                text,
                type: 'text',
                read: false
            });
        } catch (error) {
            setMessages(prev => prev.filter(m => m.id !== tempId));
            console.error('Error sending message:', error);
            toast.error('Failed to send message');
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);
        if (!isTyping) {
            setIsTyping(true);
            chatService.setTypingStatus(chatId, currentUserId, true);
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            chatService.setTypingStatus(chatId, currentUserId, false);
        }, 2000);
    };

    const handleScroll = async (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
        shouldAutoScrollRef.current = nearBottom;

        if (target.scrollTop < 100 && !loadingMore && hasMore) {
            setLoadingMore(true);
            try {
                const oldestMsg = messages
                    .filter(m => !m.id.startsWith('temp-'))
                    .sort((a, b) => (new Date(a.ts).getTime() || 0) - (new Date(b.ts).getTime() || 0))[0];

                if (oldestMsg && oldestMsg.ts) {
                    pendingScrollRestoreRef.current = {
                        previousScrollHeight: target.scrollHeight,
                        previousScrollTop: target.scrollTop
                    };
                    const olderMessages = await chatService.getMoreMessages(chatId, oldestMsg.ts);
                    if (olderMessages.length < 20) setHasMore(false);
                    setMessages(prev => {
                        const existingIds = new Set(prev.map(m => m.id));
                        const uniqueNew = olderMessages.filter(m => !existingIds.has(m.id));
                        return [...prev, ...uniqueNew].sort((a, b) => (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0));
                    });
                } else setHasMore(false);
            } catch (error) {
                console.error('Error loading older messages:', error);
            } finally {
                setLoadingMore(false);
            }
        }
    };

    const handleDeleteChat = async () => {
        if (isDeleting) return;

        setShowDeleteConfirm(false);
        setIsDeleting(true);
        setShowMenu(false);
        try {
            await chatService.deleteChat(chatId);

            setMessages([]);
            toast.success('Conversation deleted');

            // Wait a moment for DB propagation before re-initializing
            await new Promise(resolve => setTimeout(resolve, 800));

            if (onDelete) {
                onDelete();
            } else {
                onBack?.();
            }
        } catch (error: unknown) {
            console.error('[ChatConversation] Deletion failed:', error);
            setIsDeleting(false);
            toast.error(`Failed to delete chat: ${(error as Error).message || 'Unknown error'}`);
        }
    };

    const handleMenuAction = async (action: string) => {
        setShowMenu(false);
        switch (action) {
            case 'info': {
                const propertyId = propertyData?.propertyId;
                if (propertyId) {
                    setShowPGInfo(true);
                } else {
                    toast('Chat: ' + (title || 'Direct Message'), { icon: 'â„¹ï¸' });
                }
                break;
            }
            case 'mute':
                try {
                    const newMuteState = !isMuted;
                    await chatService.muteChat(chatId, currentUserId, newMuteState);
                    setIsMuted(newMuteState);
                    toast.success(newMuteState ? 'Notifications muted' : 'Notifications unmuted');
                } catch (error) {
                    console.error('Error toggling mute:', error);
                    toast.error('Failed to change mute setting');
                }
                break;
            case 'delete':
                setShowDeleteConfirm(true);
                break;
            case 'manage-media':
                setShowMediaManager(true);
                break;
        }
    };

    return (
        <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden font-['Inter',_sans-serif] ${isCommunityChat ? 'bg-[linear-gradient(180deg,#EEF5FF_0%,#FFFFFF_34%,#FFF8F0_100%)] lg:bg-[radial-gradient(circle_at_15%_0%,rgba(37,99,235,0.12),transparent_32%),radial-gradient(circle_at_88%_18%,rgba(249,115,22,0.12),transparent_28%),linear-gradient(180deg,#F7FAFF_0%,#FFFFFF_42%,#FFF7ED_100%)]' : 'bg-[#f8f9fa]'}`}>
            {/* ðŸ” TOP APP BAR (ANDROID STANDARDIZED) */}
            {!hideHeader && (
                <div className={`${isCommunityChat ? 'relative' : 'sticky top-0'} z-[90] shrink-0 border-b flex items-start justify-between ${isCommunityChat ? 'rounded-b-[22px] border-[#CFE0FF] bg-[linear-gradient(135deg,#1D4ED8_0%,#2563EB_55%,#3B82F6_100%)] px-3 py-2.5 shadow-[0_18px_42px_rgba(29,78,216,0.18)] lg:m-4 lg:mb-0 lg:rounded-[28px] lg:border lg:px-5 lg:py-4 lg:shadow-[0_22px_54px_rgba(29,78,216,0.22)]' : 'h-[56px] min-h-[56px] border-gray-100 bg-white px-4 shadow-sm'}`}>
                    <div className="flex min-w-0 flex-1 items-start">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className={`mr-2 mt-1 rounded-full p-1 transition-colors ${isCommunityChat ? 'text-white/90 active:bg-white/15' : 'text-gray-600 active:bg-gray-100'}`}
                            >
                                <FaChevronLeft size={20} />
                            </button>
                        )}
                        <div className="relative shrink-0">
                            <img
                                src={profileImageUrl || otherUser?.profilePhotoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(title || otherUser?.name || 'Chat')}&background=3B82F6&color=fff`}
                                className={`h-[42px] w-[42px] rounded-[14px] object-cover shadow-sm ${isCommunityChat ? 'border-2 border-white/70 shadow-[0_10px_24px_rgba(15,23,42,0.24)] lg:h-[54px] lg:w-[54px] lg:rounded-[18px]' : 'border border-gray-100'}`}
                                alt="Profile"
                            />
                            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 ${isCommunityChat ? 'border-[#2563EB] bg-[#FB923C]' : 'border-white bg-blue-500'}`}></span>
                        </div>
                        <div className="ml-3 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                {isCommunityChat && (
                                    <span className="rounded-full border border-white/30 bg-white/12 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/85">
                                        {communityTag}
                                    </span>
                                )}
                                <h2 className={`truncate leading-tight ${isCommunityChat ? 'text-[16px] font-black text-white lg:text-[22px]' : 'text-[17px] font-semibold text-[#111827]'}`}>
                                    {title || otherUser?.name || 'Community Chat'}
                                </h2>
                            </div>
                            {!isCommunityChat && (
                                <p className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-wider leading-none text-[#6B7280]">
                                    {otherUserTyping ? 'typing...' : 'online'}
                                </p>
                            )}
                            {isCommunityChat && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/14 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-white">
                                        <span className="h-2 w-2 rounded-full bg-[#FDBA74]"></span>
                                        {onlineLabel}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-blue-50">
                                        <FaUsers size={10} />
                                        {memberLabel}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="ml-2 flex items-center gap-1 pt-1">
                        <button
                            onClick={() => setShowMenu(!showMenu)}
                            aria-label="Chat options"
                            className={`flex h-[40px] w-[40px] items-center justify-center rounded-full transition-colors ${isCommunityChat ? 'bg-white/12 text-white active:bg-white/20' : 'text-[#6B7280] active:bg-gray-100'}`}
                        >
                            <FaEllipsisV size={18} />
                        </button>
                    </div>

                    {showMenu && (
                        <div className="absolute right-4 top-14 w-56 bg-white rounded-[14px] shadow-xl border border-gray-100 py-1.5 z-[100] animate-in fade-in zoom-in duration-200">
                            <button
                                onClick={() => handleMenuAction('info')}
                                className="w-full px-4 py-3 text-left text-[14px] font-medium text-[#111827] active:bg-gray-50 flex items-center gap-3"
                            >
                                <FaInfoCircle className="text-gray-400" size={16} />
                                PG Info
                            </button>
                            <button
                                onClick={() => handleMenuAction('mute')}
                                className="w-full px-4 py-3 text-left text-[14px] font-medium text-[#111827] active:bg-gray-50 flex items-center gap-3"
                            >
                                <FaVolumeMute className={isMuted ? 'text-blue-500' : 'text-gray-400'} size={16} />
                                {isMuted ? 'Unmute' : 'Mute Notifications'}
                            </button>
                            <button
                                onClick={() => handleMenuAction('delete')}
                                className="w-full px-4 py-3 text-left text-[14px] font-medium text-red-600 active:bg-red-50 flex items-center gap-3"
                            >
                                <FaTrash className="text-red-400" size={16} />
                                Delete Chat
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Messages Area */}
            <div
                ref={scrollContainerRef}
                data-testid={isCommunityChat ? 'community-messages-scroll' : undefined}
                onScroll={handleScroll}
                className={`relative z-0 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain ${isCommunityChat ? 'bg-[radial-gradient(circle_at_top,#F4F8FF_0%,#FFFFFF_58%,#FFF7EE_100%)] px-3 pt-4 pb-6 lg:bg-transparent lg:px-8 lg:pb-8 lg:pt-6' : 'px-4 pt-4 pb-20'} no-scrollbar`}
                style={{ background: isCommunityChat ? undefined : '#FFFFFF' }}
            >
                {isCommunityChat && messages.length === 0 && !otherUserTyping && (
                    <div className="pointer-events-none absolute inset-x-4 top-5 z-0 lg:inset-x-8 lg:top-8">
                        <div className="mx-auto max-w-md rounded-[28px] border border-[#D7E6FF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F3F7FF_68%,#FFF6EC_100%)] p-5 shadow-[0_24px_48px_rgba(37,99,235,0.10)] lg:max-w-3xl lg:rounded-[34px] lg:p-7 lg:shadow-[0_30px_80px_rgba(37,99,235,0.14)]">
                            <div className="flex items-start gap-4">
                                <div className="relative">
                                    <img
                                        src={profileImageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(title || 'Community')}&background=3B82F6&color=fff`}
                                        className="h-[56px] w-[56px] rounded-[18px] border-2 border-white object-cover shadow-[0_14px_28px_rgba(30,64,175,0.18)]"
                                        alt={title || 'Community'}
                                    />
                                    <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-[3px] border-white bg-[#F97316]"></span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#F97316]">Community Lounge</p>
                                    <h3 className="mt-1 text-[20px] font-black leading-tight text-[#153E8A]">
                                        {title || 'Resident Community'}
                                    </h3>
                                    <p className="mt-1 text-[13px] font-semibold leading-5 text-[#64748B]">
                                        Chat with your PG mates, share updates, and stay connected with what is happening today.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="rounded-[18px] border border-[#D9E8FF] bg-white px-4 py-3 shadow-sm">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#2563EB]">Members</p>
                                    <p className="mt-1 text-[18px] font-black text-[#0F172A]">{memberCount}</p>
                                </div>
                                <div className="rounded-[18px] border border-[#FED7AA] bg-[#FFF7ED] px-4 py-3 shadow-sm">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#F97316]">Online Now</p>
                                    <p className="mt-1 text-[18px] font-black text-[#9A3412]">{onlineCount}</p>
                                </div>
                            </div>

                            <div className="mt-4 rounded-[20px] border border-[#E5EDFF] bg-white/90 px-4 py-3 lg:px-5 lg:py-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#1D4ED8]">
                                    Start the conversation
                                </p>
                                <p className="mt-1 text-[13px] font-medium leading-5 text-[#64748B]">
                                    Ask about food timings, room updates, events, cab sharing, or anything your community should know.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
                {otherUserTyping && (
                    <div className="flex justify-start mb-2">
                        <TypingIndicator userName={otherUser?.name || title || 'Someone'} />
                    </div>
                )}
                {displayMessages.length === 0 && fallbackConversationText && (
                    <div className="mb-4 flex justify-center">
                        <div className="w-full max-w-xl rounded-[24px] border border-[#DCE8FF] bg-white/95 px-4 py-3 shadow-[0_14px_34px_rgba(37,99,235,0.08)]">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#2563EB]">
                                Latest update
                            </p>
                            <p className="mt-1 text-[14px] font-semibold text-[#0F172A]">
                                {fallbackConversationText}
                            </p>
                        </div>
                    </div>
                )}
                {displayMessages.map((msg, index) => {
                    const previousMsg = displayMessages[index - 1];
                    const msgDate = msg.ts ? chatService.formatMessageDate(msg.ts) : '';
                    const previousMsgDate = previousMsg?.ts ? chatService.formatMessageDate(previousMsg.ts) : '';
                    const showDateSeparator = index === 0 || msgDate !== previousMsgDate;

                    return (
                        <div key={msg.id} className="w-full">
                            {showDateSeparator && (
                                <div className={`flex justify-center ${isCommunityChat ? 'my-4' : 'my-6'}`}>
                                    <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${isCommunityChat ? 'border border-[#DCE8FF] bg-white/90 text-[#2563EB] shadow-sm' : 'bg-gray-100 text-[#6B7280]'}`}>
                                        {msgDate}
                                    </span>
                                </div>
                            )}
                            <MessageBubble
                                message={msg}
                                isSender={msg.senderId === currentUserId}
                                showTimestamp={true}
                                isRead={true}
                                onImageClick={(url) => setPreviewImageUrl(url)}
                            />
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
                {loadingMore && (
                    <div className="flex justify-center p-4">
                        <div className="h-6 w-6 rounded-full border-2 border-[#2563eb] border-t-transparent animate-spin"></div>
                    </div>
                )}
            </div>

            {/* âŒ¨ï¸ PREMIUM INPUT AREA (FLOATING GLASSMORPHISM) */}
            <div
                className={`z-[70] shrink-0 transition-all ${isDeleting ? 'pointer-events-none opacity-50' : ''} ${isCommunityChat ? 'relative z-[95] border-t border-[#DBEAFE] bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.98)_28%,#FFF7ED_100%)] px-3 pt-2 shadow-[0_-18px_32px_rgba(37,99,235,0.08)] lg:px-8 lg:pb-5 lg:pt-4' : 'bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-6 pt-3'}`}
                style={isCommunityChat ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' } : undefined}
            >
                <div className={`mx-auto flex max-w-4xl items-end gap-2 rounded-[24px] p-2 sm:gap-3 ${isCommunityChat ? 'border border-[#D8E5FF] bg-white shadow-[0_20px_40px_rgba(37,99,235,0.10)] lg:max-w-5xl lg:rounded-[28px] lg:p-3' : 'border border-white/60 bg-white/40 shadow-lg shadow-gray-200/40 backdrop-blur-xl'}`}>
                    <button
                        type="button"
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all ${isCommunityChat ? 'bg-[#EFF5FF] text-[#2563EB] active:scale-90 active:bg-[#E0ECFF]' : 'text-gray-400 hover:bg-white hover:text-blue-600 active:scale-90'}`}
                    >
                        <FaSmile size={22} />
                    </button>

                    <form onSubmit={handleSend} className="flex flex-1 items-end gap-2 sm:gap-3">
                        <div className="group relative flex-1">
                            <input
                                type="text"
                                name="chatMessage"
                                value={input}
                                onChange={handleInputChange}
                                placeholder="Type a message..."
                                className={`w-full rounded-[22px] px-5 py-3 text-[15px] outline-none transition-all ${isCommunityChat ? 'border border-[#D9E6FF] bg-[#F8FBFF] text-gray-900 placeholder:text-[#94A3B8] focus:border-[#93C5FD] focus:bg-white focus:shadow-[0_10px_24px_rgba(37,99,235,0.10)]' : 'border border-gray-100 bg-white/80 text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-200 focus:bg-white focus:shadow-md focus:shadow-blue-50/50'}`}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={!input.trim() || isDeleting}
                            className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full transition-all active:scale-90 ${input.trim()
                                ? isCommunityChat
                                    ? 'shadow-[0_16px_32px_rgba(249,115,22,0.24)]'
                                    : 'shadow-lg shadow-blue-200 active:shadow-sm'
                                : 'grayscale opacity-50'
                                }`}
                        >
                            <div className={`absolute inset-0 transition-opacity duration-300 ${input.trim()
                                ? isCommunityChat
                                    ? 'bg-[linear-gradient(135deg,#FB923C_0%,#F97316_100%)] opacity-100'
                                    : 'bg-gradient-to-tr from-[#2563eb] to-[#4f46e5] opacity-100'
                                : 'bg-gray-100 opacity-100'
                                }`} />

                            <FaPaperPlane
                                size={17}
                                className={`relative z-10 transition-all duration-300 ${input.trim()
                                    ? 'translate-x-0.5 -translate-y-0.5 scale-110 text-white'
                                    : 'text-gray-400'
                                    }`}
                            />
                        </button>
                    </form>
                </div>
                {!isCommunityChat && (
                    <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-[0.18em] animate-pulse text-gray-400">
                        Secure & Encrypted Community Chat
                    </p>
                )}
            </div>

            {showDeleteConfirm && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="w-full max-w-sm overflow-hidden rounded-[30px] border border-[#DBEAFE] bg-white shadow-[0_28px_70px_rgba(15,23,42,0.28)] animate-in zoom-in-95 duration-200">
                        <div className="bg-[linear-gradient(135deg,#EFF6FF_0%,#FFF7ED_100%)] px-6 pb-4 pt-6">
                            <div className="flex items-start gap-4">
                                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#F97316_0%,#FB923C_100%)] text-white shadow-[0_16px_30px_rgba(249,115,22,0.26)]">
                                    <FaTrash size={22} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#F97316]">
                                        Delete Chat
                                    </p>
                                    <h3 className="mt-1 text-[22px] font-black leading-tight text-[#0F172A]">
                                        Remove this conversation?
                                    </h3>
                                    <p className="mt-2 text-[14px] font-medium leading-6 text-[#64748B]">
                                        This will delete the full chat history for this conversation. This action cannot be undone.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 px-6 pb-6 pt-5">
                            <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 rounded-[16px] border border-[#D9E6FF] bg-[#F8FBFF] px-4 py-3 text-[14px] font-black text-[#1D4ED8] transition-all active:scale-[0.98]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteChat}
                                disabled={isDeleting}
                                className={`flex-1 rounded-[16px] px-4 py-3 text-[14px] font-black text-white transition-all active:scale-[0.98] ${isDeleting ? 'cursor-not-allowed bg-gray-300' : 'bg-[linear-gradient(135deg,#F97316_0%,#FB923C_100%)] shadow-[0_18px_30px_rgba(249,115,22,0.24)]'}`}
                            >
                                {isDeleting ? 'Deleting...' : 'Delete Chat'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Storage Full Modal */}
            {showStorageModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white rounded-[32px] w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in slide-in-from-bottom-4 duration-300">
                        <div className="p-8 text-center">
                            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <FaTrash className="text-red-500 text-3xl" />
                            </div>
                            <h3 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">âš  Chat Storage Full</h3>
                            <p className="text-gray-500 text-[15px] font-medium leading-relaxed mb-8">
                                You have reached your 100MB limit. Upgrade to RoomFindR Prime or clear old media to continue.
                            </p>
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={() => {
                                        setShowStorageModal(false);
                                        toast.success('Subscription plans coming soon!');
                                    }}
                                    className="w-full h-[48px] bg-blue-600 text-white font-black rounded-2xl shadow-lg shadow-blue-200 active:scale-95 transition-all uppercase tracking-widest text-[13px]"
                                >
                                    Upgrade Storage
                                </button>
                                <button
                                    onClick={() => {
                                        setShowStorageModal(false);
                                        setShowMediaManager(true);
                                    }}
                                    className="w-full h-[48px] bg-black text-white font-bold rounded-2xl hover:bg-gray-800 transition-all shadow-lg active:scale-95 text-[14px]"
                                >
                                    Manage Media
                                </button>
                                <button
                                    onClick={() => setShowStorageModal(false)}
                                    className="w-full py-2 text-gray-400 font-bold hover:text-gray-600 transition-all text-xs uppercase tracking-widest"
                                >
                                    Later
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}



            {/* Media Manager Overlay */}
            {showMediaManager && (
                <div className="absolute inset-0 z-[250] bg-white animate-in slide-in-from-right duration-300">
                    <MediaManager
                        chatId={chatId}
                        userId={currentUserId}
                        onClose={() => setShowMediaManager(false)}
                    />
                </div>
            )}

            {/* Image Preview Modal */}
            {previewImageUrl && (
                <ImagePreviewModal
                    imageUrl={previewImageUrl}
                    onClose={() => setPreviewImageUrl(null)}
                />
            )}

            {/* PG Info Modal */}
            {showPGInfo && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white rounded-[32px] w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in slide-in-from-bottom-4 duration-300">
                        {propertyData ? (
                            <>
                                <div className="relative h-48">
                                    <img
                                        src={propertyData.images?.[0] || 'https://images.unsplash.com/photo-1555854817-40e098ee7f27?w=800'}
                                        className="w-full h-full object-cover"
                                        alt={propertyData.title}
                                    />
                                    <button
                                        onClick={() => setShowPGInfo(false)}
                                        className="absolute top-4 right-4 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all active:scale-90"
                                    >
                                        <FaTimes size={18} />
                                    </button>
                                    <div className="absolute bottom-4 left-4">
                                        <span className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black uppercase rounded-lg shadow-lg">
                                            {propertyData.tags?.[0] || 'Hostel'}
                                        </span>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <h3 className="text-xl font-black text-gray-900 mb-2">{propertyData.title}</h3>
                                    <div className="flex items-start gap-2 text-gray-400 mb-4">
                                        <FaMapMarkerAlt className="mt-1 shrink-0" size={14} />
                                        <p className="text-[13px] font-bold leading-tight">{propertyData.address.text}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mb-6">
                                        <div className="bg-gray-50 p-3 rounded-2xl flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500">
                                                <FaUtensils size={14} />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black text-gray-400 uppercase leading-none mb-1">Food</p>
                                                <p className="text-[13px] font-black text-gray-900 leading-none">Included</p>
                                            </div>
                                        </div>
                                        <div className="bg-gray-50 p-3 rounded-2xl flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500">
                                                <FaWifi size={14} />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black text-gray-400 uppercase leading-none mb-1">Wifi</p>
                                                <p className="text-[13px] font-black text-gray-900 leading-none">Free</p>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setShowPGInfo(false);
                                            toast.success('Redirecting to property details...');
                                            if (propertyData?.propertyId) {
                                                navigate(`/property/${propertyData.propertyId}`);
                                            }
                                        }}
                                        className="w-full h-[48px] bg-blue-600 text-white font-black rounded-2xl shadow-lg shadow-blue-200 active:scale-95 transition-all uppercase tracking-widest text-[13px]"
                                    >
                                        View Full Details
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="p-12 flex flex-col items-center">
                                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Loading Details...</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatConversation;

