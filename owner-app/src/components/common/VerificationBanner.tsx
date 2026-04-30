import React, { useState } from 'react';
import { IoWarning } from 'react-icons/io5';
import { useOwner } from '../../hooks/useOwner';
import Modal from './Modal';
import { IoClose } from 'react-icons/io5';

const VerificationBanner: React.FC = () => {
    const { verificationStatus } = useOwner();
    const [isVisible, setIsVisible] = useState(true);
    const [showContactModal, setShowContactModal] = useState(false);

    // Don't show if verified or dismissed (handled by state for now)
    if (verificationStatus || !isVisible) return null;

    return (
        <>
            <div className="bg-amber-50 border-b border-amber-200 sticky top-16 md:top-20 z-40 animate-fade-in-up">
                <div className="container mx-auto px-4 py-3 flex items-start md:items-center justify-between gap-4">
                    <div className="flex items-start md:items-center gap-3">
                        <IoWarning className="text-amber-500 text-xl shrink-0 mt-0.5 md:mt-0" />
                        <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
                            <p className="text-sm md:text-base text-amber-800 font-medium">
                                Account Pending Verification
                            </p>
                            <span className="hidden md:inline text-amber-300">|</span>
                            <p className="text-xs md:text-sm text-amber-700">
                                Property creation stays locked until your bank verification succeeds.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">

                        <button
                            onClick={() => setShowContactModal(true)}
                            className="text-xs md:text-sm font-semibold text-amber-700 hover:text-amber-900 underline"
                        >
                            Contact Admin
                        </button>
                        <button
                            onClick={() => setIsVisible(false)}
                            className="p-1 hover:bg-amber-100 rounded-full transition-colors"
                        >
                            <IoClose className="text-amber-500" />
                        </button>
                    </div>
                </div>
            </div>

            <Modal
                isOpen={showContactModal}
                onClose={() => setShowContactModal(false)}
                title="Contact Administrator"
            >
                <div className="p-4 space-y-4">
                    <p className="text-gray-600">
                        For any queries regarding your account verification status, please contact our administrative team:
                    </p>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                        <p className="font-semibold text-gray-900">Email: <a href="mailto:kommurajesh298@gmail.com" className="text-primary hover:underline">kommurajesh298@gmail.com</a></p>
                        <p className="text-gray-500 text-sm mt-1">Typical response time: 24 hours</p>
                    </div>
                    <div className="flex justify-end">
                        <button
                            onClick={() => setShowContactModal(false)}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-medium"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
};

export default VerificationBanner;
