import React, { useState } from 'react';
import Modal from '../common/Modal';
import { FiAlertCircle } from 'react-icons/fi';

interface RejectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
    ownerName: string;
    loading?: boolean;
}

const RejectionModal: React.FC<RejectionModalProps> = ({ isOpen, onClose, onConfirm, ownerName, loading }) => {
    const [reason, setReason] = useState('');
    const [customReason, setCustomReason] = useState('');
    const reasonFieldId = 'owner-rejection-reason';
    const detailFieldId = 'owner-rejection-details';

    const reasons = [
        'Invalid license document',
        'Bank details mismatch',
        'Suspicious activity',
        'Incomplete profile details',
        'Duplicate account',
        'Other'
    ];

    const handleConfirm = () => {
        const finalReason = reason === 'Other' ? customReason : reason;
        if (finalReason) {
            onConfirm(finalReason);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Reject Verification" maxWidth="max-w-md">
            <div className="space-y-6">
                <div className="flex items-start gap-4 p-4 bg-rose-50 rounded-2xl border border-rose-100 mb-2">
                    <FiAlertCircle className="text-rose-600 mt-1 shrink-0" size={20} />
                    <p className="text-sm text-rose-800">
                        Rejecting <strong>{ownerName}</strong> will send an email notification with the reason and steps to re-apply.
                    </p>
                </div>

                <div>
                    <label htmlFor={reasonFieldId} className="block text-sm font-bold text-slate-700 mb-2">Select Reason</label>
                    <select
                        id={reasonFieldId}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-blue-500 transition-all text-sm"
                    >
                        <option value="">Choose a reason...</option>
                        {reasons.map((r) => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>
                </div>

                {reason === 'Other' && (
                    <div className="animate-fade-in">
                        <label htmlFor={detailFieldId} className="block text-sm font-bold text-slate-700 mb-2">Detailed Explanation</label>
                        <textarea
                            id={detailFieldId}
                            value={customReason}
                            onChange={(e) => setCustomReason(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-blue-500 transition-all text-sm min-h-[100px]"
                            placeholder="Provide more context for the owner..."
                        />
                    </div>
                )}

                <div className="flex flex-col gap-3 pt-4">
                    <button
                        onClick={handleConfirm}
                        disabled={loading || !reason || (reason === 'Other' && !customReason)}
                        className="w-full bg-rose-600 text-white font-bold py-4 rounded-2xl hover:bg-rose-700 transition-all shadow-lg shadow-rose-500/20 active:scale-[0.98] disabled:opacity-50"
                    >
                        {loading ? 'Processing...' : 'Confirm Rejection'}
                    </button>

                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl transition-all active:scale-[0.98]"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default RejectionModal;
