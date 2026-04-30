import React, { useState } from 'react';
import Modal from '../common/Modal';
import { FiAlertTriangle } from 'react-icons/fi';

interface RemovePropertyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
    title: string;
    loading?: boolean;
}

const RemovePropertyModal: React.FC<RemovePropertyModalProps> = ({ isOpen, onClose, onConfirm, title, loading }) => {
    const [reason, setReason] = useState('');
    const reasonFieldId = 'remove-property-reason';

    const reasons = [
        'Guidelines Violation',
        'Incorrect Category',
        'Reported Fraudulent',
        'Owner Request',
        'Expired Listing',
        'Other'
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Temporarily Remove Listing" maxWidth="max-w-md">
            <div className="space-y-6">
                <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-2xl border border-amber-100 mb-2">
                    <FiAlertTriangle className="text-amber-600 mt-1 shrink-0" size={20} />
                    <p className="text-sm text-amber-800">
                        Removing <strong>{title}</strong> will hide it from the customer app. The owner will be notified to make changes.
                    </p>
                </div>

                <div>
                    <label htmlFor={reasonFieldId} className="block text-sm font-bold text-slate-700 mb-2">Removal Reason</label>
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

                <div className="flex flex-col gap-3 pt-4">
                    <button
                        onClick={() => onConfirm(reason)}
                        disabled={loading || !reason}
                        className="w-full bg-amber-500 text-white font-bold py-4 rounded-2xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20 active:scale-[0.98] disabled:opacity-50"
                    >
                        {loading ? 'Processing...' : 'Remove from Search'}
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

export default RemovePropertyModal;
