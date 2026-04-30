import React, { useState, useEffect, useRef } from 'react';
import { ticketService, type TicketReply, type Ticket } from '../../services/ticket.service';
import { FiUser, FiInfo } from 'react-icons/fi';
import { format } from 'date-fns';

interface OwnerChatConversationProps {
    chatId: string; // This is now ticketId
    currentUserId: string;
    title?: string;
}

const OwnerChatConversation: React.FC<OwnerChatConversationProps> = ({ chatId: ticketId, currentUserId, title }) => {
    const [replies, setReplies] = useState<TicketReply[]>([]);
    const [ticket, setTicket] = useState<Ticket | null>(null);

    const [loading, setLoading] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);


    useEffect(() => {
        setLoading(true);

        // Fetch ticket details
        // Fetch ticket details
        ticketService.getTicketById(ticketId).then(setTicket).catch(() => setTicket(null));

        const unsubscribe = ticketService.subscribeToReplies(ticketId, (data) => {
            setReplies(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [ticketId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [replies]);

    /* handleSend removed as owner cannot reply */

    return (
        <div className="flex flex-col h-full bg-white overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100 text-gray-600">
                        <FiUser size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900 leading-tight pr-2">
                            {title || 'Support Ticket'}
                        </h3>
                        {ticket && (
                            <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    Status: {ticket.status}
                                </p>
                                <span className={`w-1.5 h-1.5 rounded-full ${ticket.status === 'open' ? 'bg-blue-500' : 'bg-gray-400'}`}></span>
                            </div>
                        )}
                    </div>
                </div>
                <button className="p-2 text-gray-400 hover:text-black transition-colors rounded-lg hover:bg-gray-50">
                    <FiInfo size={18} />
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto bg-gray-50/30 custom-scrollbar">
                {loading ? (
                    <div className="flex justify-center items-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
                    </div>
                ) : (
                    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
                        {/* Initial Description */}
                        {ticket && (
                            <div className="flex gap-4 relative z-10">
                                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm border bg-white text-gray-600 border-gray-100">
                                    <FiUser size={20} />
                                </div>
                                <div className="flex-1 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black uppercase tracking-widest text-gray-900">
                                                Initial Request
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-400 uppercase">
                                            {format(new Date(ticket.created_at), 'MMM d, h:mm a')}
                                        </span>
                                    </div>
                                    <div className="text-sm font-medium text-gray-800 whitespace-pre-wrap leading-relaxed italic">
                                        {ticket.description}
                                    </div>
                                </div>
                            </div>
                        )}

                        {replies.map((reply) => {
                            const isMe = reply.sender_id === currentUserId;
                            return (
                                <div key={reply.id} className="relative">
                                    <div className="flex gap-4 relative z-10">
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm border ${isMe ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-100'
                                            }`}>
                                            <FiUser size={20} />
                                        </div>

                                        <div className="flex-1 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-black uppercase tracking-widest text-gray-900">
                                                        {isMe ? 'You' : 'Platform Support'}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase">
                                                    {format(new Date(reply.created_at), 'MMM d, h:mm a')}
                                                </span>
                                            </div>

                                            <div className="text-sm font-medium text-gray-800 whitespace-pre-wrap leading-relaxed">
                                                {reply.content}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Resolution Actions - Only show if ticket is open and last message is from admin */}
            {ticket?.status === 'open' && replies.length > 0 && replies[replies.length - 1].sender_id !== currentUserId && (
                <div className="p-4 md:p-6 bg-white border-t border-gray-100 shrink-0">
                    <div className="max-w-4xl mx-auto">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Was your issue resolved?</h4>
                        <div className="flex gap-4">
                            <button
                                onClick={async () => {
                                    try {
                                        if (ticket) {
                                            await ticketService.updateStatus(ticketId, 'closed');
                                            // Optimistic update
                                            setTicket({ ...ticket, status: 'closed' });
                                        }
                                    } catch (error) {
                                        console.error('Failed to resolve ticket:', error);
                                    }
                                }}
                                className="flex-1 py-3 px-6 bg-blue-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-100 hover:bg-blue-600 transition-all active:scale-95"
                            >
                                Yes, Issue Resolved
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        await ticketService.addReply({
                                            ticket_id: ticketId,
                                            sender_id: currentUserId,
                                            content: 'I still have doubts regarding this issue.'
                                        });
                                        // Reply will be added via subscription
                                    } catch (error) {
                                        console.error('Failed to send follow-up:', error);
                                    }
                                }}
                                className="flex-1 py-3 px-6 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all active:scale-95"
                            >
                                No, I have questions
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OwnerChatConversation;

