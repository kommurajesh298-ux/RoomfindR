import React, { useState, useEffect } from 'react';
import { FiPlus, FiGrid, FiAlertCircle } from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import { useOwner } from '../hooks/useOwner';
import { propertyService } from '../services/property.service';
import type { Property } from '../types/property.types';
import { PropertyCard } from '../components/properties/PropertyCard';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { IntersectionRender } from '../components/common/IntersectionRender';

type FilterType = 'all' | 'published' | 'drafts' | 'vacancies';

export const Properties: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { verificationStatus } = useOwner();
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<FilterType>('all');

    // Modal States
    const [deleteId, setDeleteId] = useState<string | null>(null);

    useEffect(() => {
        if (!currentUser) return;

        const unsubscribe = propertyService.subscribeToOwnerProperties(
            currentUser.uid,
            (fetchedProperties) => {
                setProperties(fetchedProperties);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [currentUser]);

    const getFilteredList = () => {
        return properties.filter(p => {
            if (filter === 'published') return p.published;
            if (filter === 'drafts') return !p.published;
            if (filter === 'vacancies') return p.vacancies === 0; // "Vacancies" filter key here implies "Full" status as per UI label
            return true;
        });
    };

    const displayProperties = getFilteredList();

    const handleEdit = (property: Property) => {
        navigate(`/properties/edit/${property.propertyId}`);
    };

    const handleCreatePropertyClick = () => {
        if (!verificationStatus) {
            toast.error("Complete verification before creating properties");
            navigate('/dashboard');
            return;
        }

        navigate('/properties/add');
    };

    const handleDelete = async () => {
        if (!deleteId) return;
        try {
            await propertyService.deleteProperty(deleteId);

            // Optimistic update
            setProperties(prev => prev.filter(p => p.propertyId !== deleteId));

            toast.success("Property deleted");
            setDeleteId(null);
        } catch {
            toast.error("Failed to delete property");
        }
    };

    const handleTogglePublish = async (property: Property) => {
        try {
            if (property.published) {
                await propertyService.unpublishProperty(property.propertyId);
                toast.success("Property unpublished");
            } else {
                if (!verificationStatus) {
                    toast.error("You must be verified to publish properties");
                    return;
                }
                await propertyService.publishProperty(property.propertyId);
                toast.success("Property published!");
            }
        } catch {
            toast.error("Failed to update status");
        }
    };

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(220,252,231,0.45),_transparent_28%),linear-gradient(180deg,#ffffff_0%,#f9fafb_100%)] pb-24 md:pb-10 relative">
            <div className="max-w-7xl mx-auto px-4 md:px-6 pt-6">

                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl md:text-5xl font-black text-[var(--rf-color-text)] tracking-tight font-display">My Properties</h1>
                        <p className="text-sm md:text-lg text-[var(--rf-color-text-secondary)] font-medium">Manage and monitor your portfolio</p>
                    </div>

                    {/* Desktop Add Button */}
                    <button
                        onClick={handleCreatePropertyClick}
                        className="hidden md:flex items-center gap-3 px-8 py-3.5 bg-[var(--rf-color-action)] text-white rounded-2xl text-sm font-black shadow-xl shadow-orange-200 hover:bg-[var(--rf-color-action-hover)] hover:-translate-y-1 transition-all active:scale-95"
                    >
                        <FiPlus size={22} strokeWidth={3} /> List New Property
                    </button>
                </div>

                {!verificationStatus && (
                    <div className="bg-amber-50/50 border border-amber-100 p-5 rounded-3xl mb-8 flex gap-4 text-xs md:text-sm text-amber-700 backdrop-blur-sm">
                        <FiAlertCircle className="shrink-0 mt-0.5 text-amber-500" size={20} />
                        <p className="font-medium leading-relaxed">Your account is <span className="font-black uppercase tracking-wider">pending verification</span>. Property creation stays locked until your bank verification succeeds.</p>
                    </div>
                )}

                {/* Filters */}
                <div className="flex items-center gap-3 overflow-x-auto pb-6 no-scrollbar mb-4 scroll-smooth">
                    <div className="flex items-center gap-2 p-1.5 bg-white rounded-2xl border border-gray-100 shadow-sm">
                        {(['all', 'published', 'drafts', 'vacancies'] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-5 py-2 rounded-xl text-xs md:text-sm font-black uppercase tracking-widest transition-all whitespace-nowrap ${filter === f
                                    ? 'bg-[var(--rf-color-action)] text-white shadow-lg shadow-orange-200'
                                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                                    }`}
                            >
                                {f === 'all' ? 'All' :
                                    f === 'vacancies' ? 'Full' :
                                        f}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Grid */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-[320px] bg-white rounded-[18px] border border-gray-100 animate-pulse"></div>
                        ))}
                    </div>
                ) : displayProperties.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {displayProperties.map(property => (
                            <IntersectionRender key={property.propertyId} height={320} offset={300}>
                                <PropertyCard
                                    property={property}
                                    isOwnerVerified={verificationStatus}
                                    onEdit={handleEdit}
                                    onDelete={(id) => setDeleteId(id)}
                                    onTogglePublish={handleTogglePublish}
                                />
                            </IntersectionRender>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20">
                        <div className="inline-flex justify-center items-center w-16 h-16 bg-gray-100 rounded-full mb-4 text-gray-300">
                            <FiGrid size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">No properties found</h3>
                        <p className="text-gray-500 mt-1 max-w-xs mx-auto">
                            {filter === 'all'
                                ? "You haven't added any properties yet."
                                : `No properties dealing with "${filter}" status.`}
                        </p>
                    </div>
                )}
            </div>

            {/* Mobile Floating Action Button (FAB) */}
            <button
                onClick={handleCreatePropertyClick}
                className="md:hidden fixed bottom-24 right-5 w-16 h-16 bg-[var(--rf-color-action)] text-white rounded-2xl shadow-[0_15px_30px_rgba(249,115,22,0.24)] flex items-center justify-center z-40 hover:scale-105 active:scale-95 transition-all border-b-4 border-[var(--rf-color-action-hover)]"
            >
                <FiPlus size={32} strokeWidth={3} />
            </button>

            <ConfirmationModal
                isOpen={!!deleteId}
                onClose={() => setDeleteId(null)}
                onConfirm={handleDelete}
                title="Delete Property?"
                message="Are you sure you want to delete this property? This action cannot be undone."
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
};

export default Properties;
