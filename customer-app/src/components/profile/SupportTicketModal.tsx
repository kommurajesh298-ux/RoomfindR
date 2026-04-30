import React, { useState } from 'react';
import { FaTimes, FaCommentAlt, FaSpinner } from 'react-icons/fa';
import { ticketService } from '../../services/ticket.service';
import { toast } from 'react-hot-toast';

interface SupportTicketModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    userName: string;
    userEmail: string;
    userPhone: string;
}

const SupportTicketModal: React.FC<SupportTicketModalProps> = ({
    isOpen,
    onClose,
    userId,
    userName,
    userEmail,
    userPhone
}) => {
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!subject.trim() || !message.trim()) return;

        setIsSubmitting(true);
        try {
            await ticketService.createTicket({
                creator_id: userId,
                subject: subject.trim(),
                description: message.trim(),
                status: 'open',
                priority: 'medium',
                // Auto-fill sender details
                sender_name: userName,
                sender_email: userEmail,
                sender_phone: userPhone
            });
            toast.success('Support ticket raised successfully');
            setSubject('');
            setMessage('');
            onClose();
        } catch (error) {
            console.error(error);
            toast.error('Failed to raise ticket');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in slide-in-from-bottom-4 duration-300 max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-5 md:p-6 border-b border-gray-100 bg-gray-50/50 shrink-0">
                    <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                        <FaCommentAlt className="text-blue-500" />
                        Raise Support Ticket
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-full"
                    >
                        <FaTimes />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 md:p-6 space-y-4 overflow-y-auto flex-1 no-scrollbar">
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                        <p className="text-xs font-bold text-blue-700 uppercase tracking-widest mb-1">Your Details</p>
                        <p className="text-sm text-blue-900 font-medium">{userName || 'User'}</p>
                        <p className="text-xs text-blue-600">{userEmail}</p>
                        {userPhone && <p className="text-xs text-blue-600">{userPhone}</p>}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">
                            Subject
                        </label>
                        <input
                            type="text"
                            name="supportTicketSubject"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm"
                            placeholder="Briefly describe the issue..."
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">
                            Message
                        </label>
                        <textarea
                            name="supportTicketMessage"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm h-32 md:h-40 resize-none"
                            placeholder="Explain your issue in detail..."
                            required
                        />
                    </div>

                    <div className="flex gap-3 pt-2 sticky bottom-0 bg-white md:bg-transparent pb-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-all text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex-[2] py-3 px-4 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-all flex items-center justify-center gap-2 text-sm shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? <FaSpinner className="animate-spin" /> : 'Submit Ticket'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SupportTicketModal;
