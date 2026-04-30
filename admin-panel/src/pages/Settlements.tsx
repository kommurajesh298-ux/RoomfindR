import React, { useEffect, useMemo, useState } from 'react';
import { paymentService } from '../services/payment.service';
import type { Settlement } from '../types/owner.types';
import toast from 'react-hot-toast';

const Settlements: React.FC = () => {
    const [settlements, setSettlements] = useState<Settlement[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = paymentService.subscribeToSettlements((data) => {
            setSettlements(data || []);
            setLoading(false);
        });

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, []);

    const getStatusBadge = (status: Settlement['status']) => {
        const normalized = String(status || '').toUpperCase();
        if (normalized === 'COMPLETED') return 'bg-blue-100 text-blue-700';
        if (normalized === 'PROCESSING') return 'bg-blue-100 text-blue-700';
        if (normalized === 'FAILED') return 'bg-red-100 text-red-700';
        return 'bg-yellow-100 text-yellow-700';
    };

    const isRentSettlement = (settlement: Settlement) =>
        ['monthly', 'rent'].includes(String(settlement.payment_type || '').toLowerCase());

    const advanceSettlements = useMemo(
        () => settlements.filter((settlement) => !isRentSettlement(settlement)),
        [settlements]
    );

    const summary = useMemo(() => advanceSettlements.reduce((accumulator, settlement) => {
        const normalizedStatus = String(settlement.status || '').toUpperCase();

        accumulator.total += 1;

        if (normalizedStatus === 'COMPLETED') {
            accumulator.completed += 1;
        } else if (normalizedStatus === 'FAILED') {
            accumulator.failed += 1;
        } else if (normalizedStatus === 'PROCESSING') {
            accumulator.processing += 1;
        } else {
            accumulator.pending += 1;
        }

        return accumulator;
    }, {
        total: 0,
        completed: 0,
        pending: 0,
        processing: 0,
        failed: 0,
    }), [advanceSettlements]);

    const handleProcessSettlement = async (settlementId: string) => {
        setProcessing(settlementId);
        try {
            const result = await paymentService.processSettlement(settlementId);
            if (result.success) {
                toast.success('Settlement payout initiated successfully');
            } else {
                toast.error(result.message || 'Settlement processing failed');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Settlement processing failed';
            toast.error(message);
            console.error('[Settlements] Error processing settlement:', error);
        } finally {
            setProcessing(null);
        }
    };

    const canProcess = (settlement: Settlement) => {
        const status = String(settlement.status || '').toUpperCase();
        return status === 'PENDING' || status === 'FAILED';
    };

    return (
        <div className="w-full space-y-5">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-800">Advance Settlements</h1>
                <p className="mt-1 text-sm text-gray-500">Only advance and non-rent settlement payouts appear here. Monthly rent payouts stay on the rent page.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 sm:text-[10px]">All settlements</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-slate-900 xl:text-4xl">{summary.total}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-blue-100 bg-blue-50 p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-500 sm:text-[10px]">Successful</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-blue-700 xl:text-4xl">{summary.completed}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-amber-100 bg-amber-50 p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-500 sm:text-[10px]">Pending</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-amber-700 xl:text-4xl">{summary.pending}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-sky-100 bg-sky-50 p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-sky-500 sm:text-[10px]">Processing</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-sky-700 xl:text-4xl">{summary.processing}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-rose-100 bg-rose-50 p-3.5 shadow-sm xl:p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-rose-500 sm:text-[10px]">Failed</p>
                    <p className="mt-2 break-words text-[1.85rem] font-black leading-none text-rose-700 xl:text-4xl">{summary.failed}</p>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold">
                                <th className="p-4">Period</th>
                                <th className="p-4">Owner</th>
                                <th className="p-4 text-right">Gross</th>
                                <th className="p-4 text-right">Platform Fee</th>
                                <th className="p-4 text-right">Net Payable</th>
                                <th className="p-4 text-center">Status</th>
                                <th className="p-4 text-right">Reference</th>
                                <th className="p-4 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {advanceSettlements.map((settlement) => (
                                <tr key={settlement.id} className="hover:bg-gray-50/50">
                                    <td className="p-4 text-sm text-gray-600 font-medium">
                                        {new Date(settlement.week_start_date).toLocaleDateString()} - {new Date(settlement.week_end_date).toLocaleDateString()}
                                    </td>
                                    <td className="p-4 text-sm font-medium">
                                        {settlement.owners?.name || 'Unknown'}
                                        {settlement.owners?.email && <div className="text-xs text-gray-400">{settlement.owners.email}</div>}
                                    </td>
                                    <td className="p-4 text-right text-gray-600">INR {Number(settlement.total_amount || 0).toLocaleString()}</td>
                                    <td className="p-4 text-right text-gray-600">INR {Number(settlement.platform_fee || 0).toLocaleString()}</td>
                                    <td className="p-4 text-right font-black text-gray-900">INR {Number(settlement.net_payable || 0).toLocaleString()}</td>
                                    <td className="p-4 text-center">
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${getStatusBadge(settlement.status)}`}>
                                            {String(settlement.status || '').toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <span className="text-xs text-gray-500 font-medium">
                                            {settlement.provider_reference || settlement.provider_transfer_id || '-'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        {canProcess(settlement) ? (
                                            <button
                                                onClick={() => handleProcessSettlement(settlement.id)}
                                                disabled={processing === settlement.id}
                                                className="px-3 py-1 bg-blue-500 text-white text-xs font-semibold rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                            >
                                                {processing === settlement.id ? 'Processing...' : 'Pay Now'}
                                            </button>
                                        ) : (
                                            <span className="text-xs text-gray-400">-</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {advanceSettlements.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-gray-400">No advance settlement history found</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Settlements;
