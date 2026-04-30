import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { bookingService } from '../../services/booking.service';
import { supabase } from '../../services/supabase-config';
import { deferRealtimeSubscription } from '../../services/realtime-subscription';
import RatingPopup from '../RatingPopup';
import { type Booking } from '../../types/booking.types';
import type { RatingType } from '../../types/rating.types';

const isRatingPopupBlockedRoute = (pathname: string): boolean =>
    String(pathname || '').trim().toLowerCase().startsWith('/payment');

const normalizeStatus = (status: string): string =>
    String(status || '').trim().toLowerCase().replace(/_/g, '-');

const isCheckInStatus = (status: string): boolean =>
    normalizeStatus(status) === 'checked-in';

const isCheckOutStatus = (status: string): boolean =>
    ['checked-out', 'completed'].includes(normalizeStatus(status));

type RatingPopupQueueItem = Booking & {
    ratingType: RatingType;
};

const BookingStatusListener: React.FC = () => {
    const { currentUser } = useAuth();
    const location = useLocation();
    const [popupQueue, setPopupQueue] = React.useState<RatingPopupQueueItem[]>([]);
    const prevStatuses = React.useRef<Record<string, string>>({});
    const didHydrateInitialSnapshot = React.useRef(false);
    const shownPopupKeys = React.useRef<Set<string>>(new Set());
    const ratingPopupBlocked = isRatingPopupBlockedRoute(location.pathname);
    const activeRatingPopup = ratingPopupBlocked ? null : popupQueue[0] || null;

    const getPopupKey = React.useCallback((bookingId: string, type: RatingType) =>
        `roomfindr-rating-popup-seen-${bookingId}-${type}`, []);

    const hasShownPopup = React.useCallback((bookingId: string, type: RatingType) => {
        const key = getPopupKey(bookingId, type);
        return shownPopupKeys.current.has(key) || localStorage.getItem(key) === 'true';
    }, [getPopupKey]);

    const markPopupShown = React.useCallback((bookingId: string, type: RatingType) => {
        const key = getPopupKey(bookingId, type);
        shownPopupKeys.current.add(key);
        localStorage.setItem(key, 'true');
    }, [getPopupKey]);

    const removeActivePopup = React.useCallback(() => {
        setPopupQueue((current) => current.slice(1));
    }, []);

    const enqueuePopup = React.useCallback((booking: Booking, ratingType: RatingType) => {
        if (hasShownPopup(booking.bookingId, ratingType)) {
            return;
        }

        markPopupShown(booking.bookingId, ratingType);
        setPopupQueue((current) => (
            current.some((item) => item.bookingId === booking.bookingId && item.ratingType === ratingType)
                ? current
                : [...current, { ...booking, ratingType }]
        ));
    }, [hasShownPopup, markPopupShown]);

    useEffect(() => {
        if (!currentUser) return;

        const unsubscribe = bookingService.subscribeToCustomerBookings(currentUser.id, async (bookings) => {
            const isInitialSnapshot = !didHydrateInitialSnapshot.current;

            for (const booking of bookings) {
                const prevStatus = normalizeStatus(prevStatuses.current[booking.bookingId] || '');
                const nextStatus = normalizeStatus(booking.status);

                if (
                    prevStatus
                    && prevStatus !== nextStatus
                    && ['approved', 'accepted', 'confirmed'].includes(nextStatus)
                ) {
                    toast.success(`Your booking for ${booking.propertyTitle || 'your property'} is approved.`, {
                        duration: 6000
                    });
                }

                if (
                    prevStatus
                    && prevStatus !== nextStatus
                    && isCheckInStatus(nextStatus)
                ) {
                    toast.success(`Checked into ${booking.propertyTitle || 'your property'}! Welcome home.`);
                }

                if (prevStatus && prevStatus !== nextStatus && nextStatus === 'rejected') {
                    toast.error(`Your booking request for ${booking.propertyTitle || 'your property'} was rejected by the owner.`, {
                        duration: 8000
                    });
                }

                if (!isInitialSnapshot && prevStatus !== nextStatus) {
                    if (isCheckInStatus(nextStatus) && !isCheckInStatus(prevStatus)) {
                        const alreadyRatedCheckIn = booking.checkinRatingSubmitted
                            ?? await bookingService.hasUserRatedBooking(booking.bookingId, 'checkin');

                        if (!alreadyRatedCheckIn) {
                            enqueuePopup(booking, 'checkin');
                        }
                    }

                    if (isCheckOutStatus(nextStatus) && !isCheckOutStatus(prevStatus)) {
                        const alreadyRatedCheckOut = booking.checkoutRatingSubmitted
                            ?? await bookingService.hasUserRatedBooking(booking.bookingId, 'checkout');

                        if (!alreadyRatedCheckOut) {
                            enqueuePopup(booking, 'checkout');
                        }
                    }
                }

                prevStatuses.current[booking.bookingId] = booking.status;
            }

            didHydrateInitialSnapshot.current = true;
        });

        const unsubscribePaymentRealtime = deferRealtimeSubscription(() => {
            const paymentChannel = supabase
                .channel(`payment-status-${currentUser.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'payments',
                        filter: `customer_id=eq.${currentUser.id}`
                    },
                    (payload) => {
                        const { new: newPayment, old: oldPayment } = payload;
                        const processedKey = `processed-payment-${newPayment.id}`;
                        if (sessionStorage.getItem(processedKey)) return;

                        const isNewCompletion = newPayment.status === 'completed'
                            && (!oldPayment || oldPayment.status !== 'completed');

                        if (isNewCompletion) {
                            sessionStorage.setItem(processedKey, 'true');
                            toast.success('Payment Successful!', {
                                duration: 5000,
                                position: 'bottom-center'
                            });
                        }
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(paymentChannel);
            };
        });

        return () => {
            unsubscribe();
            unsubscribePaymentRealtime();
        };
    }, [currentUser, enqueuePopup]);

    if (!activeRatingPopup) return null;

    return (
        <RatingPopup
            bookingId={activeRatingPopup.bookingId}
            propertyId={activeRatingPopup.propertyId}
            propertyName={activeRatingPopup.propertyTitle || 'Property'}
            userId={currentUser?.id}
            ratingType={activeRatingPopup.ratingType}
            title={activeRatingPopup.ratingType === 'checkin'
                ? 'Rate your Check-in Experience'
                : 'Rate your Stay Experience'}
            actionLabel="Submit Rating"
            showReviewField={false}
            onClose={removeActivePopup}
            onSuccess={removeActivePopup}
        />
    );
};

export default BookingStatusListener;
