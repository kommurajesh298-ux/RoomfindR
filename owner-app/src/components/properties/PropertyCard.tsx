import React from 'react';
import { FiEdit2, FiTrash2, FiEye, FiEyeOff, FiMapPin } from 'react-icons/fi';
import type { Property } from '../../types/property.types';
import { formatCurrency } from '../../utils/currency';

interface PropertyCardProps {
    property: Property;
    isOwnerVerified: boolean;
    onEdit: (property: Property) => void;
    onDelete: (propertyId: string) => void;
    onTogglePublish: (property: Property) => void;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({
    property,
    isOwnerVerified,
    onEdit,
    onDelete,
    onTogglePublish
}) => {
    const mainImage = property.images && property.images.length > 0
        ? property.images[0]
        : 'https://placehold.co/600x400?text=No+Image';

    const isFull = property.vacancies === 0;

    const getStatusBadge = () => {
        if (!property.published) return <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border border-gray-200">Draft</span>;
        if (isFull) return <span className="bg-orange-50 text-orange-700 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border border-orange-200">Full</span>;
        return <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border border-blue-200">Published</span>;
    };

    const publishAction = property.published
        ? {
            label: 'Unpublish Listing',
            className: 'w-full h-10 rounded-lg flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-sm hover:shadow-md bg-orange-50 text-orange-700 border border-orange-100 hover:bg-orange-100',
            disabled: false,
            icon: <FiEyeOff size={14} />
        }
        : isOwnerVerified
            ? {
                label: 'Publish to Customer App',
                className: 'w-full h-10 rounded-lg flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-sm hover:shadow-md bg-[var(--rf-color-action)] text-white border border-[var(--rf-color-action)] hover:bg-[var(--rf-color-action-hover)]',
                disabled: false,
                icon: <FiEye size={14} />
            }
            : {
                label: 'Pending Verification',
                className: 'w-full h-10 rounded-lg flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-sm bg-amber-50 text-amber-700 border border-amber-200 cursor-not-allowed',
                disabled: true,
                icon: <FiEye size={14} />
            };

    return (
        <div className="bg-white rounded-[18px] border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden group flex flex-col h-full">
            {/* Image Section */}
            <div className="relative h-[140px] bg-gray-100 overflow-hidden">
                <img
                    src={mainImage}
                    alt={property.title}
                    onError={(e) => {
                        e.currentTarget.src = 'https://placehold.co/600x400?text=No+Image';
                    }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />

                {/* Badges Overlay */}
                <div className="absolute top-3 right-3 flex gap-2">
                    {getStatusBadge()}
                </div>
            </div>

            {/* Content Section */}
            <div className="p-4 flex flex-col flex-1">
                <h3 className="rfm-pg-title-single-line font-bold text-gray-900 text-lg leading-tight mb-1" title={property.title}>
                    {property.title}
                </h3>

                <div className="flex items-center text-gray-400 text-xs font-medium mb-3">
                    <FiMapPin size={12} className="mr-1" />
                    <span className="truncate max-w-[200px]">{property.address?.text || property.city}</span>
                </div>

                <div className="mt-auto flex items-end justify-between">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">Rent</span>
                        <span className="text-xl font-bold text-[var(--rf-color-action)]">
                            {formatCurrency(property.pricePerMonth)}
                            <span className="text-xs text-gray-400 font-medium ml-0.5">/mo</span>
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-gray-50">
                    <div className="flex gap-2">
                        <button
                            onClick={() => onEdit(property)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
                        >
                            <FiEdit2 size={13} /> Edit Details
                        </button>
                        <button
                            onClick={() => onDelete(property.propertyId)}
                            className="w-10 h-9 shrink-0 flex items-center justify-center bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all border border-red-100 hover:border-transparent"
                            title="Delete Property"
                        >
                            <FiTrash2 size={15} />
                        </button>
                    </div>

                    <button
                        onClick={() => onTogglePublish(property)}
                        disabled={publishAction.disabled}
                        className={publishAction.className}
                    >
                        {publishAction.icon}
                        {publishAction.label}
                    </button>
                </div>
            </div>
        </div>
    );
};

