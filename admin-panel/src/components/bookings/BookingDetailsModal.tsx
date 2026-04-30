import React, { useEffect, useState, useCallback } from 'react';
import { BookingService } from '../../services/booking.service';
import { format } from 'date-fns';
import type { PlatformBooking } from '../../types/booking.types';
import { FiX, FiClock, FiDollarSign, FiMessageSquare } from 'react-icons/fi';
import { getBookingGstSummary } from '../../utils/gst';

interface BookingDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    bookingId: string;
}

interface BookingPayment {
    id: string;
    amount: number | string;
    payment_date?: string;
    created_at?: string;
    payment_type?: string;
    payment_method?: string;
    provider?: string;
    provider_payment_id?: string;
    provider_order_id?: string;
    status: string;
    [key: string]: unknown;
}

interface ExtendedBookingDetails extends PlatformBooking {
    payments: BookingPayment[];
    chats: Record<string, unknown>[];
    history: Record<string, unknown>[];
    updatedAt?: string;
}

const BookingDetailsModal: React.FC<BookingDetailsModalProps> = ({ isOpen, onClose, bookingId }) => {
    const [details, setDetails] = useState<ExtendedBookingDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'info' | 'chat' | 'history'>('info');

    const fetchDetails = useCallback(() => {
        if (!bookingId) return;
        setLoading(true);
        BookingService.getBookingDetails(bookingId)
            .then(data => setDetails(data as unknown as ExtendedBookingDetails))
            .catch(() => setDetails(null))
            .finally(() => setLoading(false));
    }, [bookingId]);

    useEffect(() => {
        if (isOpen && bookingId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            fetchDetails();
        }
    }, [isOpen, bookingId, fetchDetails]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-40 flex justify-end">
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-2xl bg-white shadow-2xl h-full flex flex-col transform transition-transform duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">Booking Details</h2>
                        <p className="text-sm text-slate-500">#{bookingId.slice(0, 8)}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-full text-slate-500"
                    >
                        <FiX size={24} />
                    </button>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
                    </div>
                ) : details ? (
                    <>
                        {/* Tabs */}
                        <div className="flex border-b border-slate-100 px-6">
                            {(['info', 'chat', 'history'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`py-3 px-4 text-sm font-semibold capitalize border-b-2 transition-colors ${activeTab === tab
                                        ? 'border-slate-900 text-slate-900'
                                        : 'border-transparent text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {activeTab === 'info' && (
                                <div className="space-y-8">
                                    {details && (() => {
                                        const gstSummary = getBookingGstSummary(details);
                                        return (
                                            <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-2">
                                                <div className="space-y-2">
                                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Invoice Summary</p>
                                                    <div className="flex justify-between gap-4 text-sm">
                                                        <span className="text-slate-500">{gstSummary.roomChargeLabel}</span>
                                                        <span className="font-bold text-slate-900">INR {gstSummary.roomCharge.toLocaleString('en-IN')}</span>
                                                    </div>
                                                    {gstSummary.usesStructuredTaxes && (
                                                        <>
                                                            <div className="flex justify-between gap-4 text-sm">
                                                                <span className="text-slate-500">Room GST</span>
                                                                <span className="font-bold text-slate-900">INR {gstSummary.roomGst.toLocaleString('en-IN')}</span>
                                                            </div>
                                                            <div className="flex justify-between gap-4 text-sm">
                                                                <span className="text-slate-500">Platform Fee + GST</span>
                                                                <span className="font-bold text-orange-600">INR {(gstSummary.platformFee + gstSummary.platformGst).toLocaleString('en-IN')}</span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                                <div className="space-y-2">
                                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Totals</p>
                                                    <div className="flex justify-between gap-4 text-sm">
                                                        <span className="text-slate-500">Customer Paid</span>
                                                        <span className="font-bold text-slate-900">INR {(gstSummary.amountPaid || gstSummary.totalAmount).toLocaleString('en-IN')}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4 text-sm">
                                                        <span className="text-slate-500">Owner Share</span>
                                                        <span className="font-bold text-blue-700">INR {gstSummary.ownerGrossAmount.toLocaleString('en-IN')}</span>
                                                    </div>
                                                    {gstSummary.balanceDue > 0 && (
                                                        <div className="flex justify-between gap-4 text-sm">
                                                            <span className="text-slate-500">Balance Due</span>
                                                            <span className="font-bold text-orange-600">INR {gstSummary.balanceDue.toLocaleString('en-IN')}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    <header>
                                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 ${details.status === 'accepted' ? 'bg-blue-100 text-blue-700' :
                                            details.status === 'checked-in' ? 'bg-purple-100 text-purple-700' :
                                                details.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                                    details.status === 'disputed' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'
                                            }`}>
                                            {details.status}
                                        </span>
                                        <p className="text-slate-500 text-sm mt-1">
                                            Created on {details.createdAt ? format(new Date(details.createdAt), 'PPP p') : 'N/A'}
                                        </p>
                                    </header>

                                    <div className="grid grid-cols-2 gap-6 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                                        <div>
                                            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-1">Property</h4>
                                            <p className="font-semibold text-slate-900 line-clamp-1">{details.propertyName || 'N/A'}</p>
                                            <p className="text-sm text-slate-500">ID: {details.propertyId}</p>
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-1">Duration</h4>
                                            <p className="font-semibold text-slate-900">
                                                {(() => {
                                                    const fts = (date: string | Date | undefined) => date ? format(new Date(date), 'MMM d, yyyy') : '-';
                                                    return `${fts(details.startDate)} - ${fts(details.endDate)}`;
                                                })()}
                                            </p>
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-1">Customer</h4>
                                            <p className="font-semibold text-slate-900">{details.customerName || 'N/A'}</p>
                                            <p className="text-sm text-slate-500">{details.customerId}</p>
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-1">Owner</h4>
                                            <p className="font-semibold text-slate-900">{details.ownerName || 'N/A'}</p>
                                            <p className="text-sm text-slate-500">{details.ownerId}</p>
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                                            <FiDollarSign className="text-blue-500" />
                                            Payment History
                                        </h3>
                                        {details.payments && details.payments.length > 0 ? (
                                            <div className="border rounded-xl border-slate-200 overflow-hidden bg-white">
                                                <table className="w-full text-sm text-left">
                                                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                                                        <tr>
                                                            <th className="p-4">Date</th>
                                                            <th className="p-4">Method</th>
                                                            <th className="p-4">Amount</th>
                                                            <th className="p-4">Status</th>
                                                            <th className="p-4">Provider Ref</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {details.payments.map((payment: BookingPayment, idx: number) => (
                                                            <tr key={payment.id || idx} className="hover:bg-slate-50/50 transition-colors">
                                                                <td className="p-4 text-slate-600">
                                                                    {format(new Date(payment.payment_date || payment.created_at || new Date().toISOString()), 'MMM d, yyyy')}
                                                                </td>
                                                                <td className="p-4 text-slate-500">{(payment.payment_method || payment.payment_type || payment.provider || 'booking').toString()}</td>
                                                                <td className="p-4 font-bold text-slate-900">INR {Number(payment.amount).toLocaleString()}</td>
                                                                <td className="p-4">
                                                                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold capitalize">
                                                                        {payment.status}
                                                                    </span>
                                                                </td>
                                                                <td className="p-4">
    <span className="text-slate-500 text-xs">{payment.provider_payment_id || payment.provider_order_id || '-'}</span>
</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <div className="p-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center">
                                                <div className="text-slate-400 mb-2">No payment records found.</div>
                                                <div className="font-bold text-slate-900">Total Paid: INR {details.amountPaid || 0}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'chat' && (
                                <div className="space-y-4">
                                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <FiMessageSquare className="text-blue-500" />
                                        Resolution Chat Logs
                                    </h3>
                                    {details.chats && details.chats.length > 0 ? (
                                        <div className="space-y-4">
                                            {details.chats.map((chat: Record<string, unknown>) => (
                                                <div key={chat.id as string} className="p-4 border rounded-xl bg-slate-50">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="font-semibold text-sm">Chat ID: {(chat.id as string).slice(0, 8)}</span>
                                                        <span className="text-xs text-slate-500">
                                                            {chat.updatedAt ? format(new Date(chat.updatedAt as string), 'MMM d, p') : ''}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-slate-600">
                                                        {(chat.lastMessage as string) || 'No recent messages'}
                                                    </p>
                                                    <button className="text-xs text-blue-600 mt-2 font-medium hover:underline">
                                                        View Full Transcript
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-8 text-center bg-slate-50 rounded-xl text-slate-500">
                                            No chat logs available for this booking.
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'history' && (
                                <div className="space-y-4">
                                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <FiClock className="text-blue-500" />
                                        Status Timeline
                                    </h3>
                                    <div className="space-y-6 relative before:absolute before:left-2 before:top-2 before:bottom-0 before:w-0.5 before:bg-slate-200 ml-2">
                                        {/* Current Status */}
                                        <div className="relative pl-8">
                                            <div className="absolute left-0 top-1 w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-sm z-10"></div>
                                            <p className="text-sm font-semibold text-slate-900">Current Status: {details.status}</p>
                                            <p className="text-xs text-slate-500">
                                                {details.updatedAt ? format(new Date(details.updatedAt), 'PPP p') : 'Just now'}
                                            </p>
                                        </div>

                                        {/* History Items from Audit Logs */}
                                        {details.history && details.history.length > 0 && details.history.map((log: Record<string, unknown>, idx: number) => (
                                            <div key={idx} className="relative pl-8">
                                                <div className="absolute left-0 top-1 w-4 h-4 bg-slate-300 rounded-full border-2 border-white shadow-sm z-10"></div>
                                                <p className="text-sm font-medium text-slate-700">
                                                    {log.action === 'booking_status_change' ? `Changed to ${log.newStatus}` :
                                                        log.action === 'booking_refund' ? 'Refund Processed' : log.action as string}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    by {(log.adminEmail as string) || (log.adminId as string)} on {log.timestamp ? format(new Date(log.timestamp as string), 'PPP p') : 'Unknown Date'}
                                                </p>
                                                {(log.reason as string) && <p className="text-xs text-slate-500 italic mt-1">"{(log.reason as string)}"</p>}
                                            </div>
                                        ))}

                                        {/* Creation */}
                                        <div className="relative pl-8">
                                            <div className="absolute left-0 top-1 w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-sm z-10"></div>
                                            <p className="text-sm font-semibold text-slate-900">Booking Created</p>
                                            <p className="text-xs text-slate-500">{details.createdAt ? format(new Date(details.createdAt), 'PPP p') : ''}</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="p-8 text-center text-red-500">
                        Failed to load booking details.
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookingDetailsModal;

