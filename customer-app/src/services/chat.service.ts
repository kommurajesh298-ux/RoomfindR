import { supabase } from './supabase-config';
import type { Chat, Message } from '../types/chat.types';
import { deferRealtimeSubscription } from './realtime-subscription';
import { invokeProtectedEdgeFunction } from './protected-edge.service';

interface PresenceState { presence_ref: string; user_id?: string; is_typing?: boolean }
interface CallData { id: string; chatId: string; participants: string[] }
interface DatabaseRow { [key: string]: unknown }
type ChatSnapshotPayload = {
    success?: boolean;
    chat?: DatabaseRow | null;
    messages?: DatabaseRow[];
};

const directChatRequests = new Map<string, Promise<string>>();
const communityChatRequests = new Map<string, Promise<string>>();
const chatSchemaSupport = {
    unreadCounts: null as boolean | null,
};

const isMissingChatUnreadCountsError = (error: unknown) => {
    const code = String((error as { code?: string } | null)?.code || '').trim();
    const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
    return code === '42703'
        || code === 'PGRST204'
        || message.includes('unread_counts')
        || message.includes('schema cache');
};

const buildDirectChatKey = (user1Id: string, user2Id: string) =>
    [user1Id, user2Id].sort().join(':');

const buildCommunityChatKey = (propertyId: string, userId: string) =>
    `${propertyId}:${userId}`;

const withInflightRequest = (
    store: Map<string, Promise<string>>,
    key: string,
    factory: () => Promise<string>,
): Promise<string> => {
    const existing = store.get(key);
    if (existing) return existing;

    const request = factory().finally(() => {
        store.delete(key);
    });

    store.set(key, request);
    return request;
};

