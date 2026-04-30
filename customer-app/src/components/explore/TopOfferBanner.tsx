import React from 'react';
import { motion } from 'framer-motion';

interface TopOfferBannerProps {
    offer: {
        code: string;
        type: 'percentage' | 'flat';
        value: number;
    };
    onRemove: () => void;
}

export const TopOfferBanner: React.FC<TopOfferBannerProps> = ({ offer, onRemove }) => {
    return (
        <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full bg-[linear-gradient(90deg,var(--rf-color-action-hover),var(--rf-color-action),var(--rf-color-primary-green-dark))] text-white py-3 px-4 sm:px-6 shadow-lg shadow-orange-200/70 sticky top-[60px] md:top-[76px] z-20"
        >
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 sm:gap-4 overflow-hidden">
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        <span className="text-lg" aria-hidden>🏷️</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0 sm:gap-2 truncate">
                        <p className="font-bold text-sm sm:text-base truncate">
                            Offer Applied: <span className="text-blue-100">{offer.code}</span>
                        </p>
                        <p className="text-[10px] sm:text-sm font-medium opacity-90 truncate">
                            — {offer.type === 'percentage' ? `${offer.value}% OFF` : `₹${offer.value} OFF`} on Verified PGs
                        </p>
                    </div>
                </div>

                <button
                    onClick={onRemove}
                    className="shrink-0 px-4 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/30 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
                >
                    Remove Offer
                </button>
            </div>
        </motion.div>
    );
};


