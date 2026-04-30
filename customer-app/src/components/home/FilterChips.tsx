import React, { memo } from 'react';
import allCategoryImage from '../../assets/categories/all.png';
import girlsCategoryImage from '../../assets/categories/girls_pg.png';
import boysCategoryImage from '../../assets/categories/boys_pg.png';
import coLivingCategoryImage from '../../assets/categories/coliving.png';
import premiumCategoryImage from '../../assets/categories/premium.png';
import luxuryCategoryImage from '../../assets/categories/luxury.png';

interface FilterChipsProps {
    activeFilter?: string;
    onFilterChange: (filter: string | undefined) => void;
}

type CategoryMeta = {
    id: string;
    label: string;
    accent: string;
    glow: string;
    image: string;
    imagePosition: string;
    imageScale: number;
};

const CATEGORIES: CategoryMeta[] = [
    { id: 'all', label: 'All', accent: '#2563EB', glow: 'rgba(37,99,235,0.26)', image: allCategoryImage, imagePosition: '42% 42%', imageScale: 1.55 },
    { id: 'Girls', label: 'Girls', accent: '#F472B6', glow: 'rgba(244,114,182,0.24)', image: girlsCategoryImage, imagePosition: '70% 34%', imageScale: 1.9 },
    { id: 'Boys', label: 'Boys', accent: '#38BDF8', glow: 'rgba(56,189,248,0.24)', image: boysCategoryImage, imagePosition: '50% 48%', imageScale: 1.32 },
    { id: 'Co-living', label: 'Co-living', accent: '#14B8A6', glow: 'rgba(20,184,166,0.24)', image: coLivingCategoryImage, imagePosition: '50% 34%', imageScale: 1.55 },
    { id: 'Hostel', label: 'Hostel', accent: '#FB923C', glow: 'rgba(251,146,60,0.24)', image: '/assets/images/properties/hostel-2.webp', imagePosition: '52% 30%', imageScale: 1.3 },
    { id: 'Premium', label: 'Premium', accent: '#EAB308', glow: 'rgba(234,179,8,0.24)', image: premiumCategoryImage, imagePosition: '50% 18%', imageScale: 1.78 },
    { id: 'Luxury', label: 'Luxury', accent: '#10B981', glow: 'rgba(16,185,129,0.24)', image: luxuryCategoryImage, imagePosition: '48% 56%', imageScale: 1.18 }
];

export const FilterChips: React.FC<FilterChipsProps> = memo(({ activeFilter = 'all', onFilterChange }) => {
    const isActive = (id: string) => {
        if (id === 'all') {
            return !activeFilter || activeFilter === 'all';
        }
        return activeFilter === id;
    };

    return (
        <div className="rfm-filter-bar w-full overflow-hidden">
            <div className="rfm-filter-scroll rfm-filter-scroll--no-indicator w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden">
                <div className="rfm-filter-tabs flex w-max min-w-full items-stretch gap-0 px-0 lg:w-full lg:min-w-0 lg:justify-center lg:px-0 lg:pr-0">
                    {CATEGORIES.map((category) => {
                        const active = isActive(category.id);

                        return (
                            <button
                                key={category.id}
                                type="button"
                                onClick={() => onFilterChange(category.id === 'all' ? undefined : category.id)}
                                style={{
                                    ['--rf-filter-accent' as string]: category.accent,
                                    ['--rf-filter-glow' as string]: category.glow,
                                    ['--rf-filter-image-position' as string]: category.imagePosition,
                                    ['--rf-filter-image-scale' as string]: String(category.imageScale)
                                }}
                                className={[
                                    'rfm-filter-chip',
                                    'flex shrink-0 snap-start flex-col items-center justify-center lg:snap-none',
                                    active ? 'rfm-filter-chip--active' : ''
                                ].join(' ')}
                            >
                                <div className="rfm-filter-visual">
                                    <img
                                        src={category.image}
                                        alt={category.label}
                                        className="rfm-filter-image"
                                        loading="lazy"
                                        decoding="async"
                                    />
                                </div>
                                <span className="rfm-filter-label">
                                    {category.label}
                                </span>
                                <span className={`rfm-filter-underline ${active ? 'rfm-filter-underline--active' : ''}`} />
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

FilterChips.displayName = 'FilterChips';
