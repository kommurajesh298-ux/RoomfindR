import React, { useState, useEffect } from 'react';
import { FiCheckCircle, FiCreditCard, FiExternalLink, FiFileText, FiHome } from 'react-icons/fi';

import Modal from '../common/Modal';
import type { Owner } from '../../types/owner.types';
import { ownerService } from '../../services/owner.service';
import { canResetOwnerBankDetails, resolveOwnerBankVerificationStatus } from '../../utils/ownerVerification';

const PropertiesList: React.FC<{ ownerId: string }> = ({ ownerId }) => {
    const [properties, setProperties] = useState<Record<string, unknown>[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchProps = async () => {
            try {
                const props = await ownerService.getOwnerProperties(ownerId);
                setProperties(props);
            } catch (err) {
                console.error("Failed to load properties", err);
            } finally {
                setLoading(false);
            }
        };
        fetchProps();
    }, [ownerId]);

    if (loading) return <div className="p-4 text-center text-slate-400">Loading properties...</div>;

    if (properties.length === 0) {
        return (
            <div className="bg-slate-50 rounded-2xl p-8 text-center border border-slate-100">
                <FiHome size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">No properties found for this owner.</p>
            </div>
        );
    }

    return (
        <div className="grid gap-3 max-h-[300px] overflow-y-auto pr-2">
            {properties.map((property) => (
                <div key={property.id as string} className="bg-white border border-slate-200 p-4 rounded-xl flex items-center justify-between">
                    <div>
                        <p className="font-bold text-slate-800 text-sm">{property.title as string}</p>
                        <p className="text-xs text-slate-500">{property.address as string}, {property.city as string}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
                            property.published ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                            {property.published ? 'Published' : 'Draft'}
                        </span>
                        {!!(property as { verified?: boolean }).verified && (
                            <span className="text-[10px] text-blue-600 flex items-center gap-0.5">
                                <FiCheckCircle size={10} /> Verified
                            </span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

interface DocumentsModalProps {
    owner: Owner | null;
    isOpen: boolean;
    onClose: () => void;
    onApprove: (ownerId: string) => void;
    onReject: (ownerId: string) => void;
    onResetBank: (ownerId: string) => void;
}

const DocumentsModal: React.FC<DocumentsModalProps> = ({
    owner,
    isOpen,
    onClose,
    onApprove,
    onReject,
    onResetBank,
}) => {
    const [activeTab, setActiveTab] = useState<'license' | 'bank' | 'properties'>('license');

    if (!owner) return null;

    const bankVerificationStatus = resolveOwnerBankVerificationStatus(owner);
    const canApprove = bankVerificationStatus === 'success';
    const canResetBank = canResetOwnerBankDetails(owner);
    const bankVerificationBadgeClass =
        bankVerificationStatus === 'success'
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : bankVerificationStatus === 'failed'
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : 'bg-amber-50 text-amber-700 border-amber-200';
    const bankVerificationLabel =
        bankVerificationStatus === 'success'
            ? 'Verified (Rs 1 sent successfully)'
            : bankVerificationStatus === 'failed'
                ? 'Failed'
                : 'Pending';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Verification Details: ${owner.name}`}
            maxWidth="max-w-4xl"
        >
            <div className="flex flex-col h-full">
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl mb-6">
                    <button
                        onClick={() => setActiveTab('license')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                            activeTab === 'license' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <FiFileText /> License Document
                    </button>
                    <button
                        onClick={() => setActiveTab('bank')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                            activeTab === 'bank' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <FiCreditCard /> Bank Details
                    </button>
                    <button
                        onClick={() => setActiveTab('properties')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                            activeTab === 'properties' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <FiHome /> Properties
                    </button>
                </div>

                <div className="flex-1 min-h-[400px]">
                    {activeTab === 'license' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-slate-800">Registration / Business License</h4>
                                <a
                                    href={owner.licenseDocUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-sm font-semibold flex items-center gap-1"
                                >
                                    <FiExternalLink /> Open in New Tab
                                </a>
                            </div>

                            <div className="bg-slate-200 border-2 border-slate-300 rounded-3xl overflow-hidden flex items-center justify-center h-[500px] bg-slate-900/5 relative">
                                {owner.licenseDocUrl ? (
                                    owner.licenseDocUrl.endsWith('.pdf') ? (
                                        <iframe src={owner.licenseDocUrl} className="w-full h-full" title="License Document" />
                                    ) : (
                                        <img
                                            src={owner.licenseDocUrl}
                                            className="w-full h-full object-contain p-4"
                                            alt="License"
                                        />
                                    )
                                ) : (
                                    <div className="text-center p-8">
                                        <FiFileText size={48} className="mx-auto text-slate-300 mb-4" />
                                        <p className="text-slate-500 font-medium">No document uploaded</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'bank' && (
                        <div className="space-y-6">
                            <h4 className="font-bold text-slate-800">Verification of Bank Account</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {[
                                    { label: 'Account Holder Name', value: owner.bankDetails?.accountHolderName },
                                    { label: 'Bank Name', value: owner.bankDetails?.bankName },
                                    { label: 'Account Number', value: owner.bankDetails?.accountNumber },
                                    { label: 'IFSC Code', value: owner.bankDetails?.ifscCode },
                                ].map((item) => (
                                    <div key={item.label} className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{item.label}</p>
                                        <p className="text-lg font-bold text-slate-900">{item.value || 'N/A'}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Verification Status</p>
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider ${bankVerificationBadgeClass}`}>
                                        {bankVerificationLabel}
                                    </span>
                                    <span className="text-sm text-slate-500">
                                        Owner ID: {owner.id}
                                    </span>
                                    <span className="text-sm text-slate-500">
                                        Ref: {owner.bankVerification?.transfer_reference_id || 'Pending'}
                                    </span>
                                    <span className="text-sm text-slate-500">
                                        Date: {owner.bankVerification?.verified_at ? new Date(owner.bankVerification.verified_at).toLocaleString() : owner.bankVerification?.last_attempt_at ? new Date(owner.bankVerification.last_attempt_at).toLocaleString() : 'Pending'}
                                    </span>
                                </div>
                                <p className="mt-3 text-sm text-slate-600">
                                    {owner.bankVerification?.status_message || 'Verification status will update when the Rs 1 transfer result is received.'}
                                </p>
                            </div>

                            {owner.bankVerificationHistory && owner.bankVerificationHistory.length > 0 ? (
                                <div className="space-y-3">
                                    <h5 className="text-sm font-bold uppercase tracking-wider text-slate-500">Verification History</h5>
                                    {owner.bankVerificationHistory.map((entry) => (
                                        <div key={entry.id} className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <p className="text-sm font-bold text-slate-900">
                                                    Rs {Number(entry.transfer_amount || 0).toFixed(2)} • {entry.transfer_reference || 'Pending'}
                                                </p>
                                                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${
                                                    entry.transfer_status === 'success'
                                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                        : entry.transfer_status === 'failed'
                                                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                            : 'bg-amber-50 text-amber-700 border-amber-200'
                                                }`}>
                                                    {entry.transfer_status}
                                                </span>
                                            </div>
                                            {entry.error_message ? (
                                                <p className="mt-2 text-sm text-rose-600">{entry.error_message}</p>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-3">
                                <span className="text-amber-600 text-lg">i</span>
                                <p className="text-sm text-amber-800">
                                    This view tracks the Rs 1 penny-drop result used to activate the owner account.
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'properties' && (
                        <div className="space-y-4">
                            <h4 className="font-bold text-slate-800">Owner Properties</h4>
                            <PropertiesList ownerId={owner.id} />
                        </div>
                    )}
                </div>

                {!owner.verified && !owner.rejectionReason && (
                    <div className="flex items-center gap-4 mt-8 pt-6 border-t border-slate-100">
                        <button
                            onClick={() => onResetBank(owner.id)}
                            disabled={!canResetBank}
                            className={`flex-1 font-bold py-4 rounded-2xl transition-all active:scale-[0.98] ${
                                canResetBank
                                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                            title={canResetBank ? 'Reset Bank Details' : 'Verified Rs 1 bank accounts cannot be reset'}
                        >
                            Reset Bank Details
                        </button>
                        <button
                            onClick={() => onReject(owner.id)}
                            className="flex-1 bg-rose-50 text-rose-600 font-bold py-4 rounded-2xl hover:bg-rose-100 transition-all active:scale-[0.98]"
                        >
                            Reject Verification
                        </button>
                        <button
                            onClick={() => onApprove(owner.id)}
                            disabled={!canApprove}
                            className={`flex-[2] font-bold py-4 rounded-2xl transition-all active:scale-[0.98] ${
                                canApprove
                                    ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            Approve Owner
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default DocumentsModal;

