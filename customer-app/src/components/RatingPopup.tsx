import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { IoStar, IoStarOutline } from 'react-icons/io5';
import { ratingService, type UpsertPropertyRatingResult } from '../services/rating.service';
import type { RatingType } from '../types/rating.types';

interface RatingPopupProps {
    bookingId: string;
    propertyId: string;
    propertyName: string;
    userId?: string;
    ratingType?: RatingType;
    title?: string;
    actionLabel?: string;
    showReviewField?: boolean;
    initialRating?: number;
    initialReview?: string;
    onClose: () => void;
    onSuccess: (result: UpsertPropertyRatingResult) => void;
}

const RatingPopup: React.FC<RatingPopupProps> = ({
    bookingId,
    propertyId,
    propertyName,
    userId,
    ratingType = 'checkout',
    title,
    actionLabel,
    showReviewField = true,
    initialRating = 0,
    initialReview = '',
    onClose,
    onSuccess,
}) => {
    const [rating, setRating] = useState(initialRating);
    const [review, setReview] = useState(initialReview);
    const [loading, setLoading] = useState(false);
    const [bootstrapping, setBootstrapping] = useState(false);
    const [hasExistingReview, setHasExistingReview] = useState(initialRating > 0 || initialReview.trim().length > 0);

    useEffect(() => {
        setRating(initialRating);
        setReview(initialReview);
        setHasExistingReview(initialRating > 0 || initialReview.trim().length > 0);
    }, [initialRating, initialReview]);

    useEffect(() => {
        if (!userId || !bookingId || initialRating > 0 || initialReview.trim()) {
            return;
        }

        let alive = true;
        setBootstrapping(true);

        void ratingService.getUserBookingRating(userId, bookingId, ratingType)
            .then((existingRating) => {
                if (!alive || !existingRating) return;
                setRating(existingRating.rating);
                setReview(existingRating.review);
                setHasExistingReview(true);
            })
            .catch((error) => {
                console.error('Error loading existing booking rating:', error);
            })
            .finally(() => {
                if (alive) {
                    setBootstrapping(false);
                }
            });

        return () => {
            alive = false;
        };
    }, [bookingId, initialRating, initialReview, ratingType, userId]);

    const defaultHeadingLabel = hasExistingReview
        ? (ratingType === 'checkin' ? 'Update your Check-in Rating' : 'Update Your Review')
        : (ratingType === 'checkin' ? 'Rate your Check-in Experience' : 'Rate your Stay Experience');
    const resolvedHeadingLabel = title || defaultHeadingLabel;
    const resolvedActionLabel = actionLabel || (showReviewField
        ? (hasExistingReview ? 'Update Review' : 'Submit Review')
        : 'Submit Rating');
    const successLabel = hasExistingReview
        ? 'Your rating was updated.'
        : (ratingType === 'checkin'
            ? 'Thanks for rating your check-in experience!'
            : 'Thanks for rating your stay!');

    const handleSubmit = async () => {
        if (rating === 0) {
            toast.error('Please select a star rating');
            return;
        }

        if (!userId) {
            toast.error('Please login to submit your rating');
            return;
        }

        setLoading(true);
        try {
            const result = await ratingService.upsertPropertyRating({
                bookingId,
                propertyId,
                userId,
                type: ratingType,
                rating,
                review,
            });

            toast.success(successLabel, {
                style: {
                    borderRadius: '12px',
                    background: '#059669',
                    color: '#fff',
                    fontWeight: 'bold',
                },
            });

            onSuccess(result);
        } catch (error) {
            console.error('Error submitting rating:', error);
            toast.error('Failed to submit rating. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-md"
                />

                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    className="relative max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 text-center shadow-2xl sm:max-h-none sm:p-6"
                >
                    <div className="mb-6">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-orange-100 to-amber-100 text-[#FF7A00] shadow-inner">
                            <IoStar className="h-8 w-8" />
                        </div>
                        <h2 className="text-2xl font-black leading-tight text-gray-900">{resolvedHeadingLabel}</h2>
                        <p className="mt-1 text-sm font-medium text-gray-500">Share your experience for</p>
                        <p className="text-lg font-bold text-primary-600">{propertyName}</p>
                    </div>

                    <div className="mb-8">
                        <p className="mb-3 text-sm font-bold uppercase tracking-widest text-gray-400">How was the property?</p>
                        <div className="flex justify-center gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    onClick={() => setRating(star)}
                                    disabled={bootstrapping || loading}
                                    className="transform transition-transform hover:scale-110 active:scale-95 focus:outline-none disabled:cursor-not-allowed"
                                >
                                    {star <= rating ? (
                                        <IoStar className="text-3xl text-[#FF7A00] drop-shadow-sm" />
                                    ) : (
                                        <IoStarOutline className="text-3xl text-gray-300 hover:text-orange-200" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {showReviewField && (
                        <div className="mb-6">
                            <textarea
                                name="propertyReview"
                                value={review}
                                onChange={(e) => setReview(e.target.value)}
                                placeholder="Write a short review (optional)..."
                                className="h-24 w-full resize-none rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-medium outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                                disabled={bootstrapping || loading}
                            />
                        </div>
                    )}

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleSubmit}
                            disabled={bootstrapping || loading || rating === 0}
                            className="h-12 w-full rounded-2xl bg-gray-900 font-bold text-white shadow-xl shadow-gray-200 transition-all hover:bg-black active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {bootstrapping || loading ? 'Saving...' : resolvedActionLabel}
                        </button>
                        <button
                            onClick={onClose}
                            className="py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600"
                            disabled={loading}
                        >
                            Skip for now
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default RatingPopup;
