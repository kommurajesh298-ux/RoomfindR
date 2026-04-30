import React from 'react';
import Modal from './Modal';
import { FiAlertTriangle } from 'react-icons/fi';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    loading?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'info',
    loading = false
}) => {
    const variantStyles = {
        danger: 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20',
        warning: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20',
        info: 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20',
    };

    const iconStyles = {
        danger: 'bg-rose-100 text-rose-600',
        warning: 'bg-amber-100 text-amber-600',
        info: 'bg-blue-100 text-blue-600',
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} showCloseButton={false} maxWidth="max-w-md">
            <div className="text-center p-2">
                <div className={`w-16 h-16 ${iconStyles[variant]} rounded-2xl flex items-center justify-center mx-auto mb-6 text-2xl`}>
                    <FiAlertTriangle />
                </div>

                <h3 className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-500 mb-8 leading-relaxed">{message}</p>

                <div className="flex flex-col gap-3">
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className={`w-full text-white font-bold py-4 rounded-2xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 ${variantStyles[variant]}`}
                    >
                        {loading ? 'Processing...' : confirmText}
                    </button>

                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl transition-all active:scale-[0.98]"
                    >
                        {cancelText}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default ConfirmationModal;
