import React, { useState } from 'react';
import { FaTimes, FaDownload, FaSearchPlus, FaSearchMinus } from 'react-icons/fa';

interface ImagePreviewModalProps {
    imageUrl: string;
    onClose: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, onClose }) => {
    const [scale, setScale] = useState(1);

    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.25, 3));
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.25, 0.5));

    return (
        <div className="fixed inset-0 z-[400] bg-black/95 backdrop-blur-2xl flex flex-col animate-in fade-in duration-300">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-50 bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all active:scale-90"
                    >
                        <FaTimes size={18} />
                    </button>
                    <p className="text-white font-black tracking-tight uppercase text-xs opacity-70">Image Preview</p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleZoomOut}
                        className="w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all active:scale-95"
                    >
                        <FaSearchMinus size={16} />
                    </button>
                    <button
                        onClick={handleZoomIn}
                        className="w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all active:scale-95"
                    >
                        <FaSearchPlus size={16} />
                    </button>
                    <div className="w-px h-6 bg-white/20 mx-2" />
                    <a
                        href={imageUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-10 h-10 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-center text-white transition-all shadow-lg active:scale-90"
                    >
                        <FaDownload size={16} />
                    </a>
                </div>
            </div>

            {/* Image Content */}
            <div className="flex-1 flex items-center justify-center overflow-auto p-4 md:p-12 no-scrollbar">
                <div
                    className="relative transition-transform duration-300 ease-out cursor-grab active:cursor-grabbing"
                    style={{ transform: `scale(${scale})` }}
                >
                    <img
                        src={imageUrl}
                        alt="Preview"
                        className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain animate-in zoom-in-95 duration-500"
                    />
                </div>
            </div>

            {/* Scale Indicator */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/10">
                <p className="text-white text-[10px] font-black uppercase tracking-widest">{Math.round(scale * 100)}% Zoom</p>
            </div>
        </div>
    );
};

export default ImagePreviewModal;
