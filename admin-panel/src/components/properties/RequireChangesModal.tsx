import React, { useState } from 'react';
import Modal from '../common/Modal';
import { FiMessageSquare } from 'react-icons/fi';

interface RequireChangesModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSend: (message: string) => void;
    title: string;
    loading?: boolean;
}

const RequireChangesModal: React.FC<RequireChangesModalProps> = ({ isOpen, onClose, onSend, title, loading }) => {
    const [message, setMessage] = useState('');
    const messageFieldId = 'require-changes-message';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Request Improvements" maxWidth="max-w-md">
            <div className="space-y-6">
                <div className="flex items-start gap-4 p-4 bg-blue-50 rounded-2xl border border-blue-100 mb-2">
                    <FiMessageSquare className="text-blue-600 mt-1 shrink-0" size={20} />
                    <p className="text-sm text-blue-800">
                        Send a message to the owner of <strong>{title}</strong> explaining what they need to fix to get verified.
                    </p>
                </div>

                <div>
                    <label htmlFor={messageFieldId} className="block text-sm font-bold text-slate-700 mb-2">Message to Owner</label>
                    <textarea
                        id={messageFieldId}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-blue-500 transition-all text-sm min-h-[120px]"
                        placeholder="e.g. Please upload higher quality photos of the kitchen..."
                    />
                </div>

                <div className="flex flex-col gap-3 pt-4">
                    <button
                        onClick={() => onSend(message)}
                        disabled={loading || !message}
                        className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98] disabled:opacity-50"
                    >
                        {loading ? 'Sending...' : 'Send Message'}
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

export default RequireChangesModal;
