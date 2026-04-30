import React from 'react';
import type { Property } from '../../types/property.types';
import { FaTrash, FaMapMarkerAlt } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';

interface FavoritesGridProps {
    favorites: Property[];
    onRemove: (propertyId: string) => void;
    loading?: boolean;
}

const FavoritesGrid: React.FC<FavoritesGridProps> = ({ favorites, onRemove, loading }) => {
    const navigate = useNavigate();

    if (loading) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[1, 2].map((i) => (
                    <div key={i} className="animate-pulse bg-white rounded-[14px] h-[220px] shadow-sm border border-gray-100"></div>
                ))}
            </div>
        );
    }

    if (favorites.length === 0) {
        return (
            <div className="bg-white rounded-[18px] border border-gray-100 shadow-sm p-10 text-center">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-[#2563eb]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                    </svg>
                </div>
                <h3 className="text-[16px] font-semibold text-[#111827] mb-2">No favorites yet</h3>
                <p className="text-[13px] text-[#6B7280] mb-8">Tap the heart on any PG to save it here.</p>
                <button
                    onClick={() => navigate('/')}
                    className="w-full h-[48px] bg-[#2563eb] text-white text-[15px] font-bold rounded-[14px] transition-all active:scale-95 shadow-lg shadow-blue-100"
                >
                    Find Your PG
                </button>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {favorites.map((property) => (
                <div
                    key={property.propertyId}
                    className="bg-white rounded-[14px] shadow-sm overflow-hidden border border-gray-100 active:bg-gray-50 transition-colors"
                    onClick={() => navigate(`/property/${property.propertyId}`)}
                >
                    <div className="relative h-[120px]">
                        <img
                            src={property.images && property.images[0]?.startsWith('http')
                                ? property.images[0]
                                : 'https://images.unsplash.com/photo-1555854817-40e098ee7f27?w=800'}
                            alt={property.title}
                            className="w-full h-full object-cover"
                        />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemove(property.propertyId);
                            }}
                            className="absolute top-2 right-2 p-2 bg-white/90 backdrop-blur-md text-red-500 rounded-full shadow-md active:bg-red-50"
                        >
                            <FaTrash size={12} />
                        </button>
                        <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/40 backdrop-blur-md rounded text-[9px] font-black text-white uppercase tracking-widest border border-white/20">
                            {property.city}
                        </div>
                    </div>
                    <div className="p-3">
                        <h4 className="text-[14px] font-semibold text-[#111827] truncate leading-tight mb-1">{property.title}</h4>
                        <div className="flex items-center text-[#6B7280] text-[11px] mb-2">
                            <FaMapMarkerAlt className="mr-1 shrink-0" size={10} />
                            <span className="truncate">{property.address.text}</span>
                        </div>
                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-50">
                            <p className="text-[#2563eb] text-[14px] font-black">
                                ₹{property.pricePerMonth.toLocaleString()}
                                <span className="text-[#94A3B8] text-[10px] font-bold uppercase ml-1">/mo</span>
                            </p>
                            <span className="text-[11px] font-black text-[#6B7280] uppercase tracking-widest">View</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default FavoritesGrid;
