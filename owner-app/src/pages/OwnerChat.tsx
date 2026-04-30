import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { propertyService } from '../services/property.service';
import { ticketService, type Ticket } from '../services/ticket.service';
import type { Property } from '../types/property.types';
import { NoticesTab } from '../components/properties/NoticesTab';
import LoadingOverlay from '../components/common/LoadingOverlay';
import OwnerChatSidebar from '../components/chat/OwnerChatSidebar';
import OwnerChatConversation from '../components/chat/OwnerChatConversation';
import { FiHome, FiBell, FiMessageSquare, FiSend } from 'react-icons/fi';
import Modal from '../components/common/Modal';
import { toast } from 'react-hot-toast';

const OwnerChat: React.FC = () => {
    const { currentUser, ownerData } = useAuth();
    const [properties, setProperties] = useState<Property[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'notices' | 'tickets'>('tickets');
    const [loading, setLoading] = useState(true);
    const [showNewTicketModal, setShowNewTicketModal] = useState(false);
    const [ticketSubject, setTicketSubject] = useState('');
    const [ticketMessage, setTicketMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!currentUser) return;

        // Subscribe to properties
        const unsubscribeProps = propertyService.subscribeToOwnerProperties(currentUser.uid, (data) => {
            setProperties(data);
            // If there's only one property, auto-select it so notices work without extra clicks.
            if (data.length === 1 && !selectedPropertyId) {
                setSelectedPropertyId(data[0].propertyId);
            }
            setLoading(false);
        });

        // Subscribe to tickets
        const unsubscribeTickets = ticketService.subscribeToTickets(currentUser.uid, (data) => {
            setTickets(data);
        });

        return () => {
            unsubscribeProps();
            unsubscribeTickets();
        };
    }, [currentUser, selectedPropertyId]);

    const handleRaiseTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser || !ticketSubject.trim() || !ticketMessage.trim()) return;

        setIsSubmitting(true);
        try {
            const ticket = await ticketService.createTicket({
                creator_id: currentUser.uid,
                subject: ticketSubject.trim(),
                description: ticketMessage.trim(),
                status: 'open',
                priority: 'medium',
                property_id: selectedPropertyId || undefined,
                sender_name: ownerData?.name || currentUser.displayName || 'Owner',
                sender_email: ownerData?.email || currentUser.email || '',
                sender_phone: ownerData?.phone || currentUser.phoneNumber || ''
            });

            toast.success('Ticket raised successfully');
            setShowNewTicketModal(false);
            setTicketSubject('');
            setTicketMessage('');
            setSelectedTicketId(ticket.id);
            setActiveTab('tickets');
        } catch (error) {
            console.error('Failed to raise ticket:', error);
            toast.error('Failed to raise ticket');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) return <LoadingOverlay message="Loading support..." />;

    if (properties.length === 0) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center">
                <div className="bg-orange-100 p-4 rounded-full text-orange-600 mb-4">
                    <FiHome size={32} />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">No Properties Found</h2>
                <p className="text-gray-500 max-w-sm">
                    You need to add a property before you can send notices to residents.
                </p>
            </div>
        );
    }

    const selectedProperty = properties.find(p => p.propertyId === selectedPropertyId) || properties[0];
    const activeTicket = tickets.find(t => t.id === selectedTicketId);

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] bg-gray-50 overflow-hidden">
            {/* Header with Property Selector */}
            <div className="bg-white border-b border-gray-100 shrink-0 px-4 md:px-8 h-[72px] flex items-center justify-between shadow-sm z-20">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold text-gray-900">Support & Notices</h1>
                    <div className="h-6 w-px bg-gray-200 hidden md:block"></div>
                    <div className="hidden md:flex bg-gray-100 p-1 rounded-xl">
                        <button
                            onClick={() => setActiveTab('notices')}
                            className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'notices' ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-gray-600'
                                }`}
                        >
                            <FiBell /> Notices
                        </button>
                        <button
                            onClick={() => setActiveTab('tickets')}
                            className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'tickets' ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-gray-600'
                                }`}
                        >
                            <FiMessageSquare /> Support Tickets
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {properties.length > 1 ? (
                        <div className="relative">
                            <select
                                name="ownerChatProperty"
                                value={selectedPropertyId}
                                onChange={(e) => setSelectedPropertyId(e.target.value)}
                                className="appearance-none pl-4 pr-10 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm font-bold text-gray-700 hover:border-black transition-colors outline-none cursor-pointer"
                            >
                                <option value="">Select Property</option>
                                {properties.map(p => (
                                    <option key={p.propertyId} value={p.propertyId}>
                                        {p.title}
                                    </option>
                                ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                <FiHome size={14} className="text-gray-400" />
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
                            <FiHome size={14} className="text-gray-400" />
                            <span className="text-sm font-bold text-gray-700 max-w-[200px] truncate">{selectedProperty.title}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden md:flex-row md:overflow-hidden">
                {/* Sidebar */}
                <div className="w-full border-b border-gray-100 bg-white flex flex-col shrink-0 md:w-80 md:border-b-0 md:border-r lg:w-96">
                    <div className="md:hidden flex bg-gray-100 p-2 mx-4 mt-4 rounded-xl">
                        <button
                            onClick={() => setActiveTab('notices')}
                            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'notices' ? 'bg-white text-black shadow-sm' : 'text-gray-400'
                                }`}
                        >
                            Notices
                        </button>
                        <button
                            onClick={() => setActiveTab('tickets')}
                            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'tickets' ? 'bg-white text-black shadow-sm' : 'text-gray-400'
                                }`}
                        >
                            Tickets
                        </button>
                    </div>

                    {activeTab === 'notices' ? (
                        <div className="p-4 overflow-y-auto custom-scrollbar flex-1">
                            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-gray-400 shadow-sm">
                                        <FiBell size={18} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Active Property</p>
                                        <p className="mt-1 truncate text-sm font-bold text-gray-700">{selectedProperty.title}</p>
                                    </div>
                                </div>
                                <div className="mt-4 rounded-xl bg-white px-3 py-3 text-center">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Manage Notices</p>
                                    <p className="mt-1 text-xs font-semibold text-gray-500">Use the right panel to create or clear notices.</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Support Ticket History</h3>
                                <button
                                    onClick={() => {
                                        if (!selectedPropertyId) {
                                            toast.error('Please select a PG (Property) first');
                                            return;
                                        }
                                        setShowNewTicketModal(true);
                                    }}
                                    className="bg-black text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-95 flex items-center gap-2"
                                >
                                    + Raise New Ticket
                                </button>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <OwnerChatSidebar
                                    tickets={tickets}
                                    selectedTicketId={selectedTicketId}
                                    onSelectTicket={setSelectedTicketId}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Main Content */}
                <div className="w-full bg-white relative overflow-visible md:min-h-0 md:flex-1 md:overflow-hidden">
                    {activeTab === 'notices' ? (
                        <div className="h-full overflow-visible p-4 md:overflow-y-auto md:p-8 custom-scrollbar">
                            <NoticesTab
                                propertyId={selectedPropertyId}
                                userId={currentUser?.uid || ''}
                            />
                        </div>
                    ) : selectedTicketId ? (
                        <OwnerChatConversation
                            chatId={selectedTicketId}
                            currentUserId={currentUser?.uid || ''}
                            title={activeTicket?.subject}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center p-8">
                            <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center text-gray-300 mb-6">
                                <FiMessageSquare size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-2">Support & Assistance</h3>
                            <p className="text-gray-500 max-w-xs mx-auto text-sm font-medium">Select a support ticket from the sidebar to view admin responses or manage your requests.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* New Ticket Modal */}
            <Modal
                isOpen={showNewTicketModal}
                onClose={() => setShowNewTicketModal(false)}
                title="Raise Support Ticket"
            >
                <form onSubmit={handleRaiseTicket} className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Subject</label>
                        <input
                            type="text"
                            name="ownerSupportTicketSubject"
                            value={ticketSubject}
                            onChange={(e) => setTicketSubject(e.target.value)}
                            placeholder="Briefly describe your issue..."
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:bg-white focus:border-black outline-none transition-all"
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Your Message</label>
                        <textarea
                            name="ownerSupportTicketMessage"
                            value={ticketMessage}
                            onChange={(e) => setTicketMessage(e.target.value)}
                            placeholder="Provide full details of your request..."
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:bg-white focus:border-black outline-none transition-all h-40 resize-none"
                            required
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => setShowNewTicketModal(false)}
                            className="flex-1 px-4 py-3 rounded-xl text-sm font-black uppercase tracking-widest text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !ticketSubject.trim() || !ticketMessage.trim()}
                            className="flex-[2] px-4 py-3 rounded-xl text-sm font-black uppercase tracking-widest text-white bg-black hover:bg-gray-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg"
                        >
                            {isSubmitting ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                <FiSend />
                            )}
                            Submitting Ticket
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default OwnerChat;
