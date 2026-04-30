import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { paymentService, type RentPaymentRow, type RentPaymentSummary } from '../services/payment.service';

const Rent: React.FC = () => {
    const [payments, setPayments] = useState<RentPaymentRow[]>([]);
    const [summary, setSummary] = useState<RentPaymentSummary>({
        total: 0,
        successful: 0,
        processing: 0,
        totalAmount: 0,
        commissionAmount: 0,
        ownerPayoutAmount: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        const refreshSummary = async () => {
            try {
                const nextSummary = await paymentService.getRentPaymentSummary();
                if (active) {
                    setSummary(nextSummary);
                }
            } catch (error) {
                if (import.meta.env.DEV) {
                    console.warn('[Rent] Failed to refresh rent summary:', error);
                }
            }
        };

        void refreshSummary();

        const unsubscribe = paymentService.subscribeToRentPayments((data) => {
            setPayments(data || []);
            void refreshSummary().finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        });

        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    const exportToCSV = () => {
        try {
            const headers = ['Payment ID', 'Booking ID', 'Customer', 'Property', 'Owner', 'Amount', 'Commission', 'Owner Payout', 'Payment Status', 'Payout Status', 'Reference', 'Created At'];
            const rows = payments.map((payment) => [
                payment.id,
                payment.booking_id,
                payment.bookings?.customer_name || 'Unknown',
                payment.bookings?.properties?.title || '-',
                payment.bookings?.owners?.name || '-',
                payment.amount,
                Number(payment.settlement?.platform_fee || 0),
                Number(payment.settlement?.net_payable || 0),
                payment.status,
                payment.payout_status_display || 'PENDING',
                payment.settlement?.provider_reference || payment.settlement?.provider_transfer_id || payment.provider_payment_id || payment.provider_order_id || '-',
                new Date(payment.created_at).toLocaleString('en-IN'),
            ]);

            const csvContent = [headers, ...rows].map((row) => row.join(',')).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'rent-payments.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch {
            toast.error('Failed to export rent data');
        }
    };

    const statusBadge = (status: string) => {
        const normalized = String(status || '').toLowerCase();
        if (['paid', 'completed', 'success', 'authorized'].includes(normalized)) return 'bg-blue-100 text-blue-700';
        if (normalized.includes('fail') || normalized.includes('cancel')) return 'bg-rose-100 text-rose-700';
        return 'bg-amber-100 text-amber-700';
    };

    const payoutBadge = (status?: string | null) => {
        const normalized = String(status || '').toLowerCase();
        if (['completed', 'success', 'paid'].includes(normalized)) return 'bg-blue-100 text-blue-700';
        if (['failed', 'cancelled', 'rejected'].includes(normalized)) return 'bg-rose-100 text-rose-700';
        if (normalized === 'not_created') return 'bg-orange-100 text-orange-700';
        if (normalized === 'not_applicable') return 'bg-slate-100 text-slate-600';
        if (['processing', 'initiated', 'pending'].includes(normalized)) return 'bg-amber-100 text-amber-700';
        return 'bg-slate-100 text-slate-600';
    };

    return (
        <div className="w-full space-y-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Rent Collections</h1>
                    <p className="text-sm text-slate-500">
                        Monthly rent payments and automatic owner payouts appear here. Summary cards use the full verified ledger, while the table stays capped to the latest 50 records for performance.
                    </p>
                </div>
                <button
                    onClick={exportToCSV}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700"
                >
                    Export CSV
                </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 sm:text-[10px]">Total rent payments</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-slate-900 xl:text-4xl">{summary.total}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-blue-100 bg-blue-50 p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-500 sm:text-[10px]">Successful</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-blue-700 xl:text-4xl">{summary.successful}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-amber-100 bg-amber-50 p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-500 sm:text-[10px]">Pending</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-amber-700 xl:text-4xl">{summary.processing}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 sm:text-[10px]">Collected amount</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-tight text-slate-900 xl:text-[2rem]">INR {summary.totalAmount.toLocaleString('en-IN')}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-orange-100 bg-orange-50 p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-500 sm:text-[10px]">Platform commission</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-tight text-orange-700 xl:text-[2rem]">INR {summary.commissionAmount.toLocaleString('en-IN')}</p>
                    <p className="mt-1 break-words text-[11px] text-orange-600/80">Owner net: INR {summary.ownerPayoutAmount.toLocaleString('en-IN')}</p>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                            <tr>
                                <th className="px-5 py-4">Customer</th>
                                <th className="px-5 py-4">Property</th>
                                <th className="px-5 py-4">Owner</th>
                                <th className="px-5 py-4">Amount</th>
                                <th className="px-5 py-4">Commission</th>
                                <th className="px-5 py-4">Owner Payout</th>
                                <th className="px-5 py-4">Payment Status</th>
                                <th className="px-5 py-4">Payout Status</th>
                                <th className="px-5 py-4">Reference</th>
                                <th className="px-5 py-4">Created</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {payments.map((payment) => (
                                <tr key={payment.id} className="hover:bg-slate-50/80">
                                    <td className="px-5 py-4">
                                        <div className="font-bold text-slate-900">{payment.bookings?.customer_name || 'Unknown'}</div>
                                        <div className="text-xs text-slate-400">#{payment.booking_id.slice(0, 8).toUpperCase()}</div>
                                    </td>
                                    <td className="px-5 py-4 text-slate-600">{payment.bookings?.properties?.title || '-'}</td>
                                    <td className="px-5 py-4 text-slate-600">{payment.bookings?.owners?.name || '-'}</td>
                                    <td className="px-5 py-4 font-bold text-slate-900">INR {Number(payment.amount || 0).toLocaleString('en-IN')}</td>
                                    <td className="px-5 py-4 text-slate-600">INR {Number(payment.settlement?.platform_fee || 0).toLocaleString('en-IN')}</td>
                                    <td className="px-5 py-4 font-bold text-slate-900">INR {Number(payment.settlement?.net_payable || 0).toLocaleString('en-IN')}</td>
                                    <td className="px-5 py-4">
                                        <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${statusBadge(payment.status)}`}>
                                            {String(payment.status || '').toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${payoutBadge(payment.payout_status_display)}`}>
                                            {String(payment.payout_status_display || 'pending').replace(/_/g, ' ').toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4 text-xs font-medium text-slate-500">
                                        {payment.settlement?.provider_reference || payment.settlement?.provider_transfer_id || payment.provider_payment_id || payment.provider_order_id || '-'}
                                    </td>
                                    <td className="px-5 py-4 text-slate-500">
                                        {new Date(payment.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </td>
                                </tr>
                            ))}
                            {!payments.length && !loading && (
                                <tr>
                                    <td colSpan={10} className="px-5 py-20 text-center text-slate-400">
                                        No verified monthly rent payments found yet.
                                    </td>
                                </tr>
                            )}
                            {loading && (
                                <tr>
                                    <td colSpan={10} className="px-5 py-20 text-center text-slate-400">
                                        Loading rent payments...
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Rent;
