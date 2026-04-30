import React from 'react';
import Modal from './Modal';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: React.ReactNode;
    confirmText?: string; // default: "Confirm"
    cancelText?: string; // default: "Cancel"
    variant?: 'danger' | 'warning' | 'info'; // affects button colors
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = 'danger'
}) => {

    const getButtonColor = () => {
        switch (variant) {
            case 'danger': return 'bg-red-600 hover:bg-red-700 focus:ring-red-500';
            case 'warning': return 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500';
            case 'info': return 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500';
            default: return 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500';
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="space-y-3">
                <div className="text-gray-600">
                    {message}
                </div>

                <div className="flex justify-end gap-3 mt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 text-white rounded-lg transition-colors shadow-sm ${getButtonColor()}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
