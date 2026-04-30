import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiX } from 'react-icons/fi';
import { twMerge } from 'tailwind-merge';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    className?: string;
    showCloseButton?: boolean;
    maxWidth?: string;
}

const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    className,
    showCloseButton = true,
    maxWidth = 'max-w-lg'
}) => {
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div
                ref={modalRef}
                className={twMerge(
                    "bg-white rounded-3xl shadow-2xl w-full overflow-hidden animate-scale-in border border-slate-200",
                    maxWidth,
                    className
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {(title || showCloseButton) && (
                    <div className="flex items-center justify-between p-6 border-b border-slate-100">
                        {title && <h3 className="text-xl font-bold text-slate-900">{title}</h3>}
                        {showCloseButton && (
                            <button
                                onClick={onClose}
                                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"
                            >
                                <FiX size={20} />
                            </button>
                        )}
                    </div>
                )}
                <div className="p-6 overflow-y-auto max-h-[85vh]">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default Modal;
