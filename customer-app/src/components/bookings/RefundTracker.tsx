import React from 'react';
import { motion } from 'framer-motion';
import { FaCircleCheck, FaClock, FaRotate, FaMoneyBillWave } from 'react-icons/fa6';
import type { Refund } from '../../types/booking.types';

interface RefundTrackerProps {
    refund: Refund | null;
    status: string;
}

const RefundTracker: React.FC<RefundTrackerProps> = ({ refund, status }) => {
    // 1. Rejected (Always true if this component is shown)
    // 2. Refund Initiated (When refund record exists)
    // 3. Processing / Hold (Status: PROCESSING or ONHOLD)
    // 4. Completed (Status: SUCCESS)

    const isRejected = ['rejected'].includes(status);
    const isInitiated = !!refund;
    const isPendingReview = refund?.status === 'PENDING';
    const isOnHold = refund?.status === 'ONHOLD';
    const isProcessing = refund?.status === 'PROCESSING';
    const isSuccess = refund?.status === 'SUCCESS' || refund?.status === 'PROCESSED';

    const stages = [
        {
            id: 'rejected',
            label: 'Rejected by Owner',
            isDone: isRejected,
            icon: FaCircleCheck,
            color: 'text-rose-500'
        },
        {
            id: 'initiated',
            label: 'Refund Initiated',
            isDone: isInitiated,
            icon: isInitiated ? FaCircleCheck : FaClock,
            color: isInitiated ? 'text-indigo-500' : 'text-gray-300'
        },
        {
            id: 'processing',
            label: isOnHold ? 'Gateway On Hold' : 'Bank Processing',
            isDone: isProcessing || isOnHold || isSuccess,
            isActive: isProcessing,
            icon: isProcessing ? FaRotate : (isSuccess || isOnHold ? FaCircleCheck : FaClock),
            color: (isProcessing || isOnHold || isSuccess) ? 'text-indigo-500' : 'text-gray-300'
        },
        {
            id: 'success',
            label: 'Money Refunded',
            isDone: isSuccess,
            icon: FaMoneyBillWave,
            color: isSuccess ? 'text-blue-500' : 'text-gray-300'
        }
    ];

    return (
        <div className="mt-4 p-4 bg-gray-50/50 rounded-3xl border border-gray-100">
            <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Refund Progress</h4>
                {isSuccess && <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg uppercase tracking-tight">Completed</span>}
            </div>

            <div className="relative flex justify-between items-start pt-2">
                {/* Connecting Line */}
                <div className="absolute top-[18px] left-[10%] right-[10%] h-[2px] bg-gray-100 z-0">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: isSuccess ? '100%' : ((isProcessing || isOnHold) ? '66%' : (isInitiated ? '33%' : '0%')) }}
                        className="h-full bg-indigo-500"
                    />
                </div>

                {stages.map((stage) => {
                    const Icon = stage.icon;
                    return (
                        <div key={stage.id} className="relative z-10 flex flex-col items-center w-1/4">
                            <motion.div
                                initial={{ scale: 0.8 }}
                                animate={{
                                    scale: stage.isActive ? [1, 1.2, 1] : 1,
                                    backgroundColor: stage.isDone ? '#6366f1' : '#f3f4f6'
                                }}
                                transition={stage.isActive ? { repeat: Infinity, duration: 2 } : {}}
                                className={`w-9 h-9 rounded-full flex items-center justify-center border-4 border-white shadow-sm ${stage.isDone ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-300'}`}
                            >
                                <Icon className={`w-4 h-4 ${stage.isActive ? 'animate-spin' : ''}`} />
                            </motion.div>
                            <span className={`mt-2 text-[8px] font-black text-center leading-tight uppercase tracking-tighter w-full px-1 ${stage.isDone ? 'text-slate-900' : 'text-gray-400'}`}>
                                {stage.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className="mt-4 text-[9px] font-bold text-gray-400 text-center leading-relaxed">
                {isSuccess
                    ? "Your refund has been processed. It may take 5-7 business days to reflect in your bank account."
                    : isPendingReview
                        ? "Your refund request is waiting for admin review. You'll see the status move forward here once it is approved."
                        : isOnHold
                            ? "Cashfree has placed this refund on hold. We'll keep checking automatically and update it here as soon as the gateway releases it."
                        : "Refunds for rejected bookings are initiated automatically. You'll see real-time updates here."
                }
            </div>
        </div>
    );
};

export default RefundTracker;

