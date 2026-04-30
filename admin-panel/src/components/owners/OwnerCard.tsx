import React from 'react';
import type { Owner } from '../../types/owner.types';
import Badge from '../common/Badge';
import { FiMail, FiPhone, FiCalendar, FiEye, FiCheck, FiX, FiActivity } from 'react-icons/fi';
import { format } from 'date-fns';
import { canResetOwnerBankDetails, resolveOwnerBankVerificationStatus } from '../../utils/ownerVerification';

interface OwnerCardProps {
    owner: Owner;
    onViewDocs: (owner: Owner) => void;
    onApprove: (ownerId: string) => void;
    onReject: (ownerId: string) => void;
    onResetBank: (ownerId: string) => void;
}

const OwnerCard: React.FC<OwnerCardProps> = ({ owner, onViewDocs, onApprove, onReject, onResetBank }) => {
    const getStatusVariant = () => {
        if (owner.verified) return 'success';
        if (owner.rejectionReason) return 'danger';
        return 'warning';
    };

    const bankVerificationStatus = resolveOwnerBankVerificationStatus(owner);
    const bankVerificationBadge =
        bankVerificationStatus === 'success'
            ? { label: 'Rs 1 Verified', className: 'bg-blue-50 text-blue-700 border-blue-200' }
            : bankVerificationStatus === 'failed'
                ? { label: 'Rs 1 Failed', className: 'bg-rose-50 text-rose-700 border-rose-200' }
                : { label: 'Rs 1 Pending', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    const canApprove = bankVerificationStatus === 'success';
    const canResetBank = canResetOwnerBankDetails(owner);

    const maskBankNumber = (num: string | undefined) => {
        if (!num) return 'N/A';
        return `XXXX-${num.slice(-4)}`;
    };

    return (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all group overflow-hidden relative">
            <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-[linear-gradient(135deg,var(--rf-color-action),var(--rf-color-primary-green-dark))] text-white rounded-2xl flex items-center justify-center text-xl font-bold">
                        {owner.name?.charAt(0) || '?'}
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 leading-tight mb-1">{owner.name}</h3>
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getStatusVariant()}>
                                {owner.verified ? 'Verified' : owner.rejectionReason ? 'Rejected' : 'Pending Verification'}
                            </Badge>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${bankVerificationBadge.className}`}>
                                {bankVerificationBadge.label}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 text-slate-500 text-sm">
                    <FiMail className="shrink-0" />
                    <span className="truncate">{owner.email}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 text-sm">
                    <FiPhone className="shrink-0" />
                    <span>{owner.phone}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 text-sm">
                    <FiCalendar className="shrink-0" />
                    <span>Joined {owner.created_at ? format(new Date(owner.created_at.toString()), 'PP') : 'N/A'}</span>
                </div>
                <div className="flex items-start gap-3 text-slate-500 text-sm">
                    <FiActivity className="shrink-0" />
                    <span className="font-semibold text-slate-700 break-all">Owner ID: {owner.id}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 text-sm">
                    <FiActivity className="shrink-0" />
                    <span className="font-semibold text-slate-700">{owner.propertiesCount || 0} Properties Managed</span>
                </div>
                <div className="flex items-start gap-3 text-slate-500 text-sm">
                    <FiCheck className="shrink-0 mt-0.5" />
                    <span className="font-semibold text-slate-700">
                        Bank Verification: {bankVerificationBadge.label}{owner.bankVerification?.verified_at ? ` • ${format(new Date(owner.bankVerification.verified_at), 'PPp')}` : ''}
                    </span>
                </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-3.5 mb-5 text-xs">
                <p className="text-slate-400 font-bold uppercase tracking-widest mb-1.5">Banking Details (Masked)</p>
                <div className="space-y-1.5">
                    <div className="text-slate-900 font-bold">
                        Holder: <span className="text-slate-600 font-medium">{owner.bankDetails?.accountHolderName || 'Not Provided'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                        <div>Bank: <span className="text-slate-900 font-semibold">{owner.bankDetails?.bankName || 'N/A'}</span></div>
                        <div>IFSC: <span className="text-slate-900 font-semibold">{owner.bankDetails?.ifscCode || 'N/A'}</span></div>
                        <div className="col-span-2">Account: <span className="text-slate-900 font-semibold">{maskBankNumber(owner.bankDetails?.accountNumber)}</span></div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                <button
                    onClick={() => onViewDocs(owner)}
                    className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl transition-colors text-sm"
                >
                    <FiEye /> View Docs
                </button>

                {!owner.verified && !owner.rejectionReason && (
                    <>
                        <button
                            onClick={() => onResetBank(owner.id)}
                            className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                                canResetBank
                                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-600'
                                    : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                            }`}
                            title={canResetBank ? 'Reset Bank Details' : 'Verified Rs 1 bank accounts cannot be reset'}
                            disabled={!canResetBank}
                        >
                            <FiActivity size={18} />
                        </button>
                        <button
                            onClick={() => onReject(owner.id)}
                            className="w-12 h-12 flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl transition-colors shrink-0"
                            title="Reject Owner"
                        >
                            <FiX size={20} />
                        </button>
                        <button
                            onClick={() => onApprove(owner.id)}
                            className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                                canApprove
                                    ? 'bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white'
                                    : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                            }`}
                            title={canApprove ? 'Approve Owner' : 'Bank verification must succeed first'}
                            disabled={!canApprove}
                        >
                            <FiCheck size={20} />
                        </button>
                    </>
                )}
            </div>

            {owner.rejectionReason && (
                <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-rose-500 text-white text-[10px] p-2 rounded-bl-xl max-w-[120px] shadow-sm">
                        Reason: {owner.rejectionReason}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OwnerCard;


