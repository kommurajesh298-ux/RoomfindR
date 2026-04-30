import React from 'react';
import { format } from 'date-fns';
import type { Message } from '../../types/chat.types';

interface MessageBubbleProps {
    message: Message;
    isSender: boolean;
    showTimestamp: boolean;
    isRead: boolean;
    onImageClick?: (_url: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isSender, showTimestamp, isRead, onImageClick }) => {
    if (message.senderId === 'system') {
        return (
            <div className="flex justify-center my-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="bg-gray-100/50 backdrop-blur-sm border border-gray-200/30 px-6 py-1.5 rounded-full shadow-sm">
                    <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest text-center">
                        {message.text}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex flex-col mb-2 group max-w-[85%] ${isSender ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
            {!isSender && message.senderName && (
                <span className="text-[10px] font-black text-[#6B7280] mb-1 ml-1.5 uppercase tracking-[0.15em]">
                    {message.senderName}
                </span>
            )}

            <div className="relative">
                <div className={`px-4 py-3 relative z-10 shadow-sm transition-all hover:shadow-md ${isSender
                    ? 'bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] text-white rounded-[22px] rounded-br-[6px]'
                    : 'bg-white border border-gray-100 text-[#111827] rounded-[22px] rounded-bl-[6px]'
                    } ${message.type === 'image' ? 'p-1.5' : ''}`}>
                    {message.type === 'image' ? (
                        <div className="relative overflow-hidden rounded-[18px]">
                            <img
                                src={message.imageUrl}
                                alt="Shared"
                                className="max-w-full rounded-[18px] transition-transform hover:scale-[1.02] cursor-pointer"
                                onClick={() => onImageClick?.(message.imageUrl || '')}
                            />
                        </div>
                    ) : (
                        <p className="text-[15px] leading-relaxed whitespace-pre-wrap font-medium">
                            {message.text}
                        </p>
                    )}

                    <div className={`flex items-center justify-end mt-1.5 space-x-1.5`}>
                        {showTimestamp && (
                            <span className={`text-[10px] font-black uppercase tracking-tighter opacity-60 ${isSender ? 'text-blue-100' : 'text-gray-400'}`}>
                                {format(new Date(message.ts), 'hh:mm a')}
                            </span>
                        )}
                        {isSender && (
                            <span className="flex items-center opacity-80">
                                {isRead ? (
                                    <svg className="w-3.5 h-3.5 text-blue-100" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
                                    </svg>
                                ) : (
                                    <svg className="w-3.5 h-3.5 text-blue-100/60" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                    </svg>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MessageBubble;
