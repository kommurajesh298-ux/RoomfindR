import React, { useState, useEffect, useCallback } from 'react';
import { propertyService } from '../services/property.service';
import type { Property } from '../services/property.service';
import PropertyCard from '../components/properties/PropertyCard';
import VerifyPropertyModal from '../components/properties/VerifyPropertyModal';
import RemovePropertyModal from '../components/properties/RemovePropertyModal';
import RequireChangesModal from '../components/properties/RequireChangesModal';
import ReportsModal from '../components/properties/ReportsModal';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-hot-toast';
import { FiHome, FiSearch, FiFilter } from 'react-icons/fi';
import { IntersectionRender } from '../components/common/IntersectionRender';

const Properties: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'verified' | 'flagged'>('pending');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal States
    const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
    const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
    const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
    const [isChangesModalOpen, setIsChangesModalOpen] = useState(false);
    const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    const { admin } = useAuth();

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const fetchProps = useCallback(async () => {
        setLoading(true);
        try {
            const data = await propertyService.getProperties();
            // Filter based on activeTab
            let filtered = data;

            // Apply Active Tab Filter
            if (activeTab === 'pending') filtered = data.filter(p => !p.status || p.status === 'draft' || p.status === 'pending');
            else if (activeTab === 'verified') filtered = data.filter(p => p.status === 'published' || p.status === 'approved');
            else if (activeTab === 'flagged') filtered = data.filter(p => p.status === 'suspended' || p.status === 'archived' || p.status === 'needs_changes');

            // Apply Search Filter (Debounced)
            if (debouncedQuery) {
                const query = debouncedQuery.toLowerCase();
                filtered = filtered.filter(p =>
                    p.title.toLowerCase().includes(query) ||
                    p.address?.text.toLowerCase().includes(query) ||
                    p.city?.toLowerCase().includes(query)
                );
            }

            setProperties(filtered);
        } catch (error) {
            console.error("Fetch properties error:", error);
            toast.error("Failed to load properties");
        } finally {
            setLoading(false);
        }
    }, [activeTab, debouncedQuery]);

    useEffect(() => {
        fetchProps();
    }, [fetchProps]);

    const handleVerifyClick = (id: string) => {
        const prop = properties.find(p => p.id === id);
        if (prop) {
            setSelectedProperty(prop);
            setIsVerifyModalOpen(true);
        }
    };

    const handleRemoveClick = (id: string) => {
        const prop = properties.find(p => p.id === id);
        if (prop) {
            setSelectedProperty(prop);
            setIsRemoveModalOpen(true);
        }
    };

    const handleRequireChangesClick = (id: string) => {
        const prop = properties.find(p => p.id === id);
        if (prop) {
            setSelectedProperty(prop);
            setIsChangesModalOpen(true);
        }
    };

    const handleVerifyConfirm = async () => {
        if (!admin || !selectedProperty) return;
        setActionLoading(true);
        try {
            await propertyService.verifyProperty(selectedProperty.id, 'published');
            toast.success('Property verified');
            setIsVerifyModalOpen(false);
            fetchProps();
        } catch {
            toast.error('Failed to verify property');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemoveConfirm = async () => {
        if (!admin || !selectedProperty) return;
        setActionLoading(true);
        try {
            await propertyService.suspendProperty(selectedProperty.id);
            toast.success('Property suspended and owner notified');
            setIsRemoveModalOpen(false);
            fetchProps();
        } catch {
            toast.error('Failed to suspend property');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRequireChangesSend = async (message: string) => {
        if (!admin || !selectedProperty) return;
        setActionLoading(true);
        try {
            await propertyService.requireChanges(selectedProperty.id, message);
            toast.success('Changes requested from owner');
            setIsChangesModalOpen(false);
        } catch {
            toast.error('Failed to send request');
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--rf-color-text)] mb-1">Property Moderation</h1>
                    <p className="text-[var(--rf-color-text-secondary)]">Monitor and verify property listings across the platform</p>
                </div>

                <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border border-slate-200 overflow-x-auto">
                    {(['all', 'pending', 'verified', 'flagged'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${activeTab === tab
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
                        name="propertySearch"
                        placeholder="Search properties by title or city..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-11 pr-4 outline-none focus:bg-white focus:border-orange-500/50 transition-all text-sm"
                    />
                </div>
                <button className="flex items-center gap-2 text-slate-600 font-semibold px-4 py-2 hover:bg-slate-50 rounded-xl transition-colors">
                    <FiFilter /> Filter
                </button>
            </div>

            {/* Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-pulse">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div key={i} className="h-80 bg-slate-200 rounded-3xl"></div>
                    ))}
                </div>
            ) : properties.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {properties.map((prop) => (
                        <IntersectionRender key={prop.id} height={320} offset={300}>
                            <PropertyCard
                                property={prop}
                                onVerify={handleVerifyClick}
                                onRemove={handleRemoveClick}
                                onRequireChanges={handleRequireChangesClick}
                                onViewDetails={(p) => {
                                    setSelectedProperty(p);
                                    setIsReportsModalOpen(true);
                                }}
                            />
                        </IntersectionRender>
                    ))}
                </div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-3xl p-20 text-center">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-300">
                        <FiHome size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">No properties here</h3>
                    <p className="text-slate-500">All properties in this category have been processed.</p>
                </div>
            )}

            <VerifyPropertyModal
                isOpen={isVerifyModalOpen}
                onClose={() => setIsVerifyModalOpen(false)}
                onConfirm={handleVerifyConfirm}
                title={selectedProperty?.title || ''}
                loading={actionLoading}
            />

            <RemovePropertyModal
                isOpen={isRemoveModalOpen}
                onClose={() => setIsRemoveModalOpen(false)}
                onConfirm={handleRemoveConfirm}
                title={selectedProperty?.title || ''}
                loading={actionLoading}
            />

            <RequireChangesModal
                isOpen={isChangesModalOpen}
                onClose={() => setIsChangesModalOpen(false)}
                onSend={handleRequireChangesSend}
                title={selectedProperty?.title || ''}
                loading={actionLoading}
            />

            <ReportsModal
                isOpen={isReportsModalOpen}
                onClose={() => setIsReportsModalOpen(false)}
                propertyId={selectedProperty?.id || ''}
                propertyTitle={selectedProperty?.title || ''}
            />
        </div>
    );
};

export default Properties;
