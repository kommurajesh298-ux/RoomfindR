import React from 'react';
import { IoClose, IoChatbubble, IoLocationOutline, IoCalendarOutline, IoPersonOutline, IoReceiptOutline } from 'react-icons/io5';
import { format } from 'date-fns';
import type { BookingWithDetails } from '../../types/booking.types';
import { useNavigate } from 'react-router-dom';
import { bookingService } from '../../services/booking.service';
import { formatCurrency } from '../../utils/currency';
import { getBookingGstSummary } from '../../utils/gst';

interface BookingPayment {
    id: string;
    amount: number;
    payment_date: string;
    notes?: string;
    created_at: string;
    payment_type?: string;
    status?: string;
    provider_order_id?: string;
    provider_payment_id?: string;
    [key: string]: unknown;
}

const normalizePaymentState = (value: unknown) => String(value || '').trim().toLowerCase();
const isVerifiedPayment = (payment: BookingPayment) => ['paid', 'completed', 'success', 'authorized'].includes(normalizePaymentState(payment.status));
const isMonthlyPayment = (payment: BookingPayment) => ['monthly', 'rent'].includes(normalizePaymentState(payment.payment_type));

interface BookingDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    booking: (BookingWithDetails & { payments?: BookingPayment[] }) | null;
}

const BookingDetailsModal: React.FC<BookingDetailsModalProps> = ({ isOpen, onClose, booking }) => {
    const [payments, setPayments] = React.useState<BookingPayment[]>(booking?.payments || []);

    const navigate = useNavigate();

    React.useEffect(() => {
        if (isOpen && booking?.bookingId) {
            const unsubscribe = bookingService.subscribeToBookingPayments(booking.bookingId, (data) => {
                setPayments(data as unknown as BookingPayment[]);
            });
            return () => unsubscribe();
        }
    }, [isOpen, booking?.bookingId]);

    if (!isOpen || !booking) return null;

    const startDate = new Date(booking.startDate);
    const endDate = new Date(booking.endDate);
    const monthlyPayments = payments.filter(isMonthlyPayment);
    const gstSummary = getBookingGstSummary(booking);

    const handleRaiseSupport = () => {
        // Navigate to support ticket list
        navigate('/chat');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-white sticky top-0 z-10">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Booking Details</h3>
                        <p className="text-sm text-gray-500">ID: {booking.bookingId}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <IoClose size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
                    {/* Customer & Action */}
                    <section className="flex flex-col sm:flex-row justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-primary-100 flex items-center justify-center text-primary-600">
                                <IoPersonOutline size={32} />
                            </div>
                            <div>
                                <h4 className="text-lg font-bold text-gray-900">{booking.customerName || 'Customer'}</h4>
                                <p className="text-gray-500">{booking.customerEmail || 'No email provided'}</p>
                                <p className="text-gray-500 font-medium">{booking.customerPhone || 'No phone'}</p>
                            </div>
                        </div>
                        <button
                            onClick={handleRaiseSupport}
                            className="h-12 px-6 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-primary-200 flex items-center justify-center gap-2"
                        >
                            <IoChatbubble size={20} /> Support Ticket
                        </button>
                    </section>

                    {/* Property Info */}
                    <section className="space-y-4">
                        <h5 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                            <IoLocationOutline /> Property Details
                        </h5>
                        <div className="p-5 rounded-2xl border border-gray-100 bg-gray-50 space-y-3">
                            <div className="font-bold text-gray-900 border-b border-gray-100 pb-2 flex justify-between items-center">
                                <span>{booking.propertyTitle || booking.propertyDetails?.title || 'Unknown Property'}</span>
                                <span className="text-primary-600 bg-primary-50 px-3 py-1 rounded-lg text-xs">Room {booking.roomNumber || 'N/A'}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-500">Room Type</label>
                                    <p className="font-medium text-gray-800">Shared/Private Room</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500">Address</label>
                                    <p className="font-medium text-gray-800">{booking.propertyDetails?.address.text}</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Timeline & Duration */}
                    <section className="space-y-4">
                        <h5 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                            <IoCalendarOutline /> Stay Timeline
                        </h5>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 text-center">
                                <label className="block text-xs text-blue-600 mb-1">Check-In</label>
                                <p className="font-bold text-blue-900">{format(startDate, 'dd MMM yyyy')}</p>
                            </div>
                            <div className="p-4 rounded-2xl bg-orange-50 border border-orange-100 text-center">
                                <label className="block text-xs text-orange-600 mb-1">Check-Out</label>
                                <p className="font-bold text-orange-900">{format(endDate, 'dd MMM yyyy')}</p>
                            </div>
                            <div className="p-4 rounded-2xl bg-purple-50 border border-purple-100 text-center">
                                <label className="block text-xs text-purple-600 mb-1">Duration</label>
                                <p className="font-bold text-purple-900">{booking.durationMonths} {booking.durationMonths === 1 ? 'Month' : 'Months'}</p>
                            </div>
                        </div>
                    </section>

                    {/* Payment History & Summary */}
                    <section className="space-y-4">
                        <div className="space-y-2">
                            <h5 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                <IoReceiptOutline /> Financial Ledger
                            </h5>
                            <p className="text-xs text-gray-500">
                                Only Cashfree-verified payments are included here. Monthly rent is marked paid only after checkout and backend confirmation.
                            </p>
                        </div>

                        <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
                            <table className="min-w-[520px] w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="px-6 py-3 font-bold">Financial Summary</th>
                                        <th className="px-6 py-3 font-bold text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 bg-white">
                                    <tr>
                                        <td className="px-6 py-4 text-gray-600">{gstSummary.roomChargeLabel}</td>
                                        <td className="px-6 py-4 font-bold text-right text-gray-900">{formatCurrency(gstSummary.roomCharge)}</td>
                                    </tr>
                                    {gstSummary.usesStructuredTaxes && (
                                        <>
                                            <tr>
                                                <td className="px-6 py-4 text-gray-600">Room GST ({Math.round(gstSummary.roomGstRate * 100)}%)</td>
                                                <td className="px-6 py-4 font-bold text-right text-gray-900">{formatCurrency(gstSummary.roomGst)}</td>
                                            </tr>
                                            <tr>
                                                <td className="px-6 py-4 text-gray-600">Platform Fee</td>
                                                <td className="px-6 py-4 font-bold text-right text-gray-900">{formatCurrency(gstSummary.platformFee)}</td>
                                            </tr>
                                            <tr>
                                                <td className="px-6 py-4 text-gray-600">GST on Platform Fee ({Math.round(gstSummary.platformGstRate * 100)}%)</td>
                                                <td className="px-6 py-4 font-bold text-right text-gray-900">{formatCurrency(gstSummary.platformGst)}</td>
                                            </tr>
                                            <tr className="bg-slate-50">
                                                <td className="px-6 py-4 font-bold text-gray-900">Customer Total Payable</td>
                                                <td className="px-6 py-4 font-black text-right text-gray-900">{formatCurrency(gstSummary.totalAmount)}</td>
                                            </tr>
                                            <tr>
                                                <td className="px-6 py-4 text-gray-600">Owner Gross Share</td>
                                                <td className="px-6 py-4 font-bold text-right text-primary-600">{formatCurrency(gstSummary.ownerGrossAmount)}</td>
                                            </tr>
                                        </>
                                    )}
                                    {booking.offerApplied && (
                                        <tr className="text-blue-700 bg-blue-50/30">
                                            <td className="px-6 py-4 font-bold">Total Discount Applied ({booking.offerCode})</td>
                                            <td className="px-6 py-4 font-black text-right">- {formatCurrency(booking.discountAmount)}</td>
                                        </tr>
                                    )}
                                    <tr className="bg-primary-50/30 border-t border-primary-100">
                                        <td className="px-6 py-4 font-black text-primary-900">Customer Amount Paid</td>
                                        <td className="px-6 py-4 font-black text-right text-primary-600 text-lg">
                                            {formatCurrency(gstSummary.amountPaid || gstSummary.totalAmount)}
                                        </td>
                                    </tr>
                                    {gstSummary.balanceDue > 0 && (
                                        <tr>
                                            <td className="px-6 py-4 font-bold text-orange-700">Balance Due</td>
                                            <td className="px-6 py-4 font-black text-right text-orange-600">{formatCurrency(gstSummary.balanceDue)}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* Monthly Payments Detailed List */}
                    <section className="space-y-4">
                        <h5 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                            <IoReceiptOutline /> Monthly Payment History
                        </h5>
                        <div className="overflow-x-auto rounded-2xl border border-gray-100">
                            {monthlyPayments.length > 0 ? (
                                <table className="min-w-[560px] w-full text-left text-sm">
                                    <thead className="bg-gray-50 text-gray-500">
                                        <tr>
                                            <th className="px-6 py-3 font-bold">Date</th>
                                            <th className="px-6 py-3 font-bold">Notes</th>
                                            <th className="px-6 py-3 font-bold">Status</th>
                                            <th className="px-6 py-3 font-bold text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {monthlyPayments.map((payment, idx) => (
                                            <tr key={payment.id || idx}>
                                                <td className="px-6 py-4">{format(new Date(payment.payment_date || payment.created_at), 'dd MMM yyyy')}</td>
                                                <td className="px-6 py-4 text-gray-500">{payment.notes || 'Monthly Rent'}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${isVerifiedPayment(payment)
                                                        ? 'bg-blue-50 text-blue-700'
                                                        : 'bg-amber-50 text-amber-700'
                                                        }`}>
                                                        {isVerifiedPayment(payment) ? 'Verified' : normalizePaymentState(payment.status) || 'Pending'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-right text-blue-600">{formatCurrency(Number(payment.amount))}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-8 text-center text-gray-400 bg-gray-50">
                                    No customer monthly payments recorded yet.
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-8 h-12 bg-white border border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-100 transition-colors shadow-sm"
                    >
                        Close Details
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookingDetailsModal;

