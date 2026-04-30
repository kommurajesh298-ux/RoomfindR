import React from 'react';
import type { Property } from '../../types/property.types';

interface BookingModalProps {
    property: Property;
    onClose: () => void;
    onViewDetails: (_id: string) => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({ property, onClose, onViewDetails }) => {
    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#d7e5fb] bg-white shadow-[0_26px_54px_rgba(16,96,208,0.16)] animate-in zoom-in-95 duration-200">

                {/* Header Image */}
                <div className="h-32 bg-gray-200 relative">
                    {property.images && property.images.length > 0 && property.images[0]?.startsWith('http') ? (
                        <img
                            src={property.images[0]}
                            alt={property.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (!target.src.includes('hostel-1.avif')) {
                                    target.src = '/assets/images/properties/hostel-1.avif';
                                }
                            }}
                        />
                    ) : (
                        <img
                            src="/assets/images/properties/hostel-1.avif"
                            alt={property.title}
                            className="w-full h-full object-cover"
                        />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 bg-black/30 hover:bg-black/50 text-white p-1.5 rounded-full transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>

                    <div className="absolute bottom-3 left-4 right-4 min-w-0 text-white">
                        <h3 className="rfm-pg-title-single-line font-bold text-lg leading-tight shadow-black/50 drop-shadow-md" title={property.title}>{property.title}</h3>
                        <p className="text-sm opacity-90">{property.city}</p>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,#EFF6FF_0%,#EFF6FF_100%)] text-[var(--rf-color-primary-green-dark)] shadow-inner">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>

                    <h4 className="text-2xl font-black text-gray-900 mb-2">Coming Soon</h4>
                    <p className="text-gray-600 mb-6 font-medium">
                        The full booking flow will be implemented in the next phase. You can view more details about this property for now.
                    </p>

                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 font-bold rounded-full hover:bg-gray-50 hover:shadow-md transition-all"
                        >
                            Close
                        </button>
                        <button
                            onClick={() => {
                                onViewDetails(property.propertyId);
                                onClose();
                            }}
                            className="flex-1 rounded-full bg-[linear-gradient(135deg,#3B82F6_0%,#2563EB_100%)] px-4 py-3 font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95"
                        >
                            View Details
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


