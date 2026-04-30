import React, { useState } from 'react';

interface PincodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPincodeSelect: (pincode: string) => void;
}

export const PincodeModal: React.FC<PincodeModalProps> = ({ isOpen, onClose, onPincodeSelect }) => {
    const [pincode, setPincode] = useState(() => localStorage.getItem('user_pincode') || '');
    const [error, setError] = useState('');

    const isValidPincode = (value: string) => value.length === 6 && /^\d+$/.test(value);

    const handleSubmit = () => {
        const storedPincode = localStorage.getItem('user_pincode');

        // If a valid pincode is already stored and the input field is empty, use the stored one
        if (storedPincode && isValidPincode(storedPincode) && pincode === '') {
            onPincodeSelect(storedPincode);
            onClose();
            return;
        }

        if (isValidPincode(pincode)) {
            localStorage.setItem('user_pincode', pincode);
            onPincodeSelect(pincode);
            onClose();
        } else {
            setError('Please enter a valid 6-digit pincode');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative w-full max-w-md rounded-2xl border border-[var(--rf-color-border)] bg-white p-6 shadow-[0_18px_32px_rgba(0,0,0,0.12)] animate-in fade-in zoom-in duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="text-center pt-2">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#EFF6FF]">
                        <svg className="h-8 w-8 text-[var(--rf-color-primary-green-dark)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">Find Properties Near You</h3>
                    <p className="text-gray-600 mb-6">Enter your pincode to see properties in your area</p>

                    <div className="mb-6">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 text-left">
                            Your Pincode
                        </label>
                        <input
                            type="text"
                            name="pincode"
                            maxLength={6}
                            className="w-full h-12 rounded-xl border-2 border-[var(--rf-color-border)] bg-[var(--rf-color-page)] px-4 text-center text-lg font-semibold text-gray-800 placeholder:text-gray-400 transition-all focus:border-[var(--rf-color-primary-green)] focus:bg-white focus:ring-4 focus:ring-[rgba(59, 130, 246,0.12)]"
                            placeholder="e.g. 560001"
                            value={pincode}
                            onChange={(e) => {
                                const value = e.target.value.replace(/\D/g, ''); // Only digits
                                setPincode(value);
                                setError('');
                            }}
                            onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
                            autoFocus
                        />
                        {error && (
                            <p className="text-red-500 text-sm mt-2">{error}</p>
                        )}
                    </div>

                    <button
                        onClick={handleSubmit}
                        className="w-full rounded-xl bg-[linear-gradient(135deg,#3B82F6_0%,#2563EB_100%)] py-3 font-bold text-white transition-all hover:scale-105 hover:shadow-lg"
                    >
                        Search Properties
                    </button>

                    <p className="text-xs text-gray-400 mt-4">
                        Your pincode will be saved for future searches
                    </p>
                </div>
            </div>
        </div>
    );
};


