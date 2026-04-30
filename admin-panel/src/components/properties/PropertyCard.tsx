import React from 'react';
import type { Property } from '../../services/property.service';
import { FiMapPin, FiCheckCircle, FiShield, FiAlertTriangle, FiEye } from 'react-icons/fi';

interface PropertyCardProps {
    property: Property;
    onVerify: (id: string) => void;
    onRemove: (id: string) => void;
    onRequireChanges: (id: string) => void;
    onViewDetails: (property: Property) => void;
}

const PropertyCard: React.FC<PropertyCardProps> = ({ property, onVerify, onRemove, onRequireChanges, onViewDetails }) => {
    const displayPrice = Number(property.price ?? property.monthly_rent ?? 0);

    return (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group">
            {/* Image Header */}
            <div className="relative h-48 overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200">
                <img
                    src={property.images?.[0] || 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&q=80'}
                    alt={property.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                {/* Status Badges - Top Right */}
                <div className="absolute top-3 right-3 flex flex-col gap-1.5">
                    {property.verified && (
                        <span className="px-2.5 py-1 bg-blue-500 text-white text-xs font-bold rounded-md shadow-lg flex items-center gap-1">
                            <FiCheckCircle size={12} /> VERIFIED
                        </span>
                    )}
                    {property.published ? (
                        <span className="px-2.5 py-1 bg-[var(--rf-color-action)] text-white text-xs font-bold rounded-md shadow-lg">
                            LIVE
                        </span>
                    ) : (
                        <span className="px-2.5 py-1 bg-gray-600 text-white text-xs font-bold rounded-md shadow-lg">
                            HIDDEN
                        </span>
                    )}
                </div>
            </div>

            <div className="p-5">
                {/* Title & Price */}
                <div className="flex justify-between items-start mb-3">
                    <h3 className="font-bold text-gray-900 text-base leading-tight flex-1 mr-2 line-clamp-1">
                        {property.title}
                    </h3>
                    <span className="text-blue-600 font-black text-base whitespace-nowrap">
                        ₹{displayPrice.toLocaleString('en-IN')}
                    </span>
                </div>

                {/* Location */}
                <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-4">
                    <FiMapPin size={12} />
                    <span>{property.city}</span>
                </div>

                {/* Owner Info */}
                <div className="bg-gray-50 rounded-xl p-3 mb-4">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Owner ID</span>
                        <span className="text-xs text-gray-700 font-semibold font-mono">
                            {property.owner_id.slice(0, 8)}...
                        </span>
                    </div>
                    <p className="text-[10px] text-gray-500 italic">
                        Moderation History: No prior issues detected.
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onViewDetails(property)}
                        className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition-colors text-xs flex items-center justify-center gap-1.5"
                    >
                        <FiEye size={14} /> Details
                    </button>

                    <button
                        onClick={() => onRequireChanges(property.id)}
                        className="w-10 h-10 bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white rounded-xl transition-all flex items-center justify-center"
                        title="Require Changes"
                    >
                        <FiShield size={16} />
                    </button>

                    {!property.published ? (
                        <button
                            onClick={() => onVerify(property.id)}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg text-xs flex items-center justify-center gap-1.5"
                        >
                            <FiCheckCircle size={14} /> Publish
                        </button>
                    ) : (
                        <div className="flex-1 bg-blue-50 text-blue-700 font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 border border-blue-200">
                            <FiCheckCircle size={14} /> Published
                        </div>
                    )}

                    {property.published && (
                        <button
                            onClick={() => onRemove(property.id)}
                            className="w-10 h-10 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all flex items-center justify-center"
                            title="Temporarily Remove"
                        >
                            <FiAlertTriangle size={16} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PropertyCard;

