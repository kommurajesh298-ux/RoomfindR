import React from 'react';
import { IoCloseCircleOutline, IoRocketOutline, IoArrowForwardOutline } from 'react-icons/io5';
import type { Booking } from '../../types/booking.types';

interface RejectionPopupProps {
    booking: Booking;
    onClose: () => void;
    onExplore: () => void;
}

const RejectionPopup: React.FC<RejectionPopupProps> = ({ booking, onClose, onExplore }) => {
    const advancePaid = booking.advancePaid || 0;
    const platformFee = Math.round(advancePaid * 0.05);
    const refundAmount = advancePaid - platformFee;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-8 duration-500 delay-100">
                {/* Header with Icon */}
                <div className="bg-red-50 p-8 flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-4 text-red-600 animate-bounce-subtle">
                        <IoCloseCircleOutline size={48} />
                    </div>
                    <h3 className="text-2xl font-black text-gray-900 leading-tight">
                        Booking Not Confirmed
                    </h3>
                    <p className="text-gray-600 mt-2 font-medium">
                        Owner rejected your request for this room.
                    </p>
                </div>

                {/* Content */}
                <div className="p-8">
                    <div className="bg-gray-50 rounded-2xl p-5 mb-6 border border-gray-100">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Refund Information</h4>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-600 font-medium">Advance Paid</span>
                                <span className="text-gray-900 font-bold">₹{advancePaid}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-600 font-medium">Platform Fee (5%)</span>
                                <span className="text-red-500 font-bold">- ₹{platformFee}</span>
                            </div>
                            <div className="h-px bg-gray-200 my-1"></div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-900 font-black">Refund Amount</span>
                                <span className="text-primary-600 font-black text-xl">₹{refundAmount}</span>
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-gray-200 flex gap-2 items-start">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 shrink-0"></div>
                            <p className="text-xs text-gray-500 leading-relaxed font-medium">
                                Your refund will be credited to your original payment method within <span className="text-gray-900 font-bold">1–2 working days</span>.
                            </p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                        <button
                            onClick={onExplore}
                            className="w-full h-14 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary-200 transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <IoRocketOutline size={20} />
                            Explore Available Rooms
                            <IoArrowForwardOutline className="ml-1" />
                        </button>
                        <button
                            onClick={onClose}
                            className="w-full h-14 bg-white hover:bg-gray-50 text-gray-500 rounded-2xl font-bold transition-all border border-transparent hover:border-gray-100"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RejectionPopup;
