import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IoCloseOutline, IoCheckmarkCircle, IoBusinessOutline } from 'react-icons/io5';
import type { Property } from '../../types/property.types';

interface PropertyPickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    properties: Property[];
    selectedPropertyId: string;
    onSelect: (id: string) => void;
}

const PropertyPickerModal: React.FC<PropertyPickerModalProps> = ({
    isOpen,
    onClose,
    properties,
    selectedPropertyId,
    onSelect
}) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                            <div>
                                <h3 className="text-xl font-black text-gray-900 leading-tight">Pick a Property</h3>
                                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">Filter active room views</p>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-10 h-10 flex items-center justify-center rounded-2xl bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                            >
                                <IoCloseOutline size={24} />
                            </button>
                        </div>

                        {/* List */}
                        <div className="p-4 max-h-[60vh] overflow-y-auto no-scrollbar space-y-2">
                            <button
                                onClick={() => { onSelect('all'); onClose(); }}
                                className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all ${selectedPropertyId === 'all'
                                    ? 'bg-primary-50 border-2 border-primary-500'
                                    : 'bg-white border-2 border-transparent hover:bg-gray-50 hover:border-gray-100'
                                    }`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${selectedPropertyId === 'all' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                        <IoBusinessOutline size={24} />
                                    </div>
                                    <div className="text-left">
                                        <p className={`font-black text-base ${selectedPropertyId === 'all' ? 'text-primary-700' : 'text-gray-900'}`}>All Properties</p>
                                        <p className="text-xs text-gray-400 font-bold">Show everything</p>
                                    </div>
                                </div>
                                {selectedPropertyId === 'all' && (
                                    <IoCheckmarkCircle className="text-primary-600" size={24} />
                                )}
                            </button>

                            {properties.map(property => (
                                <button
                                    key={property.propertyId}
                                    onClick={() => { onSelect(property.propertyId); onClose(); }}
                                    className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all ${selectedPropertyId === property.propertyId
                                        ? 'bg-primary-50 border-2 border-primary-500'
                                        : 'bg-white border-2 border-transparent hover:bg-gray-50 hover:border-gray-100'
                                        }`}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-xl overflow-hidden bg-gray-100`}>
                                            {property.images && property.images[0] ? (
                                                <img src={property.images[0]} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                    <IoBusinessOutline size={20} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-left">
                                            <p className={`font-black text-base ${selectedPropertyId === property.propertyId ? 'text-primary-700' : 'text-gray-900'}`}>{property.title}</p>
                                            <p className="text-xs text-gray-400 font-bold">{property.address.text || property.city}</p>
                                        </div>
                                    </div>
                                    {selectedPropertyId === property.propertyId && (
                                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                                            <IoCheckmarkCircle className="text-primary-600" size={24} />
                                        </motion.div>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="p-4 bg-gray-50 border-t border-gray-100">
                            <button
                                onClick={onClose}
                                className="w-full h-12 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default PropertyPickerModal;
