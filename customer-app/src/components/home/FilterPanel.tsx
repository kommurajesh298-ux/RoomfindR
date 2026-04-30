import React, { useState } from 'react';
import type { PropertyFilters } from '../../types/property.types';

interface FilterPanelProps {
    currentFilters: PropertyFilters;
    onApply: (filters: PropertyFilters) => void;
    onClose: () => void;
    isOpen: boolean;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({ currentFilters, onApply, onClose, isOpen }) => {
    const [filters, setFilters] = useState<PropertyFilters>(currentFilters);

    if (!isOpen) return null;

    const propertyTypes = [
        { id: 'Girls', label: 'Girls PG' },
        { id: 'Boys', label: 'Boys PG' },
        { id: 'Hostel', label: 'Hostel' },
        { id: 'Co-living', label: 'Co-living' },
    ];

    const propertyTiers = [
        { id: 'Premium', label: 'Premium' },
        { id: 'Luxury', label: 'Luxury' },
    ];

    const roomTypes = [
        { id: 'private', label: 'Private Room' },
        { id: 'sharing_2', label: '2 Sharing' },
        { id: 'sharing_3', label: '3+ Sharing' },
    ];

    const amenities = [
        { id: 'wifi', label: 'Wifi' },
        { id: 'ac', label: 'AC' },
        { id: 'meals', label: 'Meals' },
        { id: 'laundry', label: 'Laundry' },
        { id: 'security', label: 'Security' },
    ];

    const handleFeatureToggle = (featureId: string) => {
        setFilters(prev => {
            const currentFeatures = prev.features || [];
            const newFeatures = currentFeatures.includes(featureId)
                ? currentFeatures.filter(f => f !== featureId)
                : [...currentFeatures, featureId];
            return { ...prev, features: newFeatures };
        });
    };

    const handleTypeSelect = (type: string) => {
        setFilters(prev => {
            const currentTags = prev.tags || [];

            // Define mutual exclusivity groups
            const propertyTypeGroup = ['Girls', 'Boys', 'Hostel', 'Co-living'];
            const propertyTierGroup = ['Premium', 'Luxury'];
            const roomTypeGroup = ['private', 'sharing_2', 'sharing_3'];

            let newTags: string[];

            if (currentTags.includes(type)) {
                // Toggle off
                newTags = currentTags.filter(t => t !== type);
            } else {
                // Toggle on
                // If the selected type belongs to a mutual exclusivity group, 
                // remove other members of that group first.
                if (propertyTypeGroup.includes(type)) {
                    newTags = [...currentTags.filter(t => !propertyTypeGroup.includes(t)), type];
                } else if (propertyTierGroup.includes(type)) {
                    newTags = [...currentTags.filter(t => !propertyTierGroup.includes(t)), type];
                } else if (roomTypeGroup.includes(type)) {
                    newTags = [...currentTags.filter(t => !roomTypeGroup.includes(t)), type];
                } else {
                    // Independent tag (like 'offers')
                    newTags = [...currentTags, type];
                }
            }

            return { ...prev, tags: newTags };
        });
    };

    const handlePriceChange = (type: 'min' | 'max', value: string) => {
        const numVal = parseInt(value) || 0;
        setFilters(prev => ({
            ...prev,
            priceRange: {
                min: type === 'min' ? numVal : (prev.priceRange?.min || 0),
                max: type === 'max' ? numVal : (prev.priceRange?.max || 50000)
            }
        }));
    };

    const handleApply = () => {
        onApply(filters);
    };

    const handleReset = () => {
        setFilters({});
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 z-[155] backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="fixed inset-0 flex items-center justify-center z-[160] pointer-events-none">
                <div className="pointer-events-auto flex max-h-[85vh] w-[90%] flex-col overflow-hidden rounded-2xl border border-[#d7e5fb] bg-white/95 shadow-[0_28px_56px_rgba(16,96,208,0.16)] backdrop-blur-xl animate-in zoom-in-95 duration-200 sm:w-[420px] md:rounded-3xl">

                    {/* Header */}
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-100 flex justify-between items-center bg-transparent">
                        <h2 className="bg-gradient-to-r from-[#3B82F6] to-[#2563EB] bg-clip-text text-lg font-bold text-transparent sm:text-xl">Filters</h2>
                        <button
                            onClick={onClose}
                            aria-label="Close filters"
                            className="p-2 -mr-2 rounded-full text-gray-400 transition-colors hover:bg-[#EFF6FF] hover:text-[#3B82F6]"
                        >
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 no-scrollbar bg-gradient-to-b from-transparent via-[#EFF6FF]/40 to-[#EFF6FF]">

                        {/* Property Type */}
                        <section>
                            <h3 className="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Property Type</h3>
                            <div className="flex flex-wrap gap-3">
                                {propertyTypes.map((type) => {
                                    const isSelected = filters.tags?.includes(type.id);
                                    return (
                                        <button
                                            key={type.id}
                                            onClick={() => handleTypeSelect(type.id)}
                                            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold border transition-all ${isSelected
                                                ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white border-transparent shadow-lg shadow-[#3B82F6]/20 transform scale-105'
                                                : 'bg-white text-gray-600 border-gray-200 hover:border-[#E5E7EB] hover:bg-[#EFF6FF] hover:text-[#3B82F6]'
                                                }`}
                                        >
                                            {type.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        <section>
                            <h3 className="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Property Tier</h3>
                            <div className="flex flex-wrap gap-3">
                                {propertyTiers.map((tier) => {
                                    const isSelected = filters.tags?.includes(tier.id);
                                    return (
                                        <button
                                            key={tier.id}
                                            onClick={() => handleTypeSelect(tier.id)}
                                            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold border transition-all ${isSelected
                                                ? 'bg-gradient-to-r from-[#F59E0B] to-[#D97706] text-white border-transparent shadow-lg shadow-[#F59E0B]/20 transform scale-105'
                                                : 'bg-white text-gray-600 border-gray-200 hover:border-[#FDE68A] hover:bg-[#FFFBEB] hover:text-[#B45309]'
                                                }`}
                                        >
                                            {tier.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        {/* Price Range */}
                        <section>
                            <h3 className="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Price Range (₹/mo)</h3>
                            <div className="flex items-center gap-2 sm:gap-4">
                                <div className="flex-1">
                                    <label htmlFor="min-price" className="text-[10px] sm:text-xs text-gray-500 mb-1 block font-medium">Min Price</label>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-xs sm:text-sm group-focus-within:text-[#3B82F6] transition-colors">₹</span>
                                        <input
                                            id="min-price"
                                            type="number"
                                            min="0"
                                            value={filters.priceRange?.min || ''}
                                            onChange={(e) => handlePriceChange('min', e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2 pl-6 pr-2 text-sm font-medium outline-none transition-all focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/10 sm:py-2.5 sm:pl-7 sm:pr-3"
                                        />
                                    </div>
                                </div>
                                <div className="text-gray-300">-</div>
                                <div className="flex-1">
                                    <label htmlFor="max-price" className="text-[10px] sm:text-xs text-gray-500 mb-1 block font-medium">Max Price</label>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-xs sm:text-sm group-focus-within:text-[#3B82F6] transition-colors">₹</span>
                                        <input
                                            id="max-price"
                                            type="number"
                                            min="0"
                                            value={filters.priceRange?.max || ''}
                                            onChange={(e) => handlePriceChange('max', e.target.value)}
                                            placeholder="Any"
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2 pl-6 pr-2 text-sm font-medium outline-none transition-all focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/10 sm:py-2.5 sm:pl-7 sm:pr-3"
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Room Type */}
                        <section>
                            <h3 className="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Room Type</h3>
                            <div className="flex flex-wrap gap-3">
                                {roomTypes.map((type) => {
                                    const isSelected = filters.tags?.includes(type.id);
                                    return (
                                        <button
                                            key={type.id}
                                            onClick={() => handleTypeSelect(type.id)}
                                            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold border transition-all ${isSelected
                                                ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white border-transparent shadow-lg shadow-[#3B82F6]/20 transform scale-105'
                                                : 'bg-white text-gray-600 border-gray-200 hover:border-[#E5E7EB] hover:bg-[#EFF6FF] hover:text-[#3B82F6]'
                                                }`}
                                        >
                                            {type.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        {/* Near Me Toggle */}
                        <section className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-gradient-to-r from-[#EFF6FF] to-[#EFF6FF] p-3 py-1.5 sm:py-2">
                            <div>
                                <h3 className="text-xs sm:text-sm font-bold text-gray-900">Show stays near me</h3>
                                <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">Use GPS for precise distance sorting</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    id="filter-near-me"
                                    name="nearMe"
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={filters.sortBy === 'distance'}
                                    onChange={() => {
                                        setFilters(prev => ({
                                            ...prev,
                                            sortBy: prev.sortBy === 'distance' ? 'popular' : 'distance',
                                            tags: prev.sortBy === 'distance' ? prev.tags : [] // Clear tags if enabling near me
                                        }));
                                    }}
                                />
                                <div className="h-5 w-9 rounded-full bg-gray-200 peer peer-focus:outline-none peer-checked:bg-gradient-to-r peer-checked:from-[#3B82F6] peer-checked:to-[#2563EB] peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] sm:h-6 sm:w-11 sm:after:h-5 sm:after:w-5"></div>
                            </label>
                        </section>

                        {/* Offers Toggle */}
                        <section className="flex items-center justify-between rounded-xl border border-[#f5c3bc] bg-gradient-to-r from-[#fff2ef] to-[#fff8dd] p-3 py-1.5 sm:py-2">
                            <div>
                                <h3 className="text-xs sm:text-sm font-bold text-gray-900">Show only properties with offers</h3>
                                <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">Discounts, No brokerage, etc.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    id="filter-offers-only"
                                    name="offersOnly"
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={filters.tags?.includes('offers') || false}
                                    onChange={() => handleTypeSelect('offers')}
                                />
                                <div className="h-5 w-9 rounded-full bg-gray-200 peer peer-focus:outline-none peer-checked:bg-gradient-to-r peer-checked:from-[#F05040] peer-checked:to-[#F0D030] peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] sm:h-6 sm:w-11 sm:after:h-5 sm:after:w-5"></div>
                            </label>
                        </section>

                        {/* Availability Date Range */}
                        <section>
                            <h3 className="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Availability</h3>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label htmlFor="move-in-date" className="text-[10px] sm:text-xs text-gray-500 mb-1 block font-medium">Move-in Date</label>
                                    <input
                                        id="move-in-date"
                                        type="date"
                                        value={filters.availability?.start || ''}
                                        onChange={(e) => setFilters(prev => ({
                                            ...prev,
                                            availability: {
                                                start: e.target.value,
                                                end: prev.availability?.end || ''
                                            }
                                        }))}
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs font-medium text-gray-700 outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/10 sm:py-2.5 sm:text-base"
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Distance Radius */}
                        <section>
                            <div className="flex justify-between items-center mb-3 sm:mb-4">
                                <h3 className="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider">Distance Radius</h3>
                                <span className="rounded bg-gradient-to-r from-[#3B82F6] to-[#2563EB] px-2 py-0.5 text-xs font-bold text-white shadow-sm sm:text-sm">{filters.distanceRadius || 10} km</span>
                            </div>
                            <input
                                id="filter-distance-radius"
                                name="distanceRadius"
                                type="range"
                                min="1"
                                max="50"
                                aria-label="Filter by distance radius"
                                value={filters.distanceRadius || 10}
                                onChange={(e) => {
                                    const radius = parseInt(e.target.value);
                                    setFilters(prev => ({
                                        ...prev,
                                        distanceRadius: radius
                                    }));
                                }}
                                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-[#3B82F6] sm:h-2"
                            />
                            <div className="flex justify-between text-[10px] sm:text-xs text-gray-400 mt-2 font-medium">
                                <span>1 km</span>
                                <span>50 km</span>
                            </div>
                        </section>

                        {/* Amenities */}
                        <section>
                            <h3 className="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Amenities</h3>
                            <div className="space-y-1 sm:space-y-3">
                                {amenities.map((item) => (
                                    <label key={item.id} className="group -mx-2 flex cursor-pointer items-center justify-between rounded-lg p-2 transition-colors hover:bg-[#EFF6FF]">
                                        <span className="text-sm font-medium text-gray-700 group-hover:text-[#0b2d66] sm:text-base">{item.label}</span>
                                        <div className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                id={`filter-amenity-${item.id}`}
                                                name={`amenity-${item.id}`}
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={filters.features?.includes(item.id) || false}
                                                onChange={() => handleFeatureToggle(item.id)}
                                            />
                                            <div className="flex h-4 w-4 items-center justify-center rounded border-2 border-gray-300 transition-all peer-checked:border-[#3B82F6] peer-checked:bg-[#3B82F6] sm:h-5 sm:w-5">
                                                <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </section>
                    </div>

                    {/* Footer */}
                    <div className="flex gap-3 border-t border-gray-100 bg-white/80 p-4 pb-4 backdrop-blur-md sm:gap-4 sm:p-6 sm:pb-6">
                        <button
                            onClick={handleReset}
                            className="flex-1 py-2.5 sm:py-3.5 px-4 bg-white border border-gray-200 text-gray-900 text-sm sm:text-base font-bold rounded-full hover:bg-gray-50 hover:border-gray-300 focus:outline-none transition-all active:scale-95"
                        >
                            Reset
                        </button>
                        <button
                            onClick={handleApply}
                            className="flex-1 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#3B82F6]/30 transition-all focus:outline-none hover:shadow-[#3B82F6]/50 active:scale-95 sm:py-3.5 sm:text-base"
                        >
                            Show Results
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

