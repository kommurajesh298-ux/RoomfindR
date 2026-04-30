import React, { useState } from 'react';
import { IoClose } from 'react-icons/io5';

interface RejectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string, details: string) => Promise<void>;
    loading: boolean;
}

const REJECTION_REASONS = [
    "Room unavailable",
    "Dates conflict",
    "Customer verification failed",
    "Incorrect pricing",
    "Other"
];

const RejectModal: React.FC<RejectModalProps> = ({ isOpen, onClose, onConfirm, loading }) => {
    const [reason, setReason] = useState(REJECTION_REASONS[0]);
    const [details, setDetails] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await onConfirm(reason, details);
            onClose();
        } catch {
            // Keep the modal open so the user can retry or change the reason.
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[calc(100vh-24px)] sm:max-h-[calc(100vh-32px)] flex flex-col">
                <div className="flex justify-between items-center px-5 py-4 sm:p-6 border-b border-gray-100 shrink-0">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-900">Reject Booking</h3>
                    <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <IoClose size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-1 min-h-0 flex-col">
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 sm:p-6 space-y-3 sm:space-y-4">
                    <div>
                        <label htmlFor="reject-booking-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason for rejection</label>
                        <select
                            id="reject-booking-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full h-11 sm:h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-sm"
                        >
                            {REJECTION_REASONS.map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="reject-booking-details" className="block text-sm font-medium text-gray-700 mb-1">Additional details (optional)</label>
                        <textarea
                            id="reject-booking-details"
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            placeholder="Provide more context for the customer..."
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all min-h-[92px] sm:min-h-[120px] text-sm"
                            required={reason === 'Other'}
                        />
                    </div>

                    <div className="bg-orange-50 rounded-xl p-3 sm:p-4 border border-orange-100">
                        <p className="text-[11px] sm:text-xs text-orange-800 font-medium leading-6 sm:leading-relaxed">
                            <span className="font-bold">Important:</span> Rejection creates a refund request for admin review. The admin can approve a full refund or deduct commission before Cashfree processes it.
                        </p>
                    </div>
                    </div>

                    <div className="flex gap-3 px-5 pb-4 pt-3 sm:px-6 sm:pb-6 sm:pt-4 border-t border-gray-100 bg-white shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 h-11 sm:h-12 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 h-11 sm:h-12 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50"
                            disabled={loading}
                        >
                            {loading ? 'Rejecting...' : 'Reject Booking'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RejectModal;
