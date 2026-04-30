import React, { useState, useEffect } from 'react';
import { FiTag, FiSearch, FiPlus, FiTrash2, FiClock, FiUsers, FiToggleRight, FiToggleLeft } from 'react-icons/fi';
import CreateOfferModal from '../components/offers/CreateOfferModal';
import { offerService } from '../services/offer.service';
import type { Offer } from '../types/booking.types';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import ConfirmationModal from '../components/common/ConfirmationModal';

const Offers: React.FC = () => {
    const [offers, setOffers] = useState<Offer[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Deletion State
    const [offerToDelete, setOfferToDelete] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = offerService.subscribeToOffers((fetchedOffers) => {
            setOffers(fetchedOffers as Offer[]);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleDelete = async () => {
        if (!offerToDelete) return;
        try {
            await offerService.deleteOffer(offerToDelete);
            toast.success('Offer deleted');
        } catch {
            toast.error('Failed to delete offer');
        } finally {
            setOfferToDelete(null);
        }
    };

    const handleToggleStatus = async (offer: Offer) => {
        try {
            await offerService.toggleStatus(offer.id!, !offer.is_active);
            toast.success(`Offer ${offer.is_active ? 'deactivated' : 'activated'}`);
        } catch {
            toast.error('Failed to update status');
        }
    };

    // Filter
    const filteredOffers = offers.filter(offer =>
        offer.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        offer.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (offer.description && offer.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--rf-color-text)] mb-1">Offers & Promotions</h1>
                    <p className="text-[var(--rf-color-text-secondary)]">Manage platform-wide coupon codes and promotional offers</p>
                </div>
                <button
                    onClick={() => setCreateModalOpen(true)}
                    className="bg-[var(--rf-color-action)] text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-[var(--rf-color-action-hover)] transition-all shadow-lg shadow-orange-200"
                >
                    <FiPlus /> Create Offer
                </button>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="relative w-full md:w-96 group">
                    <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <input
                        type="text"
                        name="offerSearch"
                        placeholder="Search offers by code or title..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-11 pr-4 outline-none focus:bg-white focus:border-orange-500/50 transition-all text-sm"
                    />
                </div>
                <div className="text-sm font-semibold text-slate-500">
                    {filteredOffers.length} Active Offers
                </div>
            </div>

            {loading ? (
                <div className="text-center py-20 text-slate-400">Loading offers...</div>
            ) : filteredOffers.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-3xl p-20 text-center">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-300">
                        <FiTag size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">No offers found</h3>
                    <p className="text-slate-500">Create your first promotional offer to attract more users.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredOffers.map((offer) => (
                        <div key={offer.id} className={`bg-white rounded-2xl border transition-all hover:shadow-lg group ${offer.is_active ? 'border-slate-200' : 'border-slate-100 opacity-75'}`}>
                            <div className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="bg-orange-50 text-orange-700 font-mono font-bold px-3 py-1 rounded-lg text-sm border border-orange-100 tracking-wide">
                                        {offer.code}
                                    </div>
                                    <button
                                        onClick={() => handleToggleStatus(offer)}
                                        className={`transition-colors ${offer.is_active ? 'text-blue-500 hover:text-blue-600' : 'text-slate-300 hover:text-slate-400'}`}
                                        title={offer.is_active ? "Deactivate" : "Activate"}
                                    >
                                        {offer.is_active ? <FiToggleRight size={28} /> : <FiToggleLeft size={28} />}
                                    </button>
                                </div>

                                <h3 className="text-lg font-bold text-slate-900 mb-1">{offer.title}</h3>
                                <p className="text-slate-500 text-sm mb-4 line-clamp-2">{offer.description}</p>

                                <div className="space-y-3 pt-4 border-t border-slate-100">
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <FiTag className="text-orange-400" />
                                            <span>
                                                {offer.discount_type === 'percentage' ? `${offer.discount_value}% Off` : `₹${offer.discount_value} Flat`}
                                            </span>
                                        </div>
                                        <div className="font-semibold text-slate-700">
                                            Max ₹{offer.max_discount}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <FiUsers className="text-blue-500" />
                                            <span>Used: {offer.current_uses} / {offer.max_uses}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <FiClock className="text-orange-400" />
                                            <span>
                                                {offer.valid_until ? format(new Date(offer.valid_until), 'MMM d, yyyy') : 'No Expiry'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center rounded-b-2xl">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${offer.is_active ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>
                                    {offer.is_active ? 'ACTIVE' : 'INACTIVE'}
                                </span>
                                <button
                                    onClick={() => setOfferToDelete(offer.id!)}
                                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                >
                                    <FiTrash2 />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <CreateOfferModal
                isOpen={isCreateModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onSuccess={() => { }}
            />

            <ConfirmationModal
                isOpen={!!offerToDelete}
                onClose={() => setOfferToDelete(null)}
                onConfirm={handleDelete}
                title="Delete Offer"
                message="Are you sure you want to delete this offer? This action cannot be undone."
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
            />
        </div>
    );
};

export default Offers;

