/* eslint-disable no-irregular-whitespace */
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { userService } from '../services/user.service';
import { propertyService } from '../services/property.service';
import { ownerService } from '../services/owner.service';
import { offerService } from '../services/offer.service';
import { useAuth } from '../hooks/useAuth';
import { ImageGallery } from '../components/property/ImageGallery';
import { BookingModalFull } from '../components/property/BookingModalFull';
import PaymentErrorOverlay from '../components/payments/PaymentErrorOverlay';
import RatingPopup from '../components/RatingPopup';
import RatingStars from '../components/common/RatingStars';
import { ratingService, type PropertyReview, type UserPropertyRatingContext } from '../services/rating.service';


import toast from 'react-hot-toast';
import type { Property, Room, FoodMenuItem } from '../types/property.types';
import type { Owner } from '../types/owner.types';
import type { Offer } from '../types/booking.types';
import { useLayout } from '../hooks/useLayout';
import { getLocationDisplayName } from '../services/location.service';
import { getVacancySummary, resolveVacancyCount } from '../../../shared/vacancy';

const PropertyDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { currentUser, userData } = useAuth();
    const { currentLocation } = useLayout();

    // Kill switch logic moved to Render phase to avoid Hook Violation (Rendered fewer hooks)

    const [property, setProperty] = useState<Property | null>(null);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [owner, setOwner] = useState<Owner | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'rooms' | 'amenities' | 'food' | 'nearby' | 'reviews' | 'owner'>('overview');
    const [showBookingModal, setShowBookingModal] = useState(false);

    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
    const [highlightedRoomId, setHighlightedRoomId] = useState<string | null>(null);
    const roomsRef = React.useRef<HTMLDivElement>(null);
    const [menuUpdatesEnabled, setMenuUpdatesEnabled] = useState(false);
    const [foodMenu, setFoodMenu] = useState<FoodMenuItem[]>([]);
    const [offers, setOffers] = useState<Offer[]>([]);
    const [reviews, setReviews] = useState<PropertyReview[]>([]);
    const [reviewsLoading, setReviewsLoading] = useState(true);
    const [ratingContext, setRatingContext] = useState<UserPropertyRatingContext>({
        bookingId: null,
        canRate: false,
        existingRating: null,
        type: 'checkout',
    });
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [dismissedPaymentFailureKey, setDismissedPaymentFailureKey] = useState<string | null>(null);
    const retryBookingRequested = searchParams.get('retry_booking') === '1';
    const [retryBookingCtaActive, setRetryBookingCtaActive] = useState(retryBookingRequested);
    const retryBookingRoomId = String(searchParams.get('room_id') || '').trim();
    const autoOpenedRetryRef = React.useRef(false);
    const headerLocationLabel = currentLocation
        ? getLocationDisplayName(currentLocation)
        : (property?.address?.text?.split(',')[0] || property?.city || 'Select Location');

    const totalVacancies = useMemo(() => {
        return resolveVacancyCount(property?.vacancies, rooms);
    }, [property?.vacancies, rooms]);
    const totalVacancySummary = useMemo(() => getVacancySummary(totalVacancies), [totalVacancies]);

    const vacancyStatusUi = useMemo(() => {
        if (totalVacancySummary.isSoldOut) {
            return {
                label: totalVacancySummary.label,
                className: 'border border-red-200 bg-red-50 text-red-700'
            };
        }

        if (totalVacancies <= 3) {
            return {
                label: totalVacancySummary.label,
                className: 'border border-orange-200 bg-orange-50 text-orange-700'
            };
        }

        return {
            label: totalVacancySummary.label,
            className: 'border border-emerald-200 bg-emerald-50 text-emerald-700'
        };
    }, [totalVacancies, totalVacancySummary]);

    const ratingSummary = useMemo(() => {
        const avgRating = Number(property?.avgRating || 0) || 0;
        const totalRatings = Number(property?.totalRatings || 0) || 0;
        const hasRatings = avgRating > 0 && totalRatings > 0;

        return {
            avgRating,
            totalRatings,
            hasRatings,
            summaryText: hasRatings
                ? `${avgRating.toFixed(1)} (${totalRatings} ${totalRatings === 1 ? 'rating' : 'ratings'})`
                : 'No ratings yet',
        };
    }, [property?.avgRating, property?.totalRatings]);

    useEffect(() => {
        if (activeTab !== 'rooms' || !highlightedRoomId) return;

        const timer = window.setTimeout(() => {
            roomsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);

        return () => window.clearTimeout(timer);
    }, [activeTab, highlightedRoomId]);

    useEffect(() => {
        if (!currentUser) return;
        const unsubscribePrefs = userService.subscribeToUserDocument(currentUser.id, (data) => {
            if (data?.notificationPreferences) {
                setMenuUpdatesEnabled(data.notificationPreferences.menuUpdates || false);
            }
        });
        return () => unsubscribePrefs();
    }, [currentUser]);

    const handleToggleMenuUpdates = async () => {
        if (!currentUser) {
            toast.error('Please login to subscribe');
            return;
        }

        const newValue = !menuUpdatesEnabled;
        setMenuUpdatesEnabled(newValue); // Optimistic update

        try {
            await userService.updateUserProfile(currentUser.id, {
                notificationPreferences: {
                    menuUpdates: newValue,
                    bookingUpdates: true,
                    ownerMessages: true,
                    offersDiscounts: true
                }
            });
            toast.success(newValue ? 'Subscribed to menu updates' : 'Unsubscribed from menu updates');
        } catch (error: unknown) {
            console.error('Error updating preference:', error);
            setMenuUpdatesEnabled(!newValue); // Revert on error
            toast.error('Failed to update preference');
        }
    };

    useEffect(() => {
        if (!id) return;
        let isMounted = true;

        // Add to recently viewed
        propertyService.addToRecentlyViewed(id);

        // Fetch property and setup real-time listener
        const unsubscribeProperty = propertyService.subscribeToProperty(
            id,
            (propertyData) => {
                if (!isMounted) return; // Prevent zombie updates

                if (propertyData) {
                    // Real-time suspension handling
                    if (!propertyData.published) {
                        toast.error('This property is no longer available');
                        navigate('/');
                        return;
                    }
                    setProperty(propertyData);
                } else {
                    if (!navigator.onLine) {
                        toast.error('Offline: Property not found in cache');
                    } else {
                        // Only show error if we are actually supposed to be viewing this property
                        console.warn('Property lookup failed for', id);
                        toast.error('Property not found');
                    }
                    if (isMounted) navigate('/');
                }
                if (isMounted) setLoading(false);
            },
            currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : undefined
        );

        // Setup real-time listener for rooms subcollection
        const unsubscribeRooms = propertyService.subscribeToRooms(id, (roomsData) => {
            if (isMounted) setRooms(roomsData);
        });

        // Setup real-time listener for food menu subcollection
        const unsubscribeFood = propertyService.subscribeToFoodMenu(id, (menu) => {
            if (isMounted) setFoodMenu(menu);
        });

        return () => {
            isMounted = false;
            unsubscribeProperty();
            unsubscribeRooms();
            unsubscribeFood();
        };
    }, [id, navigate, currentLocation]);

    const paymentFailureFromQuery = useMemo(() => {
        if (searchParams.get('payment_failed') !== '1') return null;

        const context = String(searchParams.get('payment_context') || 'payment').toLowerCase();
        if (!context.includes('rent')) return null;
        return {
            key: searchParams.toString(),
            message: searchParams.get('payment_message')
                || (context.includes('verification')
                    ? 'Payment verification is taking longer than expected. Please retry or check your bookings.'
                    : 'Payment was cancelled or failed. Please try again.')
        };
    }, [searchParams]);

    // Real-time Offers listener
    useEffect(() => {
        if (!property) return;

        const unsubscribeOffers = offerService.subscribeToEligibleOffers('all', (eligibleOffers) => {
            // Filter by property tags (e.g., 'boys', 'girls')
            const applicable = eligibleOffers.filter(off =>
                (off.appliesTo?.includes('all') || !off.appliesTo) ||
                property.tags.some(tag => off.appliesTo?.includes(tag.toLowerCase()))
            );
            setOffers(applicable);
        });

        return () => unsubscribeOffers();
    }, [property]);

    // Sync Owner Data in real-time
    useEffect(() => {
        if (!property?.ownerId) return;
        const unsubscribeOwner = ownerService.subscribeToOwner(property.ownerId, (ownerData) => {
            setOwner(ownerData);
        });
        return () => unsubscribeOwner();
    }, [property?.ownerId]);

    useEffect(() => {
        if (!id) {
            setReviews([]);
            setReviewsLoading(false);
            return;
        }

        setReviewsLoading(true);
        const unsubscribeReviews = ratingService.subscribeToPropertyReviews(id, (nextReviews) => {
            setReviews(nextReviews);
            setReviewsLoading(false);
        });

        return () => unsubscribeReviews();
    }, [id]);

    useEffect(() => {
        if (!id || !currentUser) {
            setRatingContext({
                bookingId: null,
                canRate: false,
                existingRating: null,
                type: 'checkout',
            });
            return;
        }

        let alive = true;

        void ratingService.getUserPropertyRatingContext(currentUser.id, id)
            .then((context) => {
                if (alive) {
                    setRatingContext(context);
                }
            })
            .catch((error) => {
                console.error('Error loading user rating context:', error);
            });

        return () => {
            alive = false;
        };
    }, [currentUser, id]);

    // Handle legacy food menu fallback when property data is loaded
    useEffect(() => {
        if (!foodMenu.length && property?.foodMenu?.length) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setFoodMenu(property.foodMenu);
        }
    }, [property, foodMenu.length]);

    const handleShare = async () => {
        const shareData = {
            title: property?.title || 'RoomFindR Property',
            text: `Check out this property: ${property?.title}`,
            url: window.location.href
        };

        if (navigator.share) {
            try {
                await navigator.share(shareData);
            } catch {
                // Share cancelled by user
            }
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(window.location.href);
            toast.success('Link copied to clipboard!');
        }
    };

    const handleOpenMap = () => {
        if (!property) return;
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${property.address.lat},${property.address.lng}`;
        window.open(mapUrl, '_blank');

        // Log analytics
        // Log analytics (No-op after migration)
        // Track map interaction
    };

    const handleContactOwner = async () => {
        if (!currentUser) {
            toast.error('Please login to contact owner');
            navigate('/login');
            return;
        }

        if (!property || !owner) {
            toast.error('Owner information not available');
            return;
        }

        if (owner.phone) {
            window.location.href = `tel:${owner.phone}`;
        } else {
            toast.error('Owner phone number not available');
        }
    };

    const handleRatingSuccess = (result: { summary: { avgRating: number; totalRatings: number; }; review: PropertyReview; }) => {
        setProperty((current) => current ? {
            ...current,
            avgRating: result.summary.avgRating,
            totalRatings: result.summary.totalRatings,
        } : current);

        setRatingContext({
            bookingId: result.review.bookingId,
            canRate: true,
            existingRating: result.review,
            type: result.review.type,
        });

        setReviews((current) => {
            const withoutCurrent = current.filter((review) => review.id !== result.review.id);
            return [result.review, ...withoutCurrent].sort((a, b) => (
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            ));
        });

        setShowRatingModal(false);
    };

    const getPreferredRoom = (room?: Room) => {
        return room
            ?? rooms.find(r => r.status === 'available' && (r.availableCount ?? 0) > 0)
            ?? rooms[0];
    };

    const handleReserveNow = () => {
        const preferredRoom = getPreferredRoom();

        if (!preferredRoom) {
            toast.error('No rooms available to reserve right now');
            return;
        }

        if (!currentUser) {
            toast.error('Please login to book');
            navigate('/login');
            return;
        }

        setActiveTab('rooms');
        setHighlightedRoomId(String(preferredRoom.roomId));
        setSelectedRoom(preferredRoom);
        setShowBookingModal(true);
    };

    const handleBookRoom = (room?: Room) => {
        const availableRoom = getPreferredRoom(room);

        if (!availableRoom) {
            toast.error('No rooms available to reserve right now');
            return;
        }

        if (!currentUser) {
            toast.error('Please login to book');
            navigate('/login');
            return;
        }

        setHighlightedRoomId(String(availableRoom.roomId));

        setSelectedRoom(availableRoom);
        setShowBookingModal(true);
    };

    const formatCurrency = (value: number | undefined | null) => `\u20B9${Number(value ?? 0).toLocaleString('en-IN')}`;
    const clearPaymentFailureParams = () => navigate(`/property/${id}`, { replace: true });
    const showPaymentFailure = Boolean(paymentFailureFromQuery) && dismissedPaymentFailureKey !== paymentFailureFromQuery?.key;
    const paymentFailureMessage = paymentFailureFromQuery?.message || 'Payment could not be completed. Please try again.';
    const reviewActionLabel = ratingContext.existingRating ? 'Update Your Review' : 'Rate This PG';

    useEffect(() => {
        if (!retryBookingRequested || autoOpenedRetryRef.current || !property || !currentUser) return;
        setRetryBookingCtaActive(true);

        const roomToRetry = rooms.find((room) => String(room.roomId) === retryBookingRoomId)
            || rooms.find((room) => room.status === 'available' && (room.availableCount ?? 0) > 0)
            || rooms[0]
            || null;

        if (!roomToRetry) return;

        autoOpenedRetryRef.current = true;
        window.requestAnimationFrame(() => {
            setSelectedRoom(roomToRetry);
            setShowBookingModal(true);
        });

        const params = new URLSearchParams(searchParams);
        [
            'retry_booking',
            'room_id',
            'payment_failed',
            'payment_context',
            'payment_message',
        ].forEach((key) => params.delete(key));

        const next = params.toString();
        navigate(next ? `/property/${id}?${next}` : `/property/${id}`, { replace: true });
    }, [currentUser, id, navigate, property, retryBookingRequested, retryBookingRoomId, rooms, searchParams]);

    // -------------------------------------------------------------------------
    // RENDER: Kill Switch for phantom mounts
    // -------------------------------------------------------------------------
    if (loading) {
        if (!window.location.pathname.startsWith('/property/')) {
            return null;
        }
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    if (!property || !window.location.pathname.startsWith('/property/')) {
        return null;
    }

    return (
        <div className="min-h-screen bg-white rfm-property-details">
            {/* MOBILE ANDROID UI RECREATION (md:hidden) */}
            <div className="block md:hidden bg-white relative font-['Inter',_sans-serif] rfm-property-mobile">
                {/* ðŸ§­ TOP HEADER BAR */}
                <div className="rfm-pg-header sticky top-0 z-[110] bg-[linear-gradient(135deg,#2563eb_0%,#1d4ed8_100%)] pl-3 pr-4 h-[60px] flex items-center justify-between border-b border-blue-300/40 shadow-[0_12px_28px_rgba(37,99,235,0.18)]">
                    <Link to="/" className="flex items-center gap-1 active:scale-95 transition-all">
                        <img src={`${import.meta.env.BASE_URL}assets/images/logos/logo.png`} alt="Logo" className="h-[32px] w-auto object-contain drop-shadow-[0_8px_14px_rgba(15,23,42,0.22)]" />
                        <span className="text-[20px] font-black tracking-tighter">
                            <span className="text-white">Room</span>
                            <span className="text-orange-300">FindR</span>
                        </span>
                    </Link>
                    <div className="flex items-center gap-3">
                        <div className="h-[34px] px-[12px] bg-white/16 border border-white/18 rounded-[18px] flex items-center justify-center backdrop-blur-md">
                            <span className="text-[14px] text-white font-medium">{headerLocationLabel}</span>
                        </div>
                        <div className="w-[32px] h-[32px] rounded-full overflow-hidden bg-white/14 border border-white/20 flex items-center justify-center">
                            {userData?.profilePhotoUrl ? (
                                <img src={userData.profilePhotoUrl} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-[12px] font-bold text-white/90">{userData?.name?.charAt(0) || currentUser?.email?.charAt(0).toUpperCase() || 'R'}</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="px-[16px] pb-[120px]">
                    {/* ðŸ§± BREADCRUMB TEXT */}
                    {/* ðŸ–¼ IMAGE CAROUSEL SECTION */}
                    <div className="rfm-pg-gallery relative -mx-[16px] w-[calc(100%+32px)] overflow-hidden">
                        <ImageGallery
                            images={[
                                ...(property.images || []),
                                ...rooms.flatMap(r => r.images || [])
                            ].slice(0, 4)}
                            title={property.title}
                            offer={property.autoOffer}
                        />
                    </div>

                    {/* ðŸ  PROPERTY TITLE SECTION */}
                    <div className="rfm-pg-titlebar relative z-10 mt-3 rounded-[24px] border border-white/80 bg-white px-5 pb-5 pt-4 shadow-[0_18px_36px_rgba(15,23,42,0.09)]">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-500">Verified Property</p>
                                <h1 className="rfm-pg-title-single-line mt-2 text-[24px] font-black leading-[1.05] tracking-tight text-slate-950" title={property.title}>{property.title}</h1>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <RatingStars
                                        rating={ratingSummary.avgRating}
                                        starClassName="h-4 w-4"
                                        filledClassName="text-[#FF7A00]"
                                        emptyClassName="text-gray-300"
                                    />
                                    <span className="text-[12px] font-black text-[#FF7A00]">
                                        {ratingSummary.summaryText}
                                    </span>
                                </div>
                                <div className="mt-3 flex items-center gap-2 text-slate-500">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-600 shadow-sm">
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </span>
                                    <span className="min-w-0 truncate text-[13px] font-bold text-slate-600">{property.address.text || property.city}</span>
                                </div>
                            </div>
                            <button
                                onClick={handleShare}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all active:scale-95"
                            >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* ðŸ’° PRICE SECTION */}
                    <div className="rfm-pg-price mt-4 rounded-[24px] border border-slate-100 bg-[linear-gradient(135deg,#FFF7ED_0%,#FFFFFF_45%,#EFF6FF_100%)] px-5 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-end gap-1.5">
                                <span className="text-[28px] font-black leading-none tracking-tight text-slate-950">{formatCurrency(property.pricePerMonth)}</span>
                                <span className="pb-0.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">/month</span>
                            </div>
                            <div className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] shadow-sm ${vacancyStatusUi.className}`}>
                                {vacancyStatusUi.label}
                            </div>
                        </div>
                    </div>

                    {/* ðŸ§­ MOBILE STICKY TABS */}
                    <div className="rfm-pg-tabs sticky top-[56px] z-50 bg-white/95 backdrop-blur-md -mx-[16px] px-[16px] border-b border-gray-100 mb-6">
                        <div className="flex gap-6 overflow-x-auto no-scrollbar py-3">
                            {[
                                { id: 'overview', label: 'Overview' },
                                { id: 'rooms', label: 'Rooms' },
                                { id: 'amenities', label: 'Amenities' },
                                { id: 'food', label: 'Food Menu' },
                                { id: 'reviews', label: 'Reviews' },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as 'overview' | 'rooms' | 'amenities' | 'food' | 'nearby' | 'reviews' | 'owner')}
                                    className={`rfm-pg-tab whitespace-nowrap text-[14px] font-bold transition-all ${activeTab === tab.id ? 'text-orange-600' : 'text-gray-400'}`}
                                >
                                    {tab.label}
                                    {activeTab === tab.id && <div className="mt-1 h-[2px] bg-orange-600 rounded-full" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ðŸ“ TAB CONTENT AREA */}
                    <div className="space-y-8">
                        {activeTab === 'overview' && (
                            <div className="animate-fade-in-up space-y-8">
                                {/* ðŸ¨ QUICK INFO GRID */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-100/50">
                                        <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-1">Area</p>
                                        <p className="text-[14px] font-bold text-orange-900 truncate">{property.city || 'Madiwala'}</p>
                                    </div>
                                    <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100/50">
                                        <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-1 leading-none">Gender</p>
                                        <p className="text-[14px] font-bold text-purple-900 leading-none">{property.tags.includes('Girls') ? 'Girls Only' : property.tags.includes('Boys') ? 'Boys Only' : 'Unisex'}</p>
                                    </div>
                                </div>

                                {/* ðŸ“ ABOUT SECTION */}
                                <div className="space-y-3">
                                    <h3 className="text-[18px] font-black text-gray-900 tracking-tight">About this place</h3>
                                    <p className="text-[14px] text-gray-600 leading-relaxed italic">
                                        "{property.description || 'Welcome to our premium living space designed for comfort and community.'}"
                                    </p>
                                </div>

                                {/* âœ¨ TOP AMENITIES PREVIEW */}
                                <div className="space-y-4">
                                    <h3 className="text-[18px] font-black text-gray-900 tracking-tight">What's included</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {Object.entries(property.features || {}).filter(([, v]) => v).slice(0, 4).map(([key]) => (
                                            <div key={key} className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-xl border border-gray-100">
                                                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-orange-500 shadow-sm">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M5 13l4 4L19 7" /></svg>
                                                </div>
                                                <span className="text-[12px] font-bold text-gray-700 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => setActiveTab('amenities')} className="w-full py-3 border border-gray-200 rounded-xl text-[12px] font-black text-gray-900 uppercase tracking-widest active:bg-gray-50">Show All Amenities</button>
                                </div>

                                {/* ðŸ“ LOCATION PREVIEW */}
                                <div className="p-5 bg-gray-900 rounded-[28px] shadow-xl shadow-gray-200 text-white overflow-hidden relative group active:scale-[0.98] transition-all" onClick={handleOpenMap}>
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
                                    <div className="relative z-10">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                                                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                            </div>
                                            <p className="text-[14px] font-bold">Location & Map</p>
                                        </div>
                                        <p className="text-[12px] text-white/70 mb-4 line-clamp-2">{property.address.text}</p>
                                        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-orange-400">
                                            Open in Google Maps
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'rooms' && (
                            <div ref={roomsRef} className="animate-fade-in-up">
                                <h3 className="text-[18px] font-bold text-gray-900 mb-[16px]">Available Rooms</h3>
                                <div className="grid grid-cols-2 gap-[12px]">
                                    {rooms.map(room => {
                                        const isHighlighted = highlightedRoomId === String(room.roomId);

                                        return (
                                        <div
                                            key={room.roomId}
                                            className={`bg-white border rounded-[20px] overflow-hidden shadow-sm flex flex-col h-full transition-all duration-300 ${
                                                isHighlighted
                                                    ? 'border-orange-400 shadow-[0_0_0_3px_rgba(251,146,60,0.18),0_14px_30px_rgba(249,115,22,0.12)]'
                                                    : 'border-gray-100'
                                            }`}
                                        >
                                            <div className="relative h-[110px] shrink-0 group/img cursor-pointer" onClick={() => handleBookRoom(room)}>
                                                <img src={room.images?.[0] || 'https://placehold.co/400x400?text=Room'} className="w-full h-full object-cover" alt="" />
                                                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded-md text-[8px] font-black text-white uppercase tracking-wider">{room.type}</div>
                                                <div className="absolute top-2 right-2 bg-white/90 px-1.5 py-0.5 rounded-md text-[9px] font-black text-orange-600 uppercase">NO. {room.roomNumber}</div>

                                                {room.images?.length > 1 && (
                                                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-100 group-hover/img:bg-black/40 transition-all">
                                                        <div className="bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg flex items-center gap-1 shadow-lg">
                                                            <svg className="w-3 h-3 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                                                            <span className="text-[9px] font-black text-gray-900 uppercase">View {room.images.length}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-3 flex flex-col flex-1">
                                                <div className="mb-2">
                                                    <h4 className="text-[13px] font-bold text-gray-900 leading-tight mb-0.5">{room.type} Sharing</h4>
                                                    <span className="text-[15px] font-black text-orange-600">{formatCurrency(room.price)}</span>
                                                </div>
                                                <div className="flex flex-col gap-1 mb-3 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${room.availableCount > 0 ? 'bg-blue-500' : 'bg-red-500'}`} />
                                                        <span className="text-[10px] font-medium text-gray-600 line-clamp-1">{getVacancySummary(room.availableCount).label}</span>
                                                    </div>
                                                    <span className="text-[10px] text-gray-400 font-medium line-clamp-1">{room.capacity} Total</span>
                                                </div>
                                                <button
                                                    onClick={() => handleBookRoom(room)}
                                                    disabled={room.availableCount === 0}
                                                    className={`w-full h-[38px] rounded-lg text-[11px] font-bold uppercase transition-all shrink-0 ${room.availableCount > 0 ? 'bg-gray-900 text-white active:scale-95' : 'bg-gray-100 text-gray-400'}`}
                                                >
                                                    {room.availableCount > 0 ? 'Select' : 'Sold'}
                                                </button>
                                            </div>
                                        </div>
                                    )})}
                                </div>
                            </div>
                        )}

                        {activeTab === 'amenities' && (
                            <div className="animate-fade-in-up">
                                <h3 className="text-[18px] font-bold text-gray-900 mb-4">What this place offers</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {Object.entries(property.features || {}).map(([key, val]) => val && (
                                        <div key={key} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl">
                                            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-orange-600 shadow-sm">
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            </div>
                                            <span className="text-[13px] font-bold text-gray-700 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'reviews' && (
                            <div className="animate-fade-in-up space-y-5">
                                <div className="rounded-[28px] border border-orange-100 bg-[linear-gradient(135deg,#FFF7ED_0%,#FFFFFF_52%,#EFF6FF_100%)] p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-500">Guest Rating</p>
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <RatingStars
                                                    rating={ratingSummary.avgRating}
                                                    starClassName="h-5 w-5"
                                                    filledClassName="text-[#FF7A00]"
                                                    emptyClassName="text-gray-300"
                                                />
                                                <span className="text-[14px] font-black text-[#FF7A00]">{ratingSummary.summaryText}</span>
                                            </div>
                                        </div>

                                        {currentUser ? (
                                            <button
                                                onClick={() => {
                                                    if (!ratingContext.canRate || !ratingContext.bookingId) {
                                                        toast.error('Complete your stay to rate this PG.');
                                                        return;
                                                    }
                                                    setShowRatingModal(true);
                                                }}
                                                className="rounded-full bg-[#FF7A00] px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white shadow-[0_12px_24px_rgba(255,122,0,0.22)]"
                                            >
                                                {reviewActionLabel}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => navigate('/login')}
                                                className="rounded-full border border-orange-200 px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-orange-600"
                                            >
                                                Login To Rate
                                            </button>
                                        )}
                                    </div>

                                    {!currentUser && (
                                        <p className="mt-4 text-[12px] font-medium text-slate-500">Login and complete your stay to add a review.</p>
                                    )}

                                    {currentUser && !ratingContext.canRate && !ratingContext.existingRating && (
                                        <p className="mt-4 text-[12px] font-medium text-slate-500">Ratings open after a completed stay for this PG.</p>
                                    )}
                                </div>

                                {reviewsLoading ? (
                                    <div className="space-y-3">
                                        {[1, 2, 3].map((item) => (
                                            <div key={item} className="h-24 animate-pulse rounded-[22px] bg-gray-100" />
                                        ))}
                                    </div>
                                ) : reviews.length > 0 ? (
                                    <div className="space-y-3">
                                        {reviews.map((entry) => (
                                            <div key={entry.id} className="rounded-[24px] border border-gray-100 bg-white p-4 shadow-sm">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-[13px] font-black text-slate-900">{entry.reviewerName}</p>
                                                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                                            {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <RatingStars
                                                            rating={entry.rating}
                                                            starClassName="h-4 w-4"
                                                            filledClassName="text-[#FF7A00]"
                                                            emptyClassName="text-gray-300"
                                                        />
                                                        <p className="mt-1 text-[11px] font-black text-[#FF7A00]">{entry.rating.toFixed(1)}</p>
                                                    </div>
                                                </div>
                                                <p className="mt-3 text-[13px] leading-6 text-slate-600">
                                                    {entry.review || 'Rated this PG without a written review.'}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="rounded-[28px] border border-dashed border-gray-200 bg-gray-50/60 px-5 py-10 text-center">
                                        <p className="text-[14px] font-bold text-slate-500">No ratings yet</p>
                                        <p className="mt-2 text-[12px] text-slate-400">Be the first guest to review this PG.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'food' && (
                            <div className="animate-fade-in-up">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-[20px] font-black text-gray-900 tracking-tight">Menu Schedule</h3>
                                    <button
                                        onClick={handleToggleMenuUpdates}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all text-[11px] font-bold uppercase tracking-wider ${menuUpdatesEnabled ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm shadow-blue-100' : 'bg-white border-gray-200 text-gray-400 hover:border-orange-400 hover:text-orange-500'}`}
                                    >
                                        <div className={`w-1.5 h-1.5 rounded-full ${menuUpdatesEnabled ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
                                        {menuUpdatesEnabled ? 'Subscribed' : 'Get Updates'}
                                    </button>
                                </div>

                                {foodMenu.length > 0 ? (
                                    <div className="space-y-4">
                                        {foodMenu.map((menu) => {
                                            const isToday = new Date().toLocaleDateString('en-US', { weekday: 'long' }) === menu.dayOfWeek;
                                            return (
                                                <div key={menu.dayOfWeek} className={`relative overflow-hidden group bg-white border border-gray-100 rounded-[24px] shadow-sm transition-all duration-300 ${isToday ? 'border-orange-200 ring-2 ring-orange-50/50' : ''}`}>
                                                    {isToday && (
                                                        <div className="absolute top-0 right-0">
                                                            <div className="bg-orange-500 text-white text-[9px] font-black px-4 py-1 rounded-bl-xl uppercase tracking-widest shadow-sm">Today</div>
                                                        </div>
                                                    )}

                                                    <div className="p-5 flex flex-col gap-4">
                                                        <div className="flex items-center">
                                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black transition-colors ${isToday ? 'bg-orange-100 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                                                                {menu.dayOfWeek.substring(0, 3)}
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 gap-2.5">
                                                            {/* Breakfast */}
                                                            <div className="flex items-center gap-3 p-2.5 bg-gray-50/50 rounded-[14px] group-hover:bg-gray-50 transition-colors">
                                                                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Breakfast</p>
                                                                    <p className="text-[13px] font-bold text-gray-800 truncate">{menu.breakfast}</p>
                                                                </div>
                                                            </div>

                                                            {/* Lunch */}
                                                            <div className="flex items-center gap-3 p-2.5 bg-gray-50/50 rounded-[14px] group-hover:bg-gray-50 transition-colors">
                                                                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M10 14L21 3M10 10l5.5 5.5" /></svg>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Lunch</p>
                                                                    <p className="text-[13px] font-bold text-gray-800 truncate">{menu.lunch}</p>
                                                                </div>
                                                            </div>

                                                            {/* Dinner */}
                                                            <div className="flex items-center gap-3 p-2.5 bg-gray-50/50 rounded-[14px] group-hover:bg-gray-50 transition-colors">
                                                                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Dinner</p>
                                                                    <p className="text-[13px] font-bold text-gray-800 truncate">{menu.dinner}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center p-12 bg-gray-50/50 rounded-[32px] border border-dashed border-gray-200">
                                        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-4">
                                            <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        </div>
                                        <p className="text-[14px] font-bold text-gray-400 uppercase tracking-widest">No Menu Available</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {/* LAPTOP / DESKTOP VIEW (md:block) */}
            <div className="hidden md:block min-h-screen pb-20 md:pb-12 bg-[radial-gradient(circle_at_top,_rgba(254,215,170,0.4),_transparent_26%),linear-gradient(180deg,#ffffff_0%,#f9fafb_100%)]">
                <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-2 md:pt-4 pb-6">

                    {/* 2. Main Gallery Section */}
                    <div className="mb-3 md:mb-10">
                        <ImageGallery
                            images={[
                                ...(property.images || []),
                                ...rooms.flatMap(r => r.images || [])
                            ].slice(0, 4)}
                            title={property.title}
                            offer={property.autoOffer}
                        />
                    </div>

                    {/* 3. Two-Column Layout */}
                    <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-12 relative">

                        {/* LEFT COLUMN: Main Content */}
                        <div className="min-w-0 space-y-10">

                            {/* Title Header */}
                            <div className="border-b border-gray-200/60 pb-6 md:pb-10">
                                <div className="flex flex-col gap-5">
                                    {/* Badges Row */}
                                    <div className="flex items-center flex-wrap gap-2.5">
                                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-orange-50 text-orange-700 text-[10px] font-bold uppercase tracking-wider border border-orange-100 shadow-sm">
                                            PG
                                        </span>
                                        {property.autoOffer && (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-md shadow-orange-500/20 animate-pulse">
                                                {property.autoOffer.code}: {property.autoOffer.type === 'percentage' ? `${property.autoOffer.value}%` : formatCurrency(property.autoOffer.value)} OFF
                                            </span>
                                        )}
                                    </div>

                                    {/* Title and Actions Row */}
                                    <div className="flex justify-between items-start gap-4">
                                        <h1 className="rfm-pg-title-single-line min-w-0 flex-1 text-2xl md:text-5xl font-black text-gray-900 tracking-tight leading-tight" title={property.title}>
                                            {property.title}
                                        </h1>
                                        <div className="flex gap-2.5 shrink-0">
                                            <button
                                                onClick={handleShare}
                                                className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white border border-gray-100 text-gray-600 hover:text-orange-600 hover:border-orange-200 hover:shadow-lg transition-all group active:scale-90"
                                                title="Share"
                                            >
                                                <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                                            </button>

                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3">
                                        <RatingStars
                                            rating={ratingSummary.avgRating}
                                            starClassName="h-5 w-5"
                                            filledClassName="text-[#FF7A00]"
                                            emptyClassName="text-gray-300"
                                        />
                                        <span className="text-sm font-black uppercase tracking-[0.08em] text-[#FF7A00]">
                                            {ratingSummary.summaryText}
                                        </span>
                                    </div>

                                    {/* Location and Info Row */}
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center shrink-0 border border-orange-100">
                                            <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                        </div>
                                        <div className="flex flex-col gap-3">
                                            <span className="text-gray-800 font-bold text-lg md:text-xl leading-tight">
                                                {property.address.text}
                                            </span>
                                            <div className="flex items-center flex-wrap gap-4">
                                                {property.distance !== undefined && (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-600 text-white text-xs font-black shadow-sm shadow-orange-500/20">
                                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        </svg>
                                                        {property.distance} km away
                                                    </span>
                                                )}
                                                <button
                                                    onClick={handleOpenMap}
                                                    className="text-orange-600 hover:text-orange-700 font-black text-xs uppercase tracking-widest flex items-center gap-1.5 hover:underline decoration-2"
                                                >
                                                    Show on map
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Sticky Tabs */}
                            <div className="sticky top-[56px] md:top-[76px] z-10 bg-white/80 backdrop-blur-xl border-b border-gray-100 -mx-4 px-4 md:mx-0 md:px-0 md:rounded-xl shadow-sm">
                                <div className="flex gap-8 overflow-x-auto no-scrollbar pb-1 pt-1 md:px-4">
                                    {[
                                        { id: 'overview', label: 'Overview' },
                                        { id: 'rooms', label: 'Rooms' },
                                        { id: 'amenities', label: 'Amenities' },
                                        { id: 'food', label: 'Food Menu' },
                                        { id: 'reviews', label: 'Reviews' },
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id as 'overview' | 'amenities' | 'reviews')}
                                            className={`whitespace-nowrap py-4 text-sm font-bold border-b-2 transition-all ${activeTab === tab.id
                                                ? 'border-orange-600 text-orange-600'
                                                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
                                                }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Overview Content */}
                            <div className="space-y-12 animate-fade-in-up">
                                {activeTab === 'overview' && (
                                    <>
                                        <div className="prose prose-lg max-w-none text-gray-600">
                                            <h3 className="text-2xl font-bold text-gray-900 mb-4">About this place</h3>
                                            <p className="leading-relaxed whitespace-pre-line">{property.description}</p>
                                        </div>

                                        {/* Highlights */}
                                        <div className="bg-gradient-to-br from-orange-50 to-blue-50 rounded-3xl p-8 border border-orange-100">
                                            <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                                                <span className="p-2 bg-orange-100 text-orange-600 rounded-lg">
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                                </span>
                                                Property Highlights
                                            </h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                {Object.entries(property.features || {}).filter(([, v]) => v).slice(0, 4).map(([key]) => (
                                                    <div key={key} className="flex items-center gap-3">
                                                        <div className="w-2 h-2 rounded-full bg-orange-500 shadow-sm shadow-orange-500/50"></div>
                                                        <span className="capitalize font-medium text-gray-700">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Real-time Offers */}
                                        {offers.length > 0 && (
                                            <div className="space-y-4">
                                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                                    <span className="p-2 bg-orange-100 text-orange-600 rounded-lg">
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>
                                                    </span>
                                                    Available Offers
                                                </h3>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    {offers.map(offer => (
                                                        <div key={offer.offerId} className="relative overflow-hidden bg-gradient-to-br from-orange-50 to-white p-5 rounded-2xl border border-orange-100 shadow-sm group">
                                                            <div className="absolute top-0 right-0 w-20 h-20 bg-orange-200/20 rounded-full -mr-10 -mt-10 group-hover:scale-110 transition-transform"></div>
                                                            <div className="relative">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <span className="text-lg font-black text-orange-600">{offer.type === 'percentage' ? `${offer.value}% OFF` : `${formatCurrency(offer.value)} OFF`}</span>
                                                                    <span className="px-2 py-1 bg-white border border-orange-200 rounded text-[10px] font-bold text-orange-500 uppercase">{offer.code}</span>
                                                                </div>
                                                                <p className="text-sm font-medium text-gray-600 mb-1">Max discount: {formatCurrency(offer.maxDiscount)}</p>
                                                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Min Booking: {formatCurrency(offer.minBookingAmount)}</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Amenities (Overview or Tab) */}
                                {(activeTab === 'overview' || activeTab === 'amenities') && (
                                    <div>
                                        <h3 className="text-2xl font-bold text-gray-900 mb-6">What this place offers</h3>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                            {Object.entries(property.features || {}).map(([key, value]) => (
                                                value && (
                                                    <div key={key} className="flex items-center gap-4 p-5 rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md hover:border-orange-100 transition-all group">
                                                        <div className="w-10 h-10 rounded-xl bg-gray-50 group-hover:bg-orange-50 flex items-center justify-center text-gray-500 group-hover:text-orange-600 transition-colors">
                                                            {/* Simple generic icon for now */}
                                                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                        </div>
                                                        <span className="font-bold text-gray-700 capitalize text-sm">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                                    </div>
                                                )
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Rooms */}
                                {(activeTab === 'overview' || activeTab === 'rooms') && (
                                    <div ref={roomsRef}>
                                        <h3 className="text-2xl font-bold text-gray-900 mb-6">Available Rooms</h3>
                                        <div className="space-y-4 md:space-y-6">
                                            {rooms.map((room) => {
                                                const isAvailable = room.status === 'available' && room.availableCount > 0;
                                                const isHighlighted = highlightedRoomId === String(room.roomId);
                                                const roomTypeLabel = room.type === 'Single' ? 'Single Room' :
                                                    room.type === 'Double' ? 'Double Sharing' :
                                                        room.type === 'Triple' ? 'Triple Sharing' :
                                                            room.type === 'Shared' ? 'Shared Room' :
                                                                room.type === 'Dorm' ? 'Dormitory' :
                                                                    `${room.type} Room`;

                                                return (
                                                    <div key={room.roomId} className={`
                                                    group relative bg-white border rounded-[24px] overflow-hidden transition-all duration-300
                                                    ${isHighlighted
                                                            ? 'border-orange-400 shadow-[0_0_0_3px_rgba(251,146,60,0.18),0_18px_38px_rgba(249,115,22,0.12)]'
                                                            : isAvailable
                                                                ? 'border-gray-100 hover:border-orange-200 hover:shadow-xl hover:shadow-orange-900/5'
                                                            : 'border-gray-100 opacity-75 grayscale-[0.5]'}
                                                `}>
                                                        <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-gray-100 font-sans">
                                                            {/* 1. Room Image */}
                                                            <div className="relative w-full sm:w-48 h-40 sm:h-auto overflow-hidden shrink-0">
                                                                <img
                                                                    src={room.images?.[0] || 'https://placehold.co/400x400?text=Room'}
                                                                    alt={room.type}
                                                                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                                                />
                                                                {!isAvailable && (
                                                                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
                                                                        <span className="bg-red-500 text-white font-black px-4 py-1.5 rounded-full text-[10px] uppercase tracking-widest shadow-lg">Sold Out</span>
                                                                    </div>
                                                                )}
                                                                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-lg shadow-sm border border-white/40">
                                                                    <span className="text-[10px] font-black text-orange-600 uppercase tracking-wider">No. {room.roomNumber}</span>
                                                                </div>
                                                            </div>

                                                            {/* 2. Room Content */}
                                                            <div className="flex-1 p-5 md:p-6 flex flex-col gap-4">
                                                                <div>
                                                                    <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-1 md:gap-4 mb-3">
                                                                        <h4 className="text-xl font-black text-gray-900 tracking-tight">{roomTypeLabel}</h4>
                                                                        <div className="flex items-baseline gap-1.5">
                                                                            <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-700 to-blue-700 leading-none">{formatCurrency(room.price)}</span>
                                                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">/ Month</span>
                                                                        </div>
                                                                    </div>

                                                                    {/* Room Metadata */}
                                                                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
                                                                        <div className="flex items-center gap-3 text-gray-700">
                                                                            <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-orange-600 border border-orange-100">
                                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2m12-11a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                                                                            </div>
                                                                            <span className="text-sm font-black tracking-tight">{room.capacity} Sharing</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-3">
                                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${isAvailable ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                                                            </div>
                                                                            <span className={`text-sm font-black tracking-tight ${isAvailable ? 'text-blue-600' : 'text-red-500'}`}>{room.availableCount} Beds Available</span>
                                                                        </div>
                                                                    </div>

                                                                    {/* Amenities */}
                                                                    {room.amenities && room.amenities.length > 0 && (
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {room.amenities?.slice(0, 4).map(am => (
                                                                                <span key={am} className="text-[9px] font-black bg-gray-50 text-gray-400 px-3 py-1.5 rounded-lg border border-gray-100 uppercase tracking-widest">{am}</span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* Action Button */}
                                                                <div className="mt-2 md:mt-4">
                                                                    <button
                                                                        onClick={() => handleBookRoom(room)}
                                                                        disabled={!isAvailable}
                                                                        className={`
                                                                        w-full md:w-auto px-12 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95
                                                                        ${isAvailable
                                                                                ? 'bg-gray-900 text-white hover:bg-black hover:shadow-gray-200'
                                                                                : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'}
                                                                    `}
                                                                    >
                                                                        {isAvailable ? 'Select Room' : 'Sold Out'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {(activeTab === 'overview' || activeTab === 'reviews') && (
                                    <div>
                                        <div className="mb-6 flex items-center justify-between gap-4">
                                            <div>
                                                <h3 className="text-2xl font-bold text-gray-900">Guest Reviews</h3>
                                                <p className="mt-2 text-sm font-medium text-gray-500">
                                                    {ratingSummary.hasRatings ? 'Verified guest feedback updates live across your listing.' : 'This property is waiting for its first guest review.'}
                                                </p>
                                            </div>

                                            {currentUser ? (
                                                <button
                                                    onClick={() => {
                                                        if (!ratingContext.canRate || !ratingContext.bookingId) {
                                                            toast.error('Complete your stay to rate this PG.');
                                                            return;
                                                        }
                                                        setShowRatingModal(true);
                                                    }}
                                                    className="inline-flex items-center justify-center rounded-full bg-[#FF7A00] px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_14px_28px_rgba(255,122,0,0.22)]"
                                                >
                                                    {reviewActionLabel}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => navigate('/login')}
                                                    className="inline-flex items-center justify-center rounded-full border border-orange-200 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-600"
                                                >
                                                    Login To Rate
                                                </button>
                                            )}
                                        </div>

                                        <div className="rounded-[28px] border border-orange-100 bg-[linear-gradient(135deg,#FFF7ED_0%,#FFFFFF_48%,#EFF6FF_100%)] p-6 shadow-[0_18px_36px_rgba(15,23,42,0.05)]">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <RatingStars
                                                    rating={ratingSummary.avgRating}
                                                    starClassName="h-6 w-6"
                                                    filledClassName="text-[#FF7A00]"
                                                    emptyClassName="text-gray-300"
                                                />
                                                <span className="text-lg font-black text-[#FF7A00]">{ratingSummary.summaryText}</span>
                                            </div>
                                            {currentUser && !ratingContext.canRate && !ratingContext.existingRating && (
                                                <p className="mt-4 text-sm font-medium text-slate-500">Ratings become available after a completed stay.</p>
                                            )}
                                        </div>

                                        <div className="mt-6 space-y-4">
                                            {reviewsLoading ? (
                                                [1, 2, 3].map((item) => (
                                                    <div key={item} className="h-28 animate-pulse rounded-[24px] bg-gray-100" />
                                                ))
                                            ) : reviews.length > 0 ? (
                                                reviews.map((entry) => (
                                                    <div key={entry.id} className="rounded-[24px] border border-gray-100 bg-white p-6 shadow-sm">
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div>
                                                                <p className="text-base font-black text-gray-900">{entry.reviewerName}</p>
                                                                <p className="mt-1 text-[11px] font-black uppercase tracking-[0.14em] text-gray-400">
                                                                    {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <RatingStars
                                                                    rating={entry.rating}
                                                                    starClassName="h-4 w-4"
                                                                    filledClassName="text-[#FF7A00]"
                                                                    emptyClassName="text-gray-300"
                                                                />
                                                                <p className="mt-1 text-sm font-black text-[#FF7A00]">{entry.rating.toFixed(1)}</p>
                                                            </div>
                                                        </div>
                                                        <p className="mt-4 text-sm leading-7 text-gray-600">
                                                            {entry.review || 'Rated this PG without a written review.'}
                                                        </p>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="rounded-[24px] border border-dashed border-gray-200 bg-white px-6 py-14 text-center text-gray-500">
                                                    <p className="text-lg font-bold text-gray-700">No ratings yet</p>
                                                    <p className="mt-2 text-sm">Be the first guest to review this PG.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Food Menu (Tab Only) */}
                                {activeTab === 'food' && (
                                    <div>
                                        {/* Re-implement food menu table with new styling */}
                                        <div className="flex items-center justify-between mb-6">
                                            <h3 className="text-2xl font-bold text-gray-900">Weekly Menu</h3>
                                            <label htmlFor="property-menu-updates" className="flex items-center gap-3 cursor-pointer group select-none bg-white border border-gray-200 px-4 py-2 rounded-full hover:border-gray-300 transition-all shadow-sm">
                                                <span className={`text-sm font-bold transition-colors ${menuUpdatesEnabled ? 'text-blue-700' : 'text-gray-500 group-hover:text-gray-700'}`}>
                                                    {menuUpdatesEnabled ? 'Updates On' : 'Get Updates'}
                                                </span>
                                                <div className="relative">
                                                    <input
                                                        id="property-menu-updates"
                                                        name="menuUpdates"
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={menuUpdatesEnabled}
                                                        onChange={handleToggleMenuUpdates}
                                                    />
                                                    <div className={`w-9 h-5 rounded-full transition-colors duration-300 ${menuUpdatesEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${menuUpdatesEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>
                                        </div>
                                        {foodMenu.length > 0 ? (
                                            <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-lg shadow-gray-100 bg-white">
                                                <div className="overflow-x-auto no-scrollbar">
                                                    <table className="w-full text-sm min-w-[500px] md:min-w-full">
                                                        <thead className="bg-gray-50 text-gray-900 font-bold border-b border-gray-200">
                                                            <tr>
                                                                <th className="px-3 md:px-6 py-4 text-left uppercase text-xs tracking-wider">Day</th>
                                                                <th className="px-3 md:px-6 py-4 text-left uppercase text-xs tracking-wider">Breakfast</th>
                                                                <th className="px-3 md:px-6 py-4 text-left uppercase text-xs tracking-wider">Lunch</th>
                                                                <th className="px-3 md:px-6 py-4 text-left uppercase text-xs tracking-wider">Dinner</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100 bg-white">
                                                            {foodMenu.map(menu => (
                                                                <tr key={menu.dayOfWeek} className="hover:bg-orange-50/50 transition-colors">
                                                                    <td className="px-3 md:px-6 py-5 font-bold text-gray-900">{menu.dayOfWeek}</td>
                                                                    <td className="px-3 md:px-6 py-5 text-gray-600 font-medium">{menu.breakfast}</td>
                                                                    <td className="px-3 md:px-6 py-5 text-gray-600 font-medium">{menu.lunch}</td>
                                                                    <td className="px-3 md:px-6 py-5 text-gray-600 font-medium">{menu.dinner}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                {/* Scroll Hint for Mobile */}
                                                <div className="md:hidden bg-gray-50/50 px-4 py-2 border-t border-gray-100 flex items-center justify-center gap-2">
                                                    <svg className="w-4 h-4 text-gray-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                                    </svg>
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Swipe for more</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-500">
                                                <p className="font-medium">Menu not available for this property.</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>
                        </div>

                        {/* RIGHT COLUMN: Sticky Sidebar */}
                        <div className="relative hidden lg:block">
                            <div className="sticky top-28 glass-panel rounded-[32px] p-8 shadow-2xl shadow-orange-900/10 border border-white/60 backdrop-blur-xl">
                                <div className="mb-8 pb-8 border-b border-gray-200/60">
                                    <div className="flex items-baseline gap-2 mb-2">
                                        <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-700 to-blue-700 tracking-tight">{formatCurrency(property.pricePerMonth)}</span>
                                        <span className="text-gray-500 font-bold text-xl">/mo</span>
                                    </div>
                                    <p className="text-gray-500 text-sm font-medium">Prices vary by room type</p>
                                </div>

                                <div className="space-y-6">
                                    <div className="p-5 bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-100 flex items-center justify-between shadow-sm">
                                        <span className="font-bold text-gray-700">Availability</span>
                                        <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm ${totalVacancies > 0 ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
                                            <div className={`w-2 h-2 rounded-full ${totalVacancies > 0 ? 'bg-blue-500 animate-pulse' : 'bg-red-500'}`} />
                                            {totalVacancies > 0 ? `${totalVacancies} Left` : 'Full'}
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleReserveNow}
                                        disabled={totalVacancies === 0}
                                        className="w-full py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-2xl shadow-xl shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                                    >
                                        {totalVacancies > 0 ? (retryBookingCtaActive ? 'Retry Booking' : 'Reserve a Room') : 'Join Waitlist'}
                                    </button>

                                    <button
                                        onClick={handleContactOwner}
                                        className="w-full py-4 bg-white border border-gray-200 text-gray-900 font-bold rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm hover:shadow-md active:scale-95"
                                    >
                                        Contact Host
                                    </button>
                                </div>

                                {owner && (
                                    <div className="mt-8 pt-6 border-t border-gray-200/60 flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-100 to-blue-100 flex items-center justify-center text-orange-700 font-bold text-lg border border-orange-50 shadow-sm">
                                            {owner.name?.charAt(0) || 'H'}
                                        </div>
                                        <div>
                                            <p className="text-base font-bold text-gray-900 capitalize">Hosted by {owner.name}</p>
                                            <p className="text-xs font-bold text-orange-600 uppercase tracking-wider mt-0.5">{owner.verified ? 'Verified Host' : 'Member'}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* ðŸ“ GLOBAL MODALS (Visible on Mobile & Desktop) */}
            {showBookingModal && property && (
                <BookingModalFull
                    property={property}
                    selectedRoom={selectedRoom || undefined}
                    onClose={() => setShowBookingModal(false)}

                />
            )}

            {showRatingModal && property && ratingContext.bookingId && currentUser && (
                <RatingPopup
                    bookingId={ratingContext.bookingId}
                    propertyId={property.propertyId}
                    propertyName={property.title}
                    userId={currentUser.id}
                    ratingType="checkout"
                    title={ratingContext.existingRating ? 'Update Your Review' : 'Rate Your Stay'}
                    showReviewField={true}
                    initialRating={ratingContext.existingRating?.rating || 0}
                    initialReview={ratingContext.existingRating?.review || ''}
                    onClose={() => setShowRatingModal(false)}
                    onSuccess={handleRatingSuccess}
                />
            )}

            <PaymentErrorOverlay
                open={showPaymentFailure}
                title="Payment Failed"
                message={paymentFailureMessage}
                onClose={() => {
                    setDismissedPaymentFailureKey(paymentFailureFromQuery?.key || null);
                    clearPaymentFailureParams();
                }}
                onGoBookings={() => {
                    setDismissedPaymentFailureKey(paymentFailureFromQuery?.key || null);
                    clearPaymentFailureParams();
                    navigate('/bookings');
                }}
                onViewDetails={() => {
                    setDismissedPaymentFailureKey(paymentFailureFromQuery?.key || null);
                    clearPaymentFailureParams();
                    setSelectedRoom(null);
                    setShowBookingModal(true);
                }}
                viewDetailsLabel="Start Fresh Payment"
            />

            {/* Mobile Bottom Bar (Sticky) */}
            <div className="rfm-pg-cta-bar fixed bottom-0 left-0 right-0 px-6 py-4 bg-white/95 backdrop-blur-xl border-t border-gray-100 md:hidden z-[120] flex items-center justify-between gap-6 shadow-[0_-15px_40px_rgba(0,0,0,0.08)] safe-area-bottom">
                <div className="flex flex-col">
                    <div className="flex items-end gap-1">
                        <span className="text-2xl font-black text-gray-900 leading-none">{formatCurrency(property?.pricePerMonth)}</span>
                        <span className="pb-0.5 text-[10px] text-gray-500 font-bold uppercase tracking-[0.14em] leading-none">/month</span>
                    </div>
                </div>
                <button
                    onClick={handleReserveNow}
                    disabled={totalVacancies === 0}
                    className="rfm-pg-cta-btn flex-1 h-14 bg-gray-900 hover:bg-black text-white font-black rounded-2xl shadow-xl shadow-gray-200 active:scale-95 transition-all disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none uppercase tracking-widest text-sm"
                >
                    {totalVacancies > 0 ? (retryBookingCtaActive ? 'Retry Booking' : 'Reserve Now') : 'Sold Out'}
                </button>
            </div>
        </div>
    );
};

export default PropertyDetails;

