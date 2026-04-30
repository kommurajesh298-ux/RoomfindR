import React from 'react';
import type { BookingWithDetails, MonthlyPayment } from '../../types/booking.types';

interface MonthlyPaymentsModalProps {
    booking: BookingWithDetails | null;
    payments: MonthlyPayment[];
    isOpen: boolean;
    onClose: () => void;
    onPayNow: (_payment: MonthlyPayment) => void;
    isProcessing?: boolean;
}

const MonthlyPaymentsModal: React.FC<MonthlyPaymentsModalProps> = ({
    booking,
    payments,
    isOpen,
    onClose,
    onPayNow,
    isProcessing = false
}) => {
    if (!isOpen || !booking) return null;

    const handlePayNow = (payment: MonthlyPayment) => {
        if (!isProcessing) onPayNow(payment);
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 h-auto max-h-[90vh] flex flex-col no-scrollbar">
                {/* Header */}
                <div className="bg-white px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-800">Monthly Payments</h2>
                        <p className="text-xs sm:text-sm text-gray-500">{booking.propertyDetails?.title}</p>
                        <p className="text-xs text-blue-600 font-semibold mt-1">
                            Joined: {new Date(booking.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors bg-gray-50 rounded-full p-1.5 sm:p-2 hover:bg-gray-100"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-gray-50">
                    <div className="relative">
                        {/* Vertical Line */}
                        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>

                        <div className="space-y-8">
                            {payments.map((payment, index) => {
                                const isPaid = payment.status === 'paid';
                                const isDueNow = ['pending', 'overdue', 'failed'].includes(payment.status);
                                const isUpcoming = payment.status === 'upcoming';
                                const isCurrent = isDueNow;
                                const statusLabel = isPaid
                                    ? 'PAID'
                                    : payment.status === 'failed'
                                        ? 'RETRY'
                                        : payment.status === 'overdue'
                                            ? 'OVERDUE'
                                            : payment.status === 'pending'
                                                ? 'DUE NOW'
                                                : 'UPCOMING';

                                return (
                                    <div key={index} className="relative pl-14">
                                        {/* Status Dot */}
                                        <div className={`absolute left-[1.15rem] -translate-x-1/2 w-6 h-6 rounded-full border-4 border-gray-50 flex items-center justify-center z-10 ${isPaid ? 'bg-blue-500' : isCurrent ? 'bg-blue-500 ring-4 ring-blue-100' : 'bg-gray-300'
                                            }`}>
                                            {isPaid && (
                                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </div>

                                        {/* Card */}
                                        <div className={`bg-white rounded-lg p-5 shadow-sm border ${isCurrent ? 'border-blue-200 shadow-md transform scale-[1.02] transition-transform' : 'border-gray-100'
                                            }`}>
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <h3 className="font-semibold text-gray-900 text-base sm:text-lg">
                                                        Month {index + 1} - {new Date(payment.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                                                    </h3>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium ${isPaid ? 'bg-blue-100 text-blue-800' :
                                                            isDueNow ? 'bg-red-100 text-red-700' :
                                                                'bg-gray-100 text-gray-600'
                                                            }`}>
                                                            {statusLabel}
                                                        </span>
                                                        {isPaid && (
                                                            <span className="text-[10px] sm:text-xs text-gray-500">
                                                                Paid on {payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('en-IN') : 'N/A'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-lg sm:text-xl font-bold text-gray-900">Rs {payment.amount.toLocaleString()}</p>
                                                    <p className="text-[10px] sm:text-xs text-gray-500">Rent + Tax</p>
                                                </div>
                                            </div>

                                            {!isPaid && (
                                                <div className="mt-4 pt-4 border-t border-gray-50">
                                                    {isDueNow ? (
                                                        <button
                                                            onClick={() => handlePayNow(payment)}
                                                            disabled={isProcessing}
                                                            className={`w-full py-1.5 sm:py-2.5 bg-blue-600 text-white font-medium text-sm sm:text-base rounded-lg hover:bg-blue-700 transition-colors shadow-sm flex items-center justify-center gap-2 ${isProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
                                                        >
                                                            <span>{isProcessing ? 'Processing...' : payment.status === 'failed' ? 'Retry Payment' : 'Pay Now'}</span>
                                                            {!isProcessing && (
                                                                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            disabled
                                                            className="w-full py-2.5 bg-gray-100 text-gray-400 font-medium rounded-lg cursor-not-allowed border border-gray-200"
                                                        >
                                                            {isUpcoming ? 'Upcoming' : 'Waiting'}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer Summary */}
                <div className="p-4 bg-white border-t border-gray-100 shrink-0">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">Total Progress</span>
                        <span className="font-medium text-gray-900">
                            {payments.filter(p => p.status === 'paid').length} / {payments.length} Months Paid
                        </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                        <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${(payments.filter(p => p.status === 'paid').length / payments.length) * 100}%` }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MonthlyPaymentsModal;

