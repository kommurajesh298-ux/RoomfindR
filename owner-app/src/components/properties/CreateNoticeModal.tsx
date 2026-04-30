import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FiX, FiCheck, FiAlertTriangle, FiCoffee, FiCreditCard, FiTool, FiFileText, FiCalendar, FiInfo } from 'react-icons/fi';
import type { IconType } from 'react-icons';
import { toast } from 'react-hot-toast';
import { noticeService } from '../../services/notice.service';
import type { NoticeType } from '../../types/notice.types';

interface CreateNoticeModalProps {
    onClose: () => void;
    propertyId: string;
    userId: string;
}

export const CreateNoticeModal: React.FC<CreateNoticeModalProps> = ({ onClose, propertyId, userId }) => {
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [type, setType] = useState<NoticeType>('info');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title.trim() || !message.trim()) {
            toast.error("Please fill in all fields");
            return;
        }

        setLoading(true);
        try {
            await noticeService.createNotice(propertyId, userId, {
                title,
                message,
                type
            });
            toast.success("Notice sent successfully.");
            onClose();
        } catch (error: unknown) {
            console.error(error);
            toast.error("Failed to send notice");
        } finally {
            setLoading(false);
        }
    };

    const categories: { id: NoticeType; label: string; icon: IconType; color: string }[] = [
        { id: 'info', label: 'General Info', icon: FiInfo, color: 'text-blue-500 bg-blue-50' },
        { id: 'urgent', label: 'Urgent Alert', icon: FiAlertTriangle, color: 'text-red-500 bg-red-50' },
        { id: 'food', label: 'Food Update', icon: FiCoffee, color: 'text-orange-500 bg-orange-50' },
        { id: 'payment', label: 'Payment', icon: FiCreditCard, color: 'text-blue-500 bg-blue-50' },
        { id: 'maintenance', label: 'Maintenance', icon: FiTool, color: 'text-gray-500 bg-gray-50' },
        { id: 'rule', label: 'New Rule', icon: FiFileText, color: 'text-indigo-500 bg-indigo-50' },
        { id: 'festival', label: 'Festival', icon: FiCalendar, color: 'text-purple-500 bg-purple-50' },
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
                <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
                    <div>
                        <h3 className="font-bold text-gray-900 text-xl">Create Notice</h3>
                        <p className="text-xs text-gray-500 font-medium">Send an announcement to all residents</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                    >
                        <FiX size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Category Selection */}
                    <div className="space-y-3">
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Category</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {categories.map((cat) => {
                                const Icon = cat.icon;
                                const isSelected = type === cat.id;
                                return (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => setType(cat.id)}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${isSelected
                                            ? 'border-black bg-black text-white shadow-lg scale-[1.02]'
                                            : 'border-transparent bg-gray-50 text-gray-600 hover:bg-gray-100'
                                            }`}
                                    >
                                        <Icon size={20} className={`mb-2 ${isSelected ? 'text-white' : cat.color.split(' ')[0]}`} />
                                        <span className="text-[10px] font-bold uppercase tracking-wide">{cat.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="notice-title" className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Title</label>
                        <input
                            id="notice-title"
                            name="title"
                            type="text"
                            autoComplete="off"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:border-black focus:ring-4 focus:ring-black/5 transition-all outline-none font-bold"
                            placeholder="e.g. Water Supply Interruption"
                            autoFocus
                        />
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="notice-message" className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Message</label>
                        <textarea
                            id="notice-message"
                            name="message"
                            autoComplete="off"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={4}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:border-black focus:ring-4 focus:ring-black/5 transition-all outline-none resize-none leading-relaxed"
                            placeholder="Type your detailed message here..."
                        />
                    </div>
                </form>

                <div className="px-6 py-5 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 z-10">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-2.5 text-gray-500 font-bold text-sm hover:text-gray-900 transition-colors"
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className="px-8 py-2.5 bg-black text-white font-bold rounded-xl hover:bg-gray-800 transition-all shadow-lg shadow-blue-200 flex items-center gap-2 active:scale-[0.98]"
                    >
                        {loading ? 'Sending...' : (
                            <>
                                <span>Send Notice</span>
                                <FiCheck />
                            </>
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

