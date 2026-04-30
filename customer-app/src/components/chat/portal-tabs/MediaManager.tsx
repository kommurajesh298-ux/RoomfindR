import React, { useState, useEffect } from 'react';
import { FaTrash, FaImage, FaHdd, FaChevronLeft } from 'react-icons/fa';
import { toast } from 'react-hot-toast';
import { chatService } from '../../../services/chat.service';
import type { Message } from '../../../types/chat.types';

interface MediaManagerProps {
    chatId: string;
    userId: string;
    onClose?: () => void;
}

const MediaManager: React.FC<MediaManagerProps> = ({ chatId, userId, onClose }) => {
    const [mediaItems, setMediaItems] = useState<{ id: string; url?: string; message: Message }[]>([]);
    const [loading, setLoading] = useState(true);
    const [storageUsage, setStorageUsage] = useState(0);

    const fetchData = React.useCallback(async () => {
        setLoading(true);
        try {
            const [media, usage] = await Promise.all([
                chatService.getChatMedia(chatId),
                chatService.getStorageUsage(userId)
            ]);
            setMediaItems(media.map(m => ({
                id: m.id,
                url: m.imageUrl,
                message: m
            })));
            setStorageUsage(usage);
        } catch (error) {
            console.error('Failed to fetch media:', error);
            toast.error('Failed to load media');
        } finally {
            setLoading(false);
        }
    }, [chatId, userId]);

    useEffect(() => {
        fetchData();
    }, [chatId, userId, fetchData]);

    const handleDelete = async (item: { id: string; url?: string; message: Message }) => {
        try {
            await chatService.deleteMedia(chatId, userId, item.message);
            toast.success('Media deleted');
            // Optimistic update
            setMediaItems(prev => prev.filter(m => m.id !== item.id));
            setStorageUsage(prev => Math.max(0, prev - 0.5)); // Estimated decrement
            // Refetch to be sure
            fetchData();
        } catch (error) {
            console.error('Failed to delete media:', error);
            toast.error('Failed to delete media');
        }
    };

    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-6 border-b flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {onClose && (
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                            <FaChevronLeft className="text-gray-600" />
                        </button>
                    )}
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight">Media Manager</h2>
                </div>
                <div className="flex flex-col items-end">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Usage</p>
                    <div className="flex items-center gap-2">
                        <FaHdd className="text-blue-600" />
                        <span className="text-lg font-black text-gray-900">{storageUsage.toFixed(1)}MB</span>
                        <span className="text-gray-300 font-bold">/ 100MB</span>
                    </div>
                </div>
            </div>

            {/* Storage Progress Bar */}
            <div className="px-6 py-4">
                <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-1000 ${storageUsage > 80 ? 'bg-orange-500' : 'bg-blue-600'}`}
                        style={{ width: `${Math.min(storageUsage, 100)}%` }}
                    ></div>
                </div>
                {storageUsage > 80 && (
                    <p className="text-[11px] font-bold text-orange-600 uppercase mt-2 tracking-wider animate-pulse">
                        ⚠ You’re nearing chat storage limit
                    </p>
                )}
            </div>

            {/* Media List */}
            <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                    <div className="space-y-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-20 bg-gray-50 rounded-2xl animate-pulse"></div>
                        ))}
                    </div>
                ) : mediaItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <FaImage className="text-gray-300 text-2xl" />
                        </div>
                        <h3 className="font-bold text-gray-900">No media found</h3>
                        <p className="text-sm text-gray-400">Your uploaded images will appear here.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-4">
                        {mediaItems.map((item) => (
                            <div key={item.id} className="relative aspect-square group">
                                <img src={item.url} className="w-full h-full object-cover rounded-2xl" alt="Media" />
                                <button
                                    onClick={() => handleDelete(item)}
                                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl"
                                >
                                    <FaTrash className="text-white text-xl" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MediaManager;
