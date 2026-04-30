import React, { useState, useEffect } from 'react';
import { ownerService } from '../services/owner.service';
import type { Owner } from '../types/owner.types';
import OwnerCard from '../components/owners/OwnerCard';
import DocumentsModal from '../components/owners/DocumentsModal';
import ApprovalModal from '../components/owners/ApprovalModal';
import RejectionModal from '../components/owners/RejectionModal';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-hot-toast';
import { FiUsers, FiFilter, FiSearch } from 'react-icons/fi';
import { canResetOwnerBankDetails } from '../utils/ownerVerification';

const Owners: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'pending' | 'verified' | 'rejected'>('pending');
    const [owners, setOwners] = useState<Owner[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedOwner, setSelectedOwner] = useState<Owner | null>(null);
    const [isDocsModalOpen, setIsDocsModalOpen] = useState(false);
    const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const { admin } = useAuth();

    const fetchOwners = async () => {
        setLoading(true);
        try {
            const data = await ownerService.getAllOwners();
            // Filter owners based on the active tab
            const filtered = data.filter(o => {
                if (activeTab === 'verified') return o.verified;
                if (activeTab === 'rejected') return o.verification_status === 'rejected';
                return o.verification_status === 'pending' && !o.verified;
            });
            setOwners(filtered);
        } catch (error) {
            console.error("Fetch owners error:", error);
            toast.error("Failed to load owners");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOwners();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const handleApproveClick = (ownerId: string) => {
        const owner = owners.find(o => o.id === ownerId);
        if (owner) {
            setSelectedOwner(owner);
            setIsApproveModalOpen(true);
        }
    };

    const handleRejectClick = (ownerId: string) => {
        const owner = owners.find(o => o.id === ownerId);
        if (owner) {
            setSelectedOwner(owner);
            setIsRejectModalOpen(true);
        }
    };

    const handleApproveConfirm = async () => {
        if (!admin || !selectedOwner) return;
        setActionLoading(true);
        try {
            await ownerService.approveOwner(selectedOwner.id);
            toast.success('Owner approved successfully');
            setIsApproveModalOpen(false);
            setIsDocsModalOpen(false);
            fetchOwners();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to approve owner');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRejectConfirm = async () => {
        if (!admin || !selectedOwner) return;
        setActionLoading(true);
        try {
            await ownerService.rejectOwner(selectedOwner.id);
            toast.success('Owner rejected');
            setIsRejectModalOpen(false);
            setIsDocsModalOpen(false);
            fetchOwners();
        } catch {
            toast.error('Failed to reject owner');
        } finally {
            setActionLoading(false);
        }
    };

    const openDocs = (owner: Owner) => {
        setSelectedOwner(owner);
        setIsDocsModalOpen(true);
        ownerService.getOwnerVerificationOverview(owner.id)
            .then((overview) => {
                setSelectedOwner((previous) => previous && previous.id === owner.id
                    ? { ...previous, bankVerification: overview.verification, bankVerificationHistory: overview.history }
                    : previous);
            })
            .catch((error) => {
                console.error('Failed to load owner verification overview', error);
            });
    };

    const handleResetBank = async (ownerId: string) => {
        const owner =
            (selectedOwner?.id === ownerId ? selectedOwner : null) ||
            owners.find((item) => item.id === ownerId) ||
            null;

        if (owner && !canResetOwnerBankDetails(owner)) {
            toast.error('Verified Rs 1 bank accounts cannot be reset.');
            return;
        }

        setActionLoading(true);
        try {
            await ownerService.resetOwnerBankDetails(ownerId);
            toast.success('Owner bank details reset request sent');
            if (selectedOwner?.id === ownerId) {
                const overview = await ownerService.getOwnerVerificationOverview(ownerId);
                setSelectedOwner((previous) => previous && previous.id === ownerId
                    ? { ...previous, bankVerification: overview.verification, bankVerificationHistory: overview.history }
                    : previous);
            }
            fetchOwners();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to reset bank details');
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--rf-color-text)] mb-1">Owner Verification</h1>
                    <p className="text-[var(--rf-color-text-secondary)]">Manage and verify property owner accounts</p>
                </div>

                <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border border-slate-200">
                    {(['pending', 'verified', 'rejected'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === tab
                                ? 'bg-[var(--rf-color-action)] text-white shadow-lg'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                                }`}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Filters & Search */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="relative w-full md:w-96 group">
                    <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <input
                        type="text"
                        name="ownerSearch"
                        placeholder="Search by name or email..."
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-11 pr-4 outline-none focus:bg-white focus:border-orange-500/50 transition-all text-sm"
                    />
                </div>
                <button className="flex items-center gap-2 text-slate-600 font-semibold px-4 py-2 hover:bg-slate-50 rounded-xl transition-colors">
                    <FiFilter /> Filter
                </button>
            </div>

            {/* Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6 animate-pulse">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="h-96 bg-slate-200 rounded-3xl"></div>
                    ))}
                </div>
            ) : owners.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                    {owners.map((owner) => (
                        <OwnerCard
                            key={owner.id}
                            owner={owner}
                            onViewDocs={openDocs}
                            onApprove={handleApproveClick}
                            onReject={handleRejectClick}
                            onResetBank={handleResetBank}
                        />
                    ))}
                </div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-3xl p-16 text-center">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-300">
                        <FiUsers size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">No Owners Found</h3>
                    <p className="text-slate-500">There are no owners in the {activeTab} stage at the moment.</p>
                </div>
            )}

            <DocumentsModal
                owner={selectedOwner}
                isOpen={isDocsModalOpen}
                onClose={() => setIsDocsModalOpen(false)}
                onApprove={handleApproveClick}
                onReject={handleRejectClick}
                onResetBank={handleResetBank}
            />

            <ApprovalModal
                isOpen={isApproveModalOpen}
                onClose={() => setIsApproveModalOpen(false)}
                onConfirm={handleApproveConfirm}
                ownerName={selectedOwner?.name || ''}
                loading={actionLoading}
            />

            <RejectionModal
                isOpen={isRejectModalOpen}
                onClose={() => setIsRejectModalOpen(false)}
                onConfirm={handleRejectConfirm}
                ownerName={selectedOwner?.name || ''}
                loading={actionLoading}
            />
        </div>
    );
};

export default Owners;
