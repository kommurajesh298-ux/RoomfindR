import React from 'react';
import { format } from 'date-fns';
import { FiUser, FiMessageSquare } from 'react-icons/fi';
import type { Ticket } from '../../services/ticket.service';

interface OwnerChatSidebarProps {
    tickets: Ticket[];
    selectedTicketId: string | null;
    onSelectTicket: (ticketId: string) => void;
}

const OwnerChatSidebar: React.FC<OwnerChatSidebarProps> = ({ tickets, selectedTicketId, onSelectTicket }) => {
    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-100 overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {tickets.length === 0 ? (
                    <div className="p-8 text-center">
                        <FiMessageSquare className="mx-auto text-gray-200 mb-2" size={24} />
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">No active tickets</p>
                    </div>
                ) : (
                    tickets.map((ticket) => {
                        const isActive = selectedTicketId === ticket.id;
                        const lastMsg = ticket.description || 'No description';
                        const time = format(new Date(ticket.updated_at), 'hh:mm a');

                        return (
                            <button
                                key={ticket.id}
                                onClick={() => onSelectTicket(ticket.id)}
                                className={`w-full p-4 flex items-start gap-4 transition-all hover:bg-gray-50 text-left border-l-4 ${isActive ? 'bg-gray-50 border-black' : 'border-transparent'
                                    }`}
                            >
                                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-gray-100 text-gray-600 relative">
                                    <FiUser size={20} />
                                    <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${ticket.status === 'open' ? 'bg-blue-500' : 'bg-gray-400'}`}></div>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <h4 className="font-bold text-gray-900 truncate pr-2">
                                            {ticket.subject || 'Support Ticket'}
                                        </h4>
                                        <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">
                                            {time}
                                        </span>
                                    </div>
                                    <p className="text-xs truncate text-gray-500 font-medium">
                                        {lastMsg}
                                    </p>
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${ticket.priority === 'high' ? 'bg-red-50 text-red-600 border-red-100' :
                                            ticket.priority === 'medium' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                                'bg-gray-50 text-gray-600 border-gray-100'
                                            }`}>
                                            {ticket.priority}
                                        </span>
                                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">
                                            ID: {ticket.id.slice(0, 8)}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default OwnerChatSidebar;

