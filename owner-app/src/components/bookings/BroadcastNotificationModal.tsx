import React, { useState } from 'react';
import { IoClose, IoSend, IoNotificationsOutline, IoPeopleOutline, IoBusinessOutline, IoTextOutline } from 'react-icons/io5';
import { motion, AnimatePresence } from 'framer-motion';
import type { Property } from '../../types/property.types';

interface BroadcastNotificationModalProps {
    isOpen: boolean;
    onClose: () => void;
    properties: Property[];
    onSend: (propertyId: string, title: string, message: string) => Promise<void>;
    loading: boolean;
}

const BroadcastNotificationModal: React.FC<BroadcastNotificationModalProps> = ({
    isOpen,
    onClose,
    properties,
    onSend,
    loading
}) => {
    const [selectedPropertyId, setSelectedPropertyId] = useState(properties[0]?.propertyId || '');
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPropertyId || !title || !message) return;
        await onSend(selectedPropertyId, title, message);
        setTitle('');
        setMessage('');
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-gray-900/60 backdrop-blur-md"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, y: 100, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 100, scale: 0.95 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="relative bg-white w-full max-w-lg rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden"
                    >
                        {/* Header Section */}
                        <div className="relative p-6 border-b border-gray-100 bg-gradient-to-br from-white to-primary-50/30">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-primary-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary-200">
                                        <IoNotificationsOutline size={24} className="animate-pulse" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-gray-900 leading-none">Broadcast</h3>
                                        <p className="text-[12px] text-gray-500 font-medium mt-1.5 flex items-center gap-1">
                                            <IoPeopleOutline className="text-primary-500" />
                                            Notify all active residents
                                        </p>
                                    </div>
                                </div>
                                <motion.button
                                    whileHover={{ scale: 1.1, rotate: 90 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-full transition-colors"
                                >
                                    <IoClose size={22} />
                                </motion.button>
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            {/* Property Selection */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-[13px] font-bold text-gray-700 uppercase tracking-wider ml-1">
                                    <IoBusinessOutline className="text-primary-500" />
                                    Property Source
                                </label>
                                <div className="relative group">
                                    <select
                                        name="broadcastProperty"
                                        value={selectedPropertyId}
                                        onChange={(e) => setSelectedPropertyId(e.target.value)}
                                        className="w-full h-[56px] pl-5 pr-12 bg-gray-50 border-2 border-transparent group-hover:bg-white group-hover:border-primary-100 focus:bg-white focus:border-primary-500 rounded-2xl outline-none transition-all font-bold text-gray-800 appearance-none cursor-pointer shadow-sm"
                                        required
                                    >
                                        {properties.length === 0 && <option value="">No properties available</option>}
                                        {properties.map((p) => (
                                            <option key={p.propertyId} value={p.propertyId}>{p.title}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                        <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                                            <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            {/* Message Title */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-[13px] font-bold text-gray-700 uppercase tracking-wider ml-1">
                                    <IoTextOutline className="text-primary-500" />
                                    Headline
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        name="broadcastTitle"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="e.g., Maintainence Notice"
                                        maxLength={50}
                                        className="w-full h-[56px] px-5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary-500 rounded-2xl outline-none transition-all font-bold text-gray-800 shadow-sm"
                                        required
                                    />
                                    <div className="absolute right-4 bottom-[-10px]">
                                        <div className="bg-white px-2 py-0.5 rounded-md border border-gray-100 shadow-sm">
                                            <span className={`text-[10px] font-bold ${title.length > 40 ? 'text-orange-500' : 'text-gray-400'}`}>
                                                {title.length}/50
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Message Body */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-[13px] font-bold text-gray-700 uppercase tracking-wider ml-1">
                                    <IoNotificationsOutline size={14} className="text-primary-500" />
                                    Message Content
                                </label>
                                <div className="relative">
                                    <textarea
                                        name="broadcastMessage"
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder="Type your announcement here..."
                                        maxLength={200}
                                        className="w-full px-5 py-5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary-500 rounded-[24px] outline-none transition-all font-medium text-gray-700 min-h-[160px] resize-none shadow-sm leading-relaxed"
                                        required
                                    />
                                    <div className="absolute right-4 bottom-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden">
                                                <motion.div
                                                    className={`h-full ${message.length > 180 ? 'bg-red-500' : 'bg-primary-500'}`}
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${(message.length / 200) * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] font-bold text-gray-400">
                                                {message.length}/200
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-4 pt-4">
                                <motion.button
                                    whileHover={{ backgroundColor: '#F3F4F6' }}
                                    whileTap={{ scale: 0.98 }}
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 h-[56px] text-[15px] font-black text-gray-500 bg-gray-50 rounded-2xl transition-colors border border-gray-100"
                                    disabled={loading}
                                >
                                    Discard
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.02, backgroundColor: '#1d4ed8' }}
                                    whileTap={{ scale: 0.98 }}
                                    type="submit"
                                    className="flex-[2] h-[56px] text-[15px] font-black text-white bg-primary-600 shadow-xl shadow-primary-100 rounded-2xl transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:scale-100"
                                    disabled={loading || properties.length === 0 || !title || !message}
                                >
                                    {loading ? (
                                        <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <IoSend />
                                            <span>Broadcast Now</span>
                                        </>
                                    )}
                                </motion.button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default BroadcastNotificationModal;
