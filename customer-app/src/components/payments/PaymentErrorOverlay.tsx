import React from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';

interface PaymentErrorOverlayProps {
    open: boolean;
    title?: string;
    message: string;
    onClose: () => void;
    onGoBookings?: () => void;
    onViewDetails?: () => void;
    viewDetailsLabel?: string;
}

const PaymentErrorOverlay: React.FC<PaymentErrorOverlayProps> = ({
    open,
    title = 'Payment Could Not Start',
    message,
    onClose,
    onGoBookings,
    onViewDetails,
    viewDetailsLabel = 'View Details'
}) => {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
                    <FaExclamationTriangle className="text-red-500 text-2xl" />
                </div>
                <h2 className="text-xl font-black text-gray-900 mb-2">{title}</h2>
                <p className="text-sm text-gray-600 font-medium leading-relaxed">{message}</p>

                <div className="mt-6 grid grid-cols-1 gap-3">
                    {onGoBookings && (
                        <button
                            onClick={onGoBookings}
                            className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl active:scale-95 transition-all"
                        >
                            Go to My Bookings
                        </button>
                    )}
                    {onViewDetails && (
                        <button
                            onClick={onViewDetails}
                            className="w-full py-3 bg-white text-gray-700 font-bold rounded-xl border border-gray-200 active:scale-95 transition-all"
                        >
                            {viewDetailsLabel}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl active:scale-95 transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentErrorOverlay;
