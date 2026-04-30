import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { propertyService } from '../services/property.service';
import type { Property, PropertyFilters } from '../types/property.types';
import { PropertyCard } from '../components/home/PropertyCard';
import { PropertyCardSkeleton } from '../components/home/PropertyCardSkeleton';
import { TopOfferBanner } from '../components/explore/TopOfferBanner';
import { offerService } from '../services/offer.service';
import type { Offer } from '../types/offer.types';
import { useAuth } from '../hooks/useAuth';
import { useLayout } from '../hooks/useLayout';
import { toast } from 'react-hot-toast';

const shouldAutoDistanceSort = (location: { source?: string | null } | null | undefined) =>
    Boolean(location?.source && location.source !== 'profile');



const Explore = () => {
    const { currentUser } = useAuth();
    const { currentLocation, setShowNavbarSearch } = useLayout();
    const navigate = useNavigate();
    const query = new URLSearchParams(useLocation().search);
    const offerCodeParam = query.get('offer');

    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);
    const [offer, setOffer] = useState<Offer | null>(null);
    const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
    const currentUserId = currentUser?.id;

    // Load User Favorites
    useEffect(() => {
        if (currentUserId) {
            propertyService.getFavorites(currentUserId).then(favs => {
                setUserFavorites(new Set(favs));
            });
        }
    }, [currentUserId]);

    const handleRemoveOffer = React.useCallback(() => {
        localStorage.removeItem('claimedOffer');
        navigate('/');
    }, [navigate]);

    // Fetch Offer Details & Set Up Listener
    useEffect(() => {
        if (!offerCodeParam) {
            return;
        }

        let unsubscribe: (() => void) | undefined;

        const fetchOffer = async () => {
            const result = await offerService.claimOffer(offerCodeParam, currentUser?.id);
            if (result.success && result.offer) {
                setOffer(result.offer);
                unsubscribe = offerService.subscribeToOffer(result.offer.offerId!, (updatedOffer) => {
                    if (!updatedOffer) {
                        toast.error('Offer is no longer available');
                        handleRemoveOffer();
                    } else {
                        if (new Date(updatedOffer.expiry!).getTime() < Date.now()) {
                            toast.error('Offer has expired');
                            handleRemoveOffer();
                        } else {
                            setOffer(updatedOffer);
                        }
                    }
                });
            } else {
                toast.error(result.message || 'Invalid offer code');
                navigate('/');
            }
        };

        fetchOffer();
        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [offerCodeParam, currentUser?.id, navigate, handleRemoveOffer]);

    // Fetch Properties based on Offer
    useEffect(() => {
        if (!offer) return;

        // Apply category and min amount filters based on offer
        const filters: PropertyFilters = {
            tags: offer.appliesTo?.includes('all') ? undefined : offer.appliesTo,
            priceRange: { min: offer.minBookingAmount || 0, max: 100000 },
            city: currentLocation?.city || undefined,
            sortBy: shouldAutoDistanceSort(currentLocation) ? 'distance' : 'popular'
        };

        const unsubscribe = propertyService.subscribeToProperties(
            filters,
            50,
            (fetchedProperties) => {
                // Further client-side filtering to ensure strict matching
                // Especially for "isVerified"
                setProperties(fetchedProperties.filter(p => p.verified));
                setLoading(false);
            },
            currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : undefined
        );

        return () => unsubscribe();
    }, [offer, currentLocation, currentLocation?.city, currentLocation?.lat, currentLocation?.lng, currentLocation?.source]);

    useEffect(() => {
        if (offerCodeParam || offer) return;

        const filters: PropertyFilters = {
            city: currentLocation?.city || undefined,
            sortBy: shouldAutoDistanceSort(currentLocation) ? 'distance' : 'popular'
        };

        const unsubscribe = propertyService.subscribeToProperties(
            filters,
            50,
            (fetchedProperties) => {
                setProperties(fetchedProperties);
                setLoading(false);
            },
            currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : undefined
        );

        return () => unsubscribe();
    }, [offer, offerCodeParam, currentLocation, currentLocation?.city, currentLocation?.lat, currentLocation?.lng, currentLocation?.source]);

    const handleView = (id: string) => navigate(`/property/${id}`);
    const handleSave = async (id: string) => {
        if (!currentUser) {
            navigate('/login');
            return;
        }
        try {
            const isFav = await propertyService.toggleFavorite(currentUser.id, id);
            setUserFavorites(prev => {
                const newSet = new Set(prev);
                if (isFav) newSet.add(id);
                else newSet.delete(id);
                return newSet;
            });
            toast.success(isFav ? 'Added to favorites' : 'Removed');
        } catch {
            toast.error('Failed to save');
        }
    };

    useEffect(() => {
        setShowNavbarSearch(true);

        let lastScrollY = window.scrollY;
        let ticking = false;

        const updateScroll = () => {
            const currentScrollY = window.scrollY;

            if (currentScrollY > 50 && lastScrollY <= 50) {
                setShowNavbarSearch(false);
            } else if (currentScrollY <= 50 && lastScrollY > 50) {
                setShowNavbarSearch(true);
            }

            lastScrollY = currentScrollY;
            ticking = false;
        };

        const handleScroll = () => {
            if (!ticking) {
                window.requestAnimationFrame(updateScroll);
                ticking = true;
            }
        };

        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            window.removeEventListener('scroll', handleScroll);
            setShowNavbarSearch(true);
        };
    }, [setShowNavbarSearch]);

    const isOfferExplore = Boolean(offer);
    const pageTitle = isOfferExplore ? 'Eligible Properties' : 'Explore Properties';
    const pageSubtitle = isOfferExplore
        ? `${properties.length} verified stays found for your offer.`
        : `${properties.length} stays available for you right now.`;

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(254,215,170,0.55),_transparent_36%),linear-gradient(180deg,#ffffff_0%,#f9fafb_100%)] pb-20">
            {offer && (
                <TopOfferBanner
                    offer={{
                        code: offer.code,
                        type: offer.type!,
                        value: offer.value!
                    }}
                    onRemove={handleRemoveOffer}
                />
            )}

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
                <div className="mb-5 sm:mb-7">
                    <h1 className="text-[24px] leading-[1.05] sm:text-[30px] lg:text-[34px] font-black text-[var(--rf-color-text)] tracking-tight mb-1.5 sm:mb-2">
                        {pageTitle}
                    </h1>
                    <p className="text-[14px] sm:text-[16px] lg:text-[17px] text-gray-600 font-medium leading-[1.45]">
                        {pageSubtitle}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-[repeat(auto-fit,minmax(272px,304px))] lg:justify-start lg:gap-5">
                    {loading ? (
                        Array.from({ length: 8 }).map((_, i) => <PropertyCardSkeleton key={i} />)
                    ) : properties.map(property => (
                        <PropertyCard
                            key={property.propertyId}
                            property={property}
                            onView={handleView}
                            onToggleFavorite={handleSave}
                            onBook={() => { }} // Not used in this grid
                            isFavorite={userFavorites.has(property.propertyId)}
                            appliedOffer={offer ? {
                                ...offer,
                                id: offer.offerId,
                                type: offer.type as 'percentage' | 'flat',
                                value: offer.value,
                                active: offer.active
                            } : undefined}
                        />
                    ))}
                </div>

                {!loading && properties.length === 0 && (
                    <div className="text-center py-14 px-4 sm:px-6 sm:py-16 bg-white/60 backdrop-blur-xl rounded-3xl border border-white shadow-xl">
                        <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-orange-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-5 sm:mb-6 shadow-inner">
                            <svg className="h-9 w-9 sm:h-10 sm:w-10 text-[#F97316]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5a1 1 0 011-1h4a1 1 0 011 1v5M9 10h.01M15 10h.01M9 13h.01M15 13h.01" />
                            </svg>
                        </div>
                        <h3 className="text-[18px] sm:text-[22px] font-black leading-[1.2] text-gray-900 mb-2">
                            {isOfferExplore ? 'No properties match this offer' : 'No properties available right now'}
                        </h3>
                        <p className="text-[14px] sm:text-[15px] text-gray-600 max-w-[320px] mx-auto font-medium leading-[1.6]">
                            {isOfferExplore
                                ? 'Try checking other categories or browse all properties to find your perfect stay.'
                                : 'Try adjusting your location or search filters and check back in a moment.'}
                        </p>
                        <button
                            onClick={() => navigate('/')}
                            className="mt-7 h-[46px] sm:h-[50px] px-6 sm:px-8 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-[13px] sm:text-[15px] font-bold tracking-[0.5px] rounded-full shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-105 transition-all active:scale-95 uppercase sm:normal-case"
                        >
                            Back to Home
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Explore;

