import React, { useEffect, useState, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { PropertyCard } from './PropertyCard';
import { propertyService } from '../../services/property.service';
import type { Property } from '../../types/property.types';
import { PropertyCardSkeleton } from './PropertyCardSkeleton';
import { useLayout } from '../../hooks/useLayout';
import { useAuth } from '../../hooks/useAuth';
import { SectionHeading } from '../common/SectionHeading';

export const RecentViewed: React.FC = memo(() => {
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);
    const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { currentLocation } = useLayout();

    useEffect(() => {
        const loadRecents = async () => {
            setLoading(true);
            try {
                const results = await propertyService.getRecentlyViewed(
                    currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : undefined
                );
                setProperties(results);
            } catch (error) {
                console.error('Error loading recents:', error);
            } finally {
                setLoading(false);
            }
        };

        loadRecents();
    }, [currentLocation]);

    useEffect(() => {
        if (!currentUser) {
            setUserFavorites(new Set());
            return;
        }

        let isMounted = true;

        void propertyService.getFavorites(currentUser.id)
            .then((favorites) => {
                if (isMounted) {
                    setUserFavorites(new Set(favorites));
                }
            })
            .catch((error) => {
                console.error('Error loading favorites:', error);
            });

        return () => {
            isMounted = false;
        };
    }, [currentUser]);

    const handleToggleFavorite = async (propertyId: string) => {
        if (!currentUser) {
            navigate('/login');
            return;
        }

        const wasFavorite = userFavorites.has(propertyId);
        const nextFavorites = new Set(userFavorites);

        if (wasFavorite) {
            nextFavorites.delete(propertyId);
        } else {
            nextFavorites.add(propertyId);
        }

        setUserFavorites(nextFavorites);

        try {
            await propertyService.toggleFavorite(currentUser.id, propertyId);
            toast.success(wasFavorite ? 'Removed from favorites' : 'Saved to favorites');
        } catch (error) {
            setUserFavorites(userFavorites);
            console.error('Error toggling favorite:', error);
            toast.error('Failed to update favorites');
        }
    };

    if (!loading && properties.length === 0) return null;

    return (
        <section className="rfm-recent-viewed bg-listing-section overflow-hidden pb-0 pt-0 lg:pb-0 lg:pt-0">
            <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
                <div className="rfm-recent-shell pt-0">
                <div className="rfm-recent-heading">
                    <SectionHeading
                        title="Recently Viewed"
                        icon={(
                            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        )}
                        variant="listing"
                    />
                </div>

                <div className="rfm-recent-viewed-track no-scrollbar -mx-4 mt-0 flex gap-1.5 overflow-x-auto px-4 pb-0 pt-1 sm:mx-0 sm:gap-2 sm:px-0 lg:mt-2 lg:gap-5 lg:pb-1">
                    {loading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="rfm-recent-viewed-skeleton w-[240px] sm:w-[260px] md:w-[302px] flex-shrink-0">
                                <PropertyCardSkeleton />
                            </div>
                        ))
                    ) : (
                        properties.map(property => (
                            <PropertyCard
                                key={property.propertyId}
                                property={property}
                                onView={(id) => navigate(`/property/${id}`)}
                                onBook={(id) => navigate(`/property/${id}`)}
                                onToggleFavorite={handleToggleFavorite}
                                isFavorite={userFavorites.has(property.propertyId)}
                                compact={true}
                            />
                        ))
                    )}
                </div>
                </div>
            </div>
        </section>
    );
});

RecentViewed.displayName = 'RecentViewed';
