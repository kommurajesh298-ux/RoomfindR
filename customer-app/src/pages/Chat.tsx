import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { chatService } from '../services/chat.service';
import { userService } from '../services/user.service';
import type { UserData } from '../services/user.service';
import type { Chat as ChatType } from '../types/chat.types';
import ChatSidebar from '../components/chat/ChatSidebar';
import ChatConversation from '../components/chat/ChatConversation';
import ResidentPortal, { type ResidentPortalTabId } from '../components/chat/ResidentPortal';
import LoadingOverlay from '../components/common/LoadingOverlay';
import { bookingService } from '../services/booking.service';
import type { Booking } from '../types/booking.types';
import PaymentResultOverlay from '../components/payments/PaymentResultOverlay';
import { resolvePaymentResolution } from '../utils/payment-resolution';
import {
    buildPaymentFailureRedirect,
    buildPaymentSuccessRedirect,
} from '../utils/payment-result-route';

const PAYMENT_RESULT_DISMISS_KEY = 'roomfindr_customer_payment_result_dismiss_key';

const Chat: React.FC = () => {
    const { chatId: urlChatId } = useParams<{ chatId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { currentUser } = useAuth();
    const [chats, setChats] = useState<ChatType[]>([]);
    const [selectedChatFallback, setSelectedChatFallback] = useState<ChatType | null>(null);
    const [selectedChatIdLocal, setSelectedChatIdLocal] = useState<string | null>(null);
    const selectedChatId = urlChatId || selectedChatIdLocal;
    const [selectedOtherUser, setSelectedOtherUser] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeStay, setActiveStay] = useState<Booking | null>(null);
    const [viewMode, setViewMode] = useState<'chats' | 'portal'>('chats');
    const portalTabParam = String(searchParams.get('portalTab') || '').toLowerCase();
    const paymentResult = String(searchParams.get('payment_result') || '').toLowerCase();
    const paymentMessage = String(searchParams.get('payment_message') || '').trim();
    const paymentContext = String(searchParams.get('payment_context') || '').toLowerCase();
    const paymentOrderId = String(searchParams.get('order_id') || '').trim();
    const paymentBookingId = String(searchParams.get('booking_id') || '').trim();
    const paymentMonth = String(searchParams.get('month') || '').trim();
    const portalTab = (['mypg', 'room', 'food', 'notices', 'payments', 'community'].includes(portalTabParam)
        ? portalTabParam
        : null) as ResidentPortalTabId | null;
    const [activePortalTab, setActivePortalTab] = useState<ResidentPortalTabId>(portalTab || 'mypg');
    const resolvedPortalTab = portalTab || activePortalTab;
    const selectedChat = useMemo(
        () => chats.find((chat) => chat.chatId === selectedChatId)
            || (selectedChatFallback?.chatId === selectedChatId ? selectedChatFallback : null),
        [chats, selectedChatFallback, selectedChatId]
    );
    const showExplorePgPrompt = !activeStay && chats.length === 0 && !selectedChat;
    const isPortalPage = viewMode === 'portal' && Boolean(activeStay) && !selectedChatId;
    const shouldLockViewport = Boolean(selectedChatId) || (viewMode === 'portal' && activePortalTab === 'community');
    const paymentFlowKey = React.useMemo(() => {
        if (!paymentBookingId) return '';
        return [
            paymentContext || 'rent',
            paymentBookingId,
            paymentOrderId || 'no-order',
            paymentMonth || 'no-month',
        ].join(':');
    }, [paymentBookingId, paymentContext, paymentMonth, paymentOrderId]);
    const [dismissedPaymentFlowKey, setDismissedPaymentFlowKey] = useState('');
    const rememberedDismissedPaymentFlowKey = useMemo(() => {
        if (!paymentFlowKey || typeof window === 'undefined') return '';

        try {
            const rememberedKey = window.sessionStorage.getItem(PAYMENT_RESULT_DISMISS_KEY) || '';
            return rememberedKey === paymentFlowKey ? rememberedKey : '';
        } catch {
            return '';
        }
    }, [paymentFlowKey]);
    const activeDismissedPaymentFlowKey = dismissedPaymentFlowKey === paymentFlowKey
        ? dismissedPaymentFlowKey
        : rememberedDismissedPaymentFlowKey;
    const showPaymentResultOverlay = (
        paymentResult === 'success' || paymentResult === 'failed'
    ) && activeDismissedPaymentFlowKey !== paymentFlowKey;
    const paymentOverlayTitle = paymentResult === 'success'
        ? 'Payment Successful'
        : 'Payment Failed';
    const paymentOverlayMessage = paymentMessage || (
        paymentResult === 'success'
            ? 'Your rent payment was received successfully.'
            : 'Your rent payment could not be completed. Please try again.'
    );

    useEffect(() => {
        if (paymentResult === 'success' || paymentResult === 'failed') return;
        if (portalTabParam !== 'payments') return;
        if (!paymentBookingId) return;
        if (activeDismissedPaymentFlowKey && activeDismissedPaymentFlowKey === paymentFlowKey) return;

        let cancelled = false;

        const recoverRentResult = async () => {
            const resolution = await resolvePaymentResolution({
                bookingId: paymentBookingId,
                orderId: paymentOrderId || undefined,
                defaultIsRentPayment: true,
                verify: true,
                metadata: /^\d{4}-\d{2}$/.test(paymentMonth) ? { month: paymentMonth } : undefined,
            });

            if (cancelled) return;

            if (resolution.status === 'paid') {
                navigate(buildPaymentSuccessRedirect({
                    bookingId: resolution.bookingId || paymentBookingId,
                    app: 'customer',
                    isRentPayment: true,
                    message: 'Rent payment received successfully.',
                    context: 'rent',
                }), { replace: true });
                return;
            }

            if (resolution.status === 'failed') {
                navigate(buildPaymentFailureRedirect({
                    bookingId: resolution.bookingId || paymentBookingId,
                    app: 'customer',
                    isRentPayment: true,
                    context: paymentContext || 'rent',
                    message: 'Rent payment was cancelled or failed. Please try again.',
                }), { replace: true });
            }
        };

        void recoverRentResult();

        return () => {
            cancelled = true;
        };
    }, [
        navigate,
        activeDismissedPaymentFlowKey,
        paymentBookingId,
        paymentContext,
        paymentMonth,
        paymentOrderId,
        paymentFlowKey,
        paymentResult,
        portalTabParam,
    ]);

    useEffect(() => {
        if (!currentUser) return;

        const unsubscribeBookings = bookingService.subscribeToCustomerBookings(currentUser.id, (bookings) => {
            // Prioritize status: checked-in > active > paid > approved/confirmed > accepted
            const sorted = [...bookings].sort((a, b) => {
                const order: Record<string, number> = {
                    'checked-in': 0, 'checked_in': 0, 'active': 0,
                    'paid': 1,
                    'approved': 2,
                    'confirmed': 2,
                    'accepted': 3,
                    'pending': 4
                };
                return (order[a.status] ?? 5) - (order[b.status] ?? 5);
            });
            const stay = sorted[0];
            // STRICT PORTAL ACCESS: Only after check-in
            if (stay && ['checked-in', 'checked_in', 'active', 'ONGOING'].includes(stay.status)) {
                setActiveStay(stay);
                // Default to portal if there's a checked-in stay and no specific chat selected
                if (!urlChatId) setViewMode('portal');
            } else {
                setActiveStay(null);
                setViewMode('chats');
            }
        });

        const unsubscribeChats = chatService.subscribeToChats(currentUser.id, (updatedChats) => {
            setChats(updatedChats);
            setLoading(false);
        });

        return () => {
            unsubscribeBookings();
            unsubscribeChats();
        };
    }, [currentUser, urlChatId]);

    useEffect(() => {
        if (!selectedChatId || !currentUser) {
            setSelectedChatFallback(null);
            return;
        }

        if (chats.some((chat) => chat.chatId === selectedChatId)) {
            setSelectedChatFallback(null);
            return;
        }

        let cancelled = false;

        const hydrateSelectedChat = async () => {
            const snapshot = await chatService.getProtectedChatSnapshot(selectedChatId).catch(() => null);
            const fallbackChat = snapshot?.chat || await chatService.getChatById(selectedChatId);
            if (cancelled) return;

            if (fallbackChat && fallbackChat.participants.includes(currentUser.id)) {
                setSelectedChatFallback(fallbackChat);
                setLoading(false);
                return;
            }

            setSelectedChatFallback(null);
        };

        void hydrateSelectedChat();

        return () => {
            cancelled = true;
        };
    }, [chats, currentUser, selectedChatId]);

    useEffect(() => {
        const fetchOtherUser = async () => {
            if (selectedChatId && currentUser) {
                const currentChat = chats.find(c => c.chatId === selectedChatId)
                    || (selectedChatFallback?.chatId === selectedChatId ? selectedChatFallback : null);
                if (currentChat) {
                    const otherUserId = currentChat.participants.find(id => id !== currentUser.id);
                    if (otherUserId) {
                        const userData = await userService.getUserDocument(otherUserId);
                        setSelectedOtherUser(userData);
                    }
                }
            } else {
                setSelectedOtherUser(null);
            }
        };
        fetchOtherUser();
    }, [selectedChatFallback, selectedChatId, chats, currentUser]);

    useEffect(() => {
        if (!shouldLockViewport) return undefined;

        const html = document.documentElement;
        const body = document.body;
        const main = document.querySelector('main');
        const previousHtmlOverflow = html.style.overflow;
        const previousBodyOverflow = body.style.overflow;
        const previousMainOverflow = main instanceof HTMLElement ? main.style.overflow : '';

        html.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
        if (main instanceof HTMLElement) {
            main.style.overflow = 'hidden';
        }

        return () => {
            html.style.overflow = previousHtmlOverflow;
            body.style.overflow = previousBodyOverflow;
            if (main instanceof HTMLElement) {
                main.style.overflow = previousMainOverflow;
            }
        };
    }, [shouldLockViewport]);

    const handleSelectChat = (id: string) => {
        setSelectedChatIdLocal(id);
        setViewMode('chats');
        navigate(`/chat/${id}`);
    };

    const handleBack = () => {
        setSelectedChatIdLocal(null);
        if (activeStay) {
            setViewMode('portal');
        } else {
            setViewMode('chats');
        }
        navigate('/chat');
    };

    const handleExplorePg = () => {
        navigate('/explore');
    };

    const clearPaymentResultParams = React.useCallback(() => {
        if (paymentFlowKey) {
            setDismissedPaymentFlowKey(paymentFlowKey);
            try {
                window.sessionStorage.setItem(PAYMENT_RESULT_DISMISS_KEY, paymentFlowKey);
            } catch {
                // Ignore session storage availability issues.
            }
        }

        const params = new URLSearchParams(searchParams);
        ['payment_result', 'payment_message', 'payment_context', 'app'].forEach((key) => params.delete(key));
        const next = params.toString();
        navigate(next ? `/chat?${next}` : '/chat', { replace: true });
    }, [navigate, paymentFlowKey, searchParams]);

    const handlePortalTabChange = React.useCallback((tab: ResidentPortalTabId) => {
        setActivePortalTab(tab);

        const params = new URLSearchParams(searchParams);
        params.delete('portalTab');
        params.delete('payment_result');
        params.delete('payment_message');
        params.delete('payment_context');
        params.delete('app');

        const next = params.toString();
        navigate(next ? `/chat?${next}` : '/chat', { replace: true });
    }, [navigate, searchParams]);

    if (!currentUser) return null;
    if (loading && chats.length === 0 && !selectedChat) return <LoadingOverlay />;
    if (isPortalPage && activePortalTab !== 'community' && activeStay) {
        return (
            <div className="relative z-[50] overflow-x-hidden bg-[#F8FAFC] font-['Inter',_sans-serif]">
                <ResidentPortal
                    booking={activeStay}
                    currentUser={currentUser}
                    initialTab={resolvedPortalTab}
                    onActiveTabChange={handlePortalTabChange}
                />
                <PaymentResultOverlay
                    open={showPaymentResultOverlay}
                    variant={paymentResult === 'success' ? 'success' : 'failed'}
                    title={paymentOverlayTitle}
                    message={paymentOverlayMessage}
                    onClose={clearPaymentResultParams}
                />
            </div>
        );
    }

    return (
        <div className={`relative z-[50] flex overflow-x-hidden bg-[#F8FAFC] font-['Inter',_sans-serif] ${shouldLockViewport
            ? 'h-[calc(100dvh-76px)] min-h-0 overflow-hidden md:h-[calc(100vh-73px)]'
            : 'min-h-[calc(100dvh-76px)] overflow-visible md:min-h-[calc(100vh-73px)]'
            }`}>
            <div className={`flex w-full flex-1 overflow-x-hidden ${shouldLockViewport ? 'min-h-0 overflow-hidden' : 'overflow-visible'}`}>
                {/* Conversations List (Mobile: Hidden if chat/portal open) */}
                <div className={`${(selectedChatId || viewMode === 'portal') ? 'hidden' : 'flex'} z-20 h-full min-h-0 w-full shrink-0 flex-col border-r border-gray-100 bg-white md:flex md:w-[320px] lg:w-[380px]`}>
                    {activeStay && (
                        <div className="flex p-3 bg-white border-b border-gray-100 gap-2 shrink-0">
                            <button
                                onClick={() => { setViewMode('portal'); setSelectedChatIdLocal(null); navigate('/chat'); }}
                                className={`flex-1 h-[44px] rounded-[12px] text-[13px] font-bold transition-all ${viewMode === 'portal' && !selectedChatId ? 'bg-[#2563eb] text-white shadow-md' : 'bg-gray-50 text-[#6B7280]'}`}
                            >
                                Resident Portal
                            </button>
                            <button
                                onClick={() => { setViewMode('chats'); setSelectedChatIdLocal(null); navigate('/chat'); }}
                                className={`flex-1 h-[44px] rounded-[12px] text-[13px] font-bold transition-all ${viewMode === 'chats' && !selectedChatId ? 'bg-[#2563eb] text-white shadow-md' : 'bg-gray-50 text-[#6B7280]'}`}
                            >
                                Messages
                            </button>
                        </div>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
                        <ChatSidebar
                            chats={chats}
                            selectedChatId={selectedChatId}
                            onSelectChat={handleSelectChat}
                            currentUserId={currentUser.id!}
                            showExploreAction={showExplorePgPrompt}
                            onExplorePg={handleExplorePg}
                        />
                    </div>
                </div>

                {/* Content Area */}
                <div className={`${(!selectedChatId && viewMode !== 'portal') ? 'hidden' : 'flex'} relative flex-1 flex-col overflow-x-hidden bg-white md:flex ${shouldLockViewport ? 'h-full min-h-0 overflow-hidden' : 'min-h-full overflow-visible'}`}>
                    {selectedChatId ? (
                        <ChatConversation
                            chatId={selectedChatId}
                            currentUserId={currentUser.id}
                            otherUser={selectedOtherUser || undefined}
                            title={selectedChat?.title}
                            fallbackLastMessage={selectedChat?.lastMessage?.text}
                            onBack={handleBack}
                        />
                    ) : viewMode === 'portal' && activeStay ? (
                        <ResidentPortal
                            booking={activeStay}
                            currentUser={currentUser}
                            initialTab={resolvedPortalTab}
                            onActiveTabChange={handlePortalTabChange}
                        />
                    ) : (
                        <div className="hidden md:flex flex-1 flex-col items-center justify-center p-12 text-center bg-gray-50">
                            <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 ${showExplorePgPrompt ? 'bg-orange-50' : 'bg-blue-50'}`}>
                                <svg className={`w-10 h-10 ${showExplorePgPrompt ? 'text-[#F97316]' : 'text-[#2563eb]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showExplorePgPrompt ? 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01' : 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'} />
                                </svg>
                            </div>
                            <h2 className="text-[20px] font-bold text-[#111827] mb-2 uppercase tracking-tight">
                                {showExplorePgPrompt ? 'Explore PGs' : 'Select a Conversation'}
                            </h2>
                            <p className="max-w-xs text-[#6B7280] text-[14px]">
                                {showExplorePgPrompt
                                    ? 'You are not staying in any PG right now. Explore available PGs to book a stay and unlock your portal.'
                                    : 'Choose a chat to start messaging or access your Resident Portal.'}
                            </p>
                            {showExplorePgPrompt && (
                                <button
                                    type="button"
                                    onClick={handleExplorePg}
                                    className="mt-6 inline-flex h-[46px] items-center justify-center rounded-[14px] bg-gradient-to-r from-orange-500 to-orange-600 px-6 text-[14px] font-bold text-white shadow-[0_12px_24px_rgba(249,115,22,0.24)] transition-all hover:-translate-y-[1px] hover:shadow-[0_16px_28px_rgba(249,115,22,0.32)]"
                                >
                                    Explore PGs
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <PaymentResultOverlay
                open={showPaymentResultOverlay}
                variant={paymentResult === 'success' ? 'success' : 'failed'}
                title={paymentOverlayTitle}
                message={paymentOverlayMessage}
                onClose={clearPaymentResultParams}
            />
        </div>
    );
};

export default Chat;
