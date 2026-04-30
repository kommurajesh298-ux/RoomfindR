import React from 'react';
import { IoCheckmarkCircleOutline, IoTimeOutline } from 'react-icons/io5';

interface OwnerApprovalPopupProps {
    open: boolean;
    onClose: () => void;
}

const OwnerApprovalPopup: React.FC<OwnerApprovalPopupProps> = ({ open, onClose }) => {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-8 duration-500 delay-100">
                <div className="bg-blue-50 p-8 flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-4 text-blue-600">
                        <IoCheckmarkCircleOutline size={48} />
                    </div>
                    <h3 className="text-2xl font-black text-gray-900 leading-tight">
                        Payment Successful
                    </h3>
                    <p className="text-gray-600 mt-2 font-medium">
                        Your payment is received. Please wait for owner approval.
                    </p>
                </div>

                <div className="p-8">
                    <div className="bg-gray-50 rounded-2xl p-5 mb-6 border border-gray-100">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-full bg-white text-blue-600 flex items-center justify-center shadow-sm">
                                <IoTimeOutline size={22} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-gray-900">Approval Pending</p>
                                <p className="text-xs text-gray-500 leading-relaxed mt-1">
                                    The owner will review your request soon. You'll be notified once approved.
                                </p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full h-14 bg-gray-900 text-white rounded-2xl font-bold uppercase tracking-widest text-[11px] hover:bg-black transition-all"
                    >
                        Okay, Got It
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OwnerApprovalPopup;

