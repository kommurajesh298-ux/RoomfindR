import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ticketService, type Ticket, type TicketReply } from '../services/ticket.service';
import { FiAlertCircle, FiMessageSquare, FiSearch, FiUser, FiHome } from 'react-icons/fi';
import { toast } from 'react-hot-toast';

const Tickets: React.FC = () => {
    // Tickets rendering
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [replies, setReplies] = useState<TicketReply[]>([]);
    const [replyContent, setReplyContent] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved' | 'closed'>('open');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const unsubscribe = ticketService.subscribeToAllTickets((data) => {
            setTickets(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!selectedTicket) {
            setReplies([]);
            return;
        }

        const unsubscribe = ticketService.subscribeToReplies(selectedTicket.id, (data) => {
            setReplies(data);
        });
        return () => unsubscribe();
    }, [selectedTicket]);

    const handleUpdateStatus = async (ticketId: string, status: Ticket['status']) => {
        try {
            await ticketService.updateTicketStatus(ticketId, status);
            toast.success(`Ticket marked as ${status}`);
        } catch (_error) {
            toast.error('Failed to update status');
        }
    };

    const { admin } = useAuth();

    const handleSendReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket || !replyContent.trim() || !admin) return;

        setIsSubmitting(true);
        try {
            await ticketService.addReply({
                ticket_id: selectedTicket.id,
                sender_id: admin.uid,
                content: replyContent.trim()
            });
            setReplyContent('');
        } catch (_error) {
            console.error(_error);
            toast.error('Failed to send reply');
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredTickets = tickets.filter(t => {
        const matchesSearch = t.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[var(--rf-color-action)]"></div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-[1400px] mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight">Support Management</h1>
                    <p className="text-gray-500 font-medium mt-1">Monitor and resolve user issues across the platform.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative">
                        <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            name="ticketSearch"
                            placeholder="Search tickets..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-12 pr-4 py-3.5 bg-white border border-gray-100 rounded-2xl w-full md:w-80 shadow-sm focus:ring-2 focus:ring-orange-100 focus:border-orange-500 transition-all font-medium"
                        />
                    </div>
                </div>
            </div>

            <div className="flex gap-4 p-1 bg-gray-100 w-fit rounded-2xl mb-8">
                {['open', 'resolved', 'closed'].map((s) => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s as 'all' | 'open' | 'resolved' | 'closed')}
                        className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${statusFilter === s ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        {s}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Tickets List */}
                <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-320px)] pr-2 no-scrollbar">
                    {filteredTickets.map((ticket) => (
                        <div
                            key={ticket.id}
                            onClick={() => setSelectedTicket(ticket)}
                            className={`p-6 rounded-[32px] border-2 transition-all cursor-pointer ${selectedTicket?.id === ticket.id ? 'bg-white border-orange-500 shadow-xl scale-[1.02]' : 'bg-white border-transparent hover:border-gray-100 shadow-sm'}`}
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${ticket.status === 'open' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                                        {ticket.status}
                                    </span>
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${ticket.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-400'}`}>
                                        {ticket.priority} Priority
                                    </span>
                                </div>
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                    {new Date(ticket.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-2 truncate">{ticket.subject}</h3>
                            <p className="text-sm text-gray-500 mb-6 line-clamp-2 leading-relaxed">"{ticket.description}"</p>

                            <div className="flex items-center gap-4 text-[10px] font-black text-gray-400 uppercase tracking-widest flex-wrap">
                                <span className="flex items-center gap-1.5" title={ticket.sender_email}>
                                    <FiUser size={12} className="text-orange-500" />
                                    {ticket.sender_name || ticket.creator_details?.fullName || 'User'}
                                    {ticket.creator_details?.role && ` (${ticket.creator_details.role.charAt(0).toUpperCase() + ticket.creator_details.role.slice(1)})`}
                                </span>
                                {ticket.sender_phone && (
                                    <span className="flex items-center gap-1.5">
                                        PH: {ticket.sender_phone}
                                    </span>
                                )}
                                {ticket.property_id && <span className="flex items-center gap-1.5"><FiHome size={12} className="text-blue-500" /> Prop: {ticket.property_id.slice(0, 8)}</span>}
                            </div>
                        </div>
                    ))}

                    {filteredTickets.length === 0 && (
                        <div className="text-center py-20 bg-white rounded-[40px] border-2 border-dashed border-gray-100">
                            <FiMessageSquare size={48} className="mx-auto text-gray-200 mb-4" />
                            <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">No tickets found</p>
                        </div>
                    )}
                </div>

                {/* Ticket Details / Conversation */}
                <div className="sticky top-8 h-[calc(100vh-200px)] flex flex-col">
                    {selectedTicket ? (
                        <div className="bg-white rounded-[40px] shadow-2xl border border-gray-100 flex flex-col h-full overflow-hidden">
                            {/* Conversation Header */}
                            <div className="p-8 border-b border-gray-50 bg-gray-50/50">
                                <div className="flex items-start justify-between mb-4">
                                    <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">{selectedTicket.subject}</h2>
                                    <div className="flex gap-2">
                                        {selectedTicket.status === 'open' ? (
                                            <button
                                                onClick={() => handleUpdateStatus(selectedTicket.id, 'resolved')}
                                                className="px-4 py-2 bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-blue-200 hover:scale-105 transition-all"
                                            >
                                                Resolve
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleUpdateStatus(selectedTicket.id, 'open')}
                                                className="px-4 py-2 bg-[var(--rf-color-action)] text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-orange-200 hover:scale-105 transition-all"
                                            >
                                                Reopen
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="mb-6 bg-gray-50/80 p-5 rounded-2xl border border-gray-100">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-lg">
                                            {(selectedTicket.sender_name?.[0] || selectedTicket.creator_details?.fullName?.[0] || '?').toUpperCase()}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-gray-900">
                                                {selectedTicket.sender_name || selectedTicket.creator_details?.fullName || 'Unknown User'}
                                            </h3>
                                            <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                                                <span className="capitalize">{selectedTicket.creator_details?.role || 'User'}</span>
                                                <span>â€¢</span>
                                                <span>{selectedTicket.sender_email || selectedTicket.creator_details?.email}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {selectedTicket.sender_phone && (
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Phone</p>
                                            <p className="text-xs font-bold text-gray-700 font-mono">{selectedTicket.sender_phone}</p>
                                        </div>
                                    )}
                                </div>
                                <p className="text-sm text-gray-600 italic border-l-2 border-orange-200 pl-4 py-1">"{selectedTicket.description}"</p>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
                                {replies.map((reply) => (
                                    <div key={reply.id} className={`flex flex-col ${reply.sender_id === 'admin' ? 'items-end' : 'items-start'}`}>
                                        <div className={`max-w-[80%] p-5 rounded-[26px] shadow-sm ${reply.sender_id === 'admin' ? 'bg-[var(--rf-color-action)] text-white rounded-tr-none' : 'bg-gray-100 text-gray-800 rounded-tl-none'}`}>
                                            <p className="text-sm font-medium leading-relaxed">{reply.content}</p>
                                        </div>
                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-2 px-1">
                                            {reply.sender_id === 'admin' ? 'You' : 'User'} â€¢ {new Date(reply.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                ))}
                                {replies.length === 0 && (
                                    <div className="h-full flex flex-col items-center justify-center opacity-30 grayscale">
                                        <FiMessageSquare size={64} className="mb-4 text-orange-200" />
                                        <p className="font-black text-xs uppercase tracking-[0.3em]">Be the first to reply</p>
                                    </div>
                                )}
                            </div>

                            {/* Reply Input */}
                            <div className="p-8 bg-white border-t border-gray-50">
                                <form onSubmit={handleSendReply} className="flex gap-4">
                                    <input
                                        type="text"
                                        name="ticketReply"
                                        placeholder="Type your response..."
                                        value={replyContent}
                                        onChange={(e) => setReplyContent(e.target.value)}
                                        className="flex-1 px-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:border-orange-500 outline-none transition-all font-medium text-sm"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || !replyContent.trim()}
                                        className="px-8 py-4 bg-gray-900 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-black transition-all shadow-xl shadow-gray-200 disabled:opacity-50 active:scale-95"
                                    >
                                        Send
                                    </button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full bg-orange-50/30 rounded-[40px] border-2 border-dashed border-orange-100 flex flex-col items-center justify-center p-12 text-center">
                            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-xl shadow-orange-200/50 mb-8">
                                <FiAlertCircle size={40} className="text-orange-400 animate-pulse" />
                            </div>
                            <h3 className="text-2xl font-black text-gray-900 tracking-tight mb-2">Select a Ticket</h3>
                            <p className="text-gray-500 font-medium max-w-xs">Pick a support request from the list to view details and start a conversation.</p>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};

export default Tickets;

