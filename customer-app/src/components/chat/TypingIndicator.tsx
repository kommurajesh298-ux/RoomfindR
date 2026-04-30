import React from 'react';

interface TypingIndicatorProps {
    userName: string;
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({ userName }) => {
    return (
        <div className="flex items-center space-x-2 py-2.5 px-5 bg-white border border-gray-100 shadow-sm rounded-full w-fit mb-4 animate-in fade-in slide-in-from-left-2 duration-300">
            <div className="flex space-x-1.5">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></div>
            </div>
            <span className="text-[11px] text-[#6B7280] font-black uppercase tracking-widest">{userName} is typing</span>
        </div>
    );
};

export default TypingIndicator;
