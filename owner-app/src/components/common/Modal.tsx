import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';

import { twMerge } from 'tailwind-merge';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    className?: string;
    showCloseButton?: boolean;
}

const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    className,
    showCloseButton = true
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
            <div
                ref={modalRef}
                className={twMerge(
                    "bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in",
                    className
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {(title || showCloseButton) && (
                    <div className="flex items-center justify-between p-3 border-b border-gray-100">
                        {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
                        {showCloseButton && (
                            <button
                                onClick={onClose}
                                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <IoClose size={20} />
                            </button>
                        )}
                    </div>
                )}
                <div className="p-3 overflow-y-auto max-h-[80vh]">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default Modal;