const getFallbackUnreadCount = async (userId: string): Promise<number> => {
    const { data: chats, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .contains('participants', [userId]);

    if (chatError) {
        console.error('[ChatService] Failed to fetch chat ids for unread fallback:', chatError);
        return 0;
    }

    const chatIds = (chats || [])
        .map((chat) => String(chat.id || '').trim())
        .filter(Boolean);

    if (chatIds.length === 0) {
        return 0;
    }

    const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('chat_id', chatIds)
        .neq('sender_id', userId)
        .eq('is_read', false);

    if (error) {
        console.error('[ChatService] Failed to fetch unread fallback count:', error);
        return 0;
    }

    return Number(count || 0);
};

const getUnreadCountFromChats = async (userId: string): Promise<number | null> => {
    const { data, error } = await supabase
        .from('chats')
        .select('id, unread_counts')
        .contains('participants', [userId]);

    if (error) {
        if (isMissingChatUnreadCountsError(error)) {
            return null;
        }

        console.error('[ChatService] Failed to fetch unread chat counters:', error);
        return 0;
    }

    return (data || []).reduce((sum, chat) => (
        sum + Number((chat.unread_counts as Record<string, number> | null | undefined)?.[userId] || 0)
    ), 0);
};

export const chatService = {
    getTotalUnreadCount: async (userId: string): Promise<number> => {
        const unreadFromChats = await getUnreadCountFromChats(userId);
        if (unreadFromChats !== null) {
            chatSchemaSupport.unreadCounts = true;
            return unreadFromChats;
        }

        // Hosted fallback for projects that still lack unread_counts.
        chatSchemaSupport.unreadCounts = false;
        return getFallbackUnreadCount(userId);
    },

    getChatById: async (chatId: string): Promise<Chat | null> => {
        const { data, error } = await supabase
            .from('chats')
            .select('*')
            .eq('id', chatId)
            .maybeSingle();

        if (error) {
            console.error('[ChatService] Failed to fetch chat details:', error);
            return null;
        }

        return data ? chatService.mapToChat(data) : null;
    },

    getProtectedChatSnapshot: async (chatId: string): Promise<{ chat: Chat | null; messages: Message[] }> => {
        const payload = await invokeProtectedEdgeFunction<ChatSnapshotPayload>(
            'get-chat-snapshot',
            { chatId },
            'Unable to load conversation',
            { minValidityMs: 0 }
        );

        return {
            chat: payload.chat ? chatService.mapToChat(payload.chat) : null,
            messages: (payload.messages || []).map((message) => chatService.mapToMessage(message)),
        };
    },

    getOrCreateChat: async (user1Id: string, user2Id: string): Promise<string> => {
        return withInflightRequest(directChatRequests, buildDirectChatKey(user1Id, user2Id), async () => {
            const { data: existing } = await supabase.from('chats').select('id, participants').contains('participants', [user1Id, user2Id]);
            const chat = existing?.find(c => c.participants.length === 2 && c.participants.includes(user1Id) && c.participants.includes(user2Id));
            if (chat) return chat.id;
            const { data: newChat, error } = await supabase.from('chats').insert({ participants: [user1Id, user2Id] }).select().maybeSingle();
            if (error || !newChat) throw error || new Error('Failed to create chat');
            return newChat.id;
        });
    },

    getOrCreateCommunityChat: async (propertyId: string, propertyTitle: string, userId: string): Promise<string> => {
        return withInflightRequest(communityChatRequests, buildCommunityChatKey(propertyId, userId), async () => {
            const fetchChat = async () => supabase.from('chats')
                .select('id, participants')
                .eq('property_id', propertyId)
                .maybeSingle();

            const { data: initialChat, error: initialError } = await fetchChat();
            let chat = initialChat;
            if (initialError) {
                console.error('[ChatService] Error in initial community chat lookup:', initialError);
                throw initialError;
            }

            if (!chat) {
                const { data: newChat, error: insertError } = await supabase.from('chats')
                    .insert({
                        property_id: propertyId,
                        participants: [userId],
                        last_message: `Welcome to ${propertyTitle}`
                    })
                    .select('id, participants')
                    .maybeSingle();

                if (insertError) {
                    if (insertError.code === '23505') {
                        for (let attempt = 1; attempt <= 3; attempt++) {
                            await new Promise(r => setTimeout(r, 400 * attempt));
                            const { data: retryData } = await fetchChat();
                            if (retryData) {
                                chat = retryData;
                                break;
                            }
                        }

                        if (!chat) {
                            throw new Error(`The community chat for "${propertyTitle}" exists but is hidden by security policies. A database administrator needs to update the RLS policies.`);
                        }
                    } else {
                        console.error('[ChatService] Insert failed with non-conflict error:', insertError);
                        throw insertError;
                    }
                } else if (newChat) {
                    chat = newChat;
                } else {
                    const { data: finalRefetch } = await fetchChat();
                    chat = finalRefetch;
                }
            }

            if (chat) {
                if (!chat.participants.includes(userId)) {
                    const { error: updateError } = await supabase.from('chats')
                        .update({ participants: [...chat.participants, userId] })
                        .eq('id', chat.id);
                    if (updateError) {
                        console.error('[ChatService] Failed to update participants:', updateError);
                        throw new Error(`Failed to join community chat: ${updateError.message}. Please ensure you have run the RLS fix.`);
                    }
                }
                return chat.id;
            }

            console.error('[ChatService] Terminal failure: Could not find or create community chat for property:', propertyId);
            throw new Error(`Failed to initialize community chat for "${propertyTitle}". Please try refreshing.`);
        });
    },

    sendMessage: async (chatId: string, message: Omit<Message, 'id' | 'ts'>): Promise<void> => {
        const { error } = await supabase.from('messages').insert({
            chat_id: chatId,
            sender_id: message.senderId,
            content: message.text,
            message_type: message.type || 'text',
            image_url: message.imageUrl
        });
        if (error) throw error;
        await supabase.from('chats').update({ last_message: message.text, last_message_time: new Date().toISOString() }).eq('id', chatId);
    },

    subscribeToChats: (userId: string, callback: (chats: Chat[]) => void): (() => void) => {
        const syncChats = async () => {
            const { data } = await supabase.from('chats').select('*').contains('participants', [userId]);
            if (data) callback(data.map(c => chatService.mapToChat(c)));
        };

        void syncChats();

        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(`chats-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, async () => {
                await syncChats();
            }).subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    void syncChats();
                }
            });
            return () => supabase.removeChannel(channel);
        });
        return () => unsubscribeRealtime();
    },

    subscribeToMessages: (chatId: string, callback: (messages: Message[]) => void): (() => void) => {
        const syncMessages = async () => {
            const { data } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: false })
                .limit(50);

            if (data) {
                callback(data.map(m => chatService.mapToMessage(m)));
            }
        };

        void syncMessages();

        const channel = supabase.channel(`msgs-${chatId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, async () => {
            await syncMessages();
        }).subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                void syncMessages();
            }
        });
        return () => supabase.removeChannel(channel);
    },

    subscribeToChat: (chatId: string, callback: (chat: Chat | null) => void): (() => void) => {
        const syncChat = async () => {
            const chat = await chatService.getChatById(chatId);
            callback(chat);
        };

        void syncChat();

        const channel = supabase.channel(`chat-meta-${chatId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chats', filter: `id=eq.${chatId}` }, async () => {
                await syncChat();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    void syncChat();
                }
            });

        return () => supabase.removeChannel(channel);
    },

    markAsRead: async (chatId: string, userId: string): Promise<void> => {
        await supabase.from('messages').update({ is_read: true }).eq('chat_id', chatId).neq('sender_id', userId).eq('is_read', false);
    },

    markNotificationAsRead: async (userId: string, notificationId: string): Promise<void> => {
        await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId).eq('user_id', userId);
    },

    setTypingStatus: async (chatId: string, userId: string, isTyping: boolean) => {
        const channel = supabase.channel(`typing-${chatId}`); await channel.subscribe();
        await channel.track({ user_id: userId, is_typing: isTyping });
    },

    subscribeToTypingStatus: (chatId: string, callback: (typing: Record<string, boolean>) => void) => {
        const channel = supabase.channel(`typing-${chatId}`);
        channel.on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState(); const typing: Record<string, boolean> = {};
            Object.values(state).flat().forEach((p: PresenceState) => {
                if (p.user_id && p.is_typing !== undefined) typing[p.user_id] = p.is_typing;
            });
            callback(typing);
        }).subscribe();
        return () => supabase.removeChannel(channel);
    },

    subscribeToChatPresence: (chatId: string, userId: string, callback: (onlineUserIds: string[]) => void) => {
        const channel = supabase.channel(`chat-presence-${chatId}`, {
            config: {
                presence: {
                    key: `${chatId}:${userId}`
                }
            }
        });

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const onlineUsers = new Set<string>();

                Object.values(state).flat().forEach((presence) => {
                    const item = presence as PresenceState;
                    if (item.user_id) {
                        onlineUsers.add(String(item.user_id));
                    }
                });

                callback(Array.from(onlineUsers));
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_id: userId,
                        online_at: new Date().toISOString()
                    });
                }
            });

        return () => {
            void channel.untrack();
            void supabase.removeChannel(channel);
        };
    },

    getMoreMessages: async (chatId: string, beforeTs: string): Promise<Message[]> => {
        const { data, error } = await supabase.from('messages').select('*').eq('chat_id', chatId).lt('created_at', beforeTs).order('created_at', { ascending: false }).limit(20);
        if (error) throw error;
        return (data || []).map(m => chatService.mapToMessage(m));
    },

    deleteChat: async (chatId: string): Promise<void> => {
        // 1. Delete messages
        const { error: msgError } = await supabase
            .from('messages')
            .delete({ count: 'exact' })
            .eq('chat_id', chatId);

        if (msgError) {
            console.error('[ChatService] Error deleting messages:', msgError);
            throw msgError;
        }

        // 2. Delete chat record
        const { error: chatError, count: chatCount } = await supabase
            .from('chats')
            .delete({ count: 'exact' })
            .eq('id', chatId);

        if (chatError) {
            console.error('[ChatService] Error deleting chat row:', chatError);
            throw chatError;
        }

        if (chatCount === 0) {
            console.warn('[ChatService] No chat rows deleted. This likely means you do not have RLS permission to delete this chat.');
            throw new Error('You do not have permission to delete this conversation.');
        }
    },

    muteChat: async (chatId: string, userId: string, isMuted: boolean): Promise<void> => {
        const { data: chat } = await supabase.from('chats').select('muted_users').eq('id', chatId).single();
        let mutedUsers = (chat?.muted_users as string[]) || [];

        if (isMuted) {
            if (!mutedUsers.includes(userId)) mutedUsers.push(userId);
        } else {
            mutedUsers = mutedUsers.filter(id => id !== userId);
        }

        const { error } = await supabase.from('chats').update({ muted_users: mutedUsers }).eq('id', chatId);
        if (error) throw error;
    },

    uploadChatImage: async (chatId: string, userId: string, file: File): Promise<{ url: string; path: string; sizeMB: number; }> => {
        const fileExt = file.name.split('.').pop() || 'jpg';
        const fileName = `${chatId}/${userId}-${Date.now()}.${fileExt}`;
        const { error } = await supabase.storage.from('chat-media').upload(fileName, file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(fileName);
        return { url: urlData.publicUrl, path: fileName, sizeMB: file.size / (1024 * 1024) };
    },

    formatMessageDate: (dateStr: string): string => {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const today = new Date();
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    // Call stubs - intentionally not implemented

    subscribeToGroupCall: (_chatId: string, _callback: (call: CallData) => void) => () => { /* stub */ },

    startGroupCall: async (_chatId: string, _userId: string, _name: string) => { /* stub */ },

    joinGroupCall: async (_chatId: string, _userId: string) => { /* stub */ },

    endGroupCall: async (_chatId: string) => { /* stub */ },

    updateCallSignal: async (_chatId: string, _userId: string, _signal: unknown) => { /* stub */ },

    subscribeToCallSignals: (_chatId: string, _callback: (signals: unknown[]) => void) => () => { /* stub */ },

    // Storage stubs - intentionally not implemented

    getStorageUsage: async (_userId: string) => 0,

    getChatMedia: async (_chatId: string) => [] as Message[],

    deleteMedia: async (_chatId: string, _userId: string, _message: Message) => { /* stub */ },

    subscribeToTotalUnread: (userId: string, callback: (count: number) => void) => {
        void chatService.getTotalUnreadCount(userId).then(callback);

        const unsubscribe = chatService.subscribeToChats(userId, (chats) => {
            if (chatSchemaSupport.unreadCounts === false) {
                void getFallbackUnreadCount(userId).then(callback);
                return;
            }
            const total = chats.reduce((sum, chat) => sum + (chat.unreadCounts[userId] || 0), 0);
            callback(total);
        });
        return unsubscribe;
    },

    mapToChat: (data: DatabaseRow): Chat => ({
        chatId: String(data.id),
        participants: (data.participants as string[]) || [],
        isCommunity: !!data.property_id,
        propertyId: data.property_id ? String(data.property_id) : undefined,
        unreadCounts: (data.unread_counts as Record<string, number>) || {},
        lastMessage: data.last_message ? {
            text: String(data.last_message),
            senderId: '',
            timestamp: String(data.last_message_time || data.updated_at)
        } : null,
        updatedAt: String(data.updated_at),
        createdAt: String(data.created_at),
        title: data.title ? String(data.title) : undefined,
    }),

    mapToMessage: (data: DatabaseRow): Message => ({
        id: String(data.id),
        senderId: String(data.sender_id),
        text: String(data.content || data.text || ''),
        type: (data.message_type || data.type || 'text') as 'text' | 'image',
        imageUrl: data.image_url ? String(data.image_url) : undefined,
        read: Boolean(data.is_read || data.read),
        ts: String(data.created_at)
    })
};
