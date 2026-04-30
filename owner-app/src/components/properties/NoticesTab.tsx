import React, { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiBell, FiInfo, FiAlertTriangle, FiCoffee, FiCreditCard, FiTool, FiFileText, FiCalendar } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { noticeService } from '../../services/notice.service';
import type { Notice, NoticeType } from '../../types/notice.types';
import { CreateNoticeModal } from './CreateNoticeModal';
import { ConfirmationModal } from '../common/ConfirmationModal';

interface NoticesTabProps {
    propertyId: string;
    userId: string;
}

export const NoticesTab: React.FC<NoticesTabProps> = ({ propertyId, userId }) => {
    const [notices, setNotices] = useState<Notice[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    useEffect(() => {
        if (!propertyId) {
            setNotices([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = noticeService.subscribeToNotices(propertyId, (data) => {
            setNotices(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [propertyId]);

    const handleDelete = async (noticeId: string) => {
        try {
            await noticeService.deleteNotice(noticeId);
            toast.success("Notice deleted");
        } catch {
            toast.error("Failed to delete notice");
        }
    };

    const handleClearNotices = async () => {
        if (!propertyId || notices.length === 0 || isClearing) return;
        setShowClearConfirm(true);
    };

    const confirmClearNotices = async () => {
        if (!propertyId || notices.length === 0 || isClearing) return;

        setShowClearConfirm(false);
        setIsClearing(true);
        try {
            await noticeService.clearNotices(propertyId);
            toast.success('All notices cleared');
        } catch (error) {
            console.error('Failed to clear notices:', error);
            toast.error('Failed to clear notices');
        } finally {
            setIsClearing(false);
        }
    };

    const getIcon = (type: NoticeType) => {
        switch (type) {
            case 'urgent': return <FiAlertTriangle className="text-red-500" />;
            case 'food': return <FiCoffee className="text-orange-500" />;
            case 'payment': return <FiCreditCard className="text-blue-500" />;
            case 'maintenance': return <FiTool className="text-gray-500" />;
            case 'rule': return <FiFileText className="text-blue-500" />;
            case 'festival': return <FiCalendar className="text-purple-500" />;
            default: return <FiInfo className="text-blue-400" />;
        }
    };

    const getBadgeStyle = (type: NoticeType) => {
        switch (type) {
            case 'urgent': return 'bg-red-50 text-red-700 border-red-100';
            case 'food': return 'bg-orange-50 text-orange-700 border-orange-100';
            case 'payment': return 'bg-blue-50 text-blue-700 border-blue-100';
            case 'maintenance': return 'bg-gray-50 text-gray-700 border-gray-100';
            case 'rule': return 'bg-blue-50 text-blue-700 border-blue-100';
            case 'festival': return 'bg-purple-50 text-purple-700 border-purple-100';
            default: return 'bg-blue-50 text-blue-600 border-blue-100';
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-bold text-gray-900">Notices & Announcements</h2>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button
                        onClick={handleClearNotices}
                        disabled={!propertyId || notices.length === 0 || isClearing}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-700 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                        <FiTrash2 size={16} />
                        {isClearing ? 'Clearing...' : 'Clear Notices'}
                    </button>
                    <button
                        onClick={() => {
                            if (!propertyId) {
                                toast.error("Please select a property first");
                                return;
                            }
                            setIsCreateModalOpen(true);
                        }}
                        disabled={!propertyId}
                        className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl shadow-lg hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed text-sm font-bold transition-all active:scale-95"
                    >
                        <FiPlus size={18} />
                        Create Notice
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse"></div>
                    ))}
                </div>
            ) : !propertyId ? (
                <div className="text-center py-20 bg-gray-50/50 rounded-3xl border-2 border-dashed border-gray-200">
                    <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-6 text-gray-400">
                        <FiBell size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Select a Property First</h3>
                    <p className="text-gray-500 max-w-xs mx-auto text-sm font-medium">Please select a property from the dropdown above to manage and view its notices.</p>
                </div>
            ) : notices.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-200">
                    <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-500">
                        <FiBell size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">No notices sent yet</h3>
                    <p className="text-gray-400 max-w-sm mx-auto">Create your first announcement to instantly notify all residents of this property.</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    <AnimatePresence>
                        {notices.map((notice) => (
                            <motion.div
                                key={notice.noticeId}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, height: 0 }}
                                className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group relative"
                            >
                                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => handleDelete(notice.noticeId)}
                                        className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                                        title="Delete Notice"
                                    >
                                        <FiTrash2 size={16} />
                                    </button>
                                </div>

                                <div className="flex items-start gap-4 pr-10">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-xl ${notice.type === 'urgent' ? 'bg-red-100' : 'bg-gray-50'
                                        }`}>
                                        {getIcon(notice.type)}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`px-2.5 py-0.5 rounded-md text-[10px] uppercase font-black tracking-wider border ${getBadgeStyle(notice.type)}`}>
                                                {notice.type}
                                            </span>
                                            <span className="text-xs font-bold text-gray-400">
                                                {notice.createdAt ? format(new Date(notice.createdAt), 'dd MMM, hh:mm a') : 'Just now'}
                                            </span>
                                        </div>
                                        <h3 className="font-bold text-gray-900 text-lg mb-1">{notice.title}</h3>
                                        <p className="text-gray-600 text-sm leading-relaxed">{notice.message}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}

            <ConfirmationModal
                isOpen={showClearConfirm}
                onClose={() => setShowClearConfirm(false)}
                onConfirm={confirmClearNotices}
                title="Clear All Notices"
                message="This will remove every notice for the selected property from the app and Supabase."
                confirmText="Clear Notices"
                cancelText="Keep Notices"
                variant="danger"
            />

            {isCreateModalOpen && (
                <CreateNoticeModal
                    onClose={() => setIsCreateModalOpen(false)}
                    propertyId={propertyId}
                    userId={userId}
                />
            )}
        </div>
    );
};

