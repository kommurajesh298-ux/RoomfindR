import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { bookingService } from '../services/booking.service';
import { notificationService } from '../services/notification.service';
import { paymentService } from '../services/payment.service';
import { offerService } from '../services/offer.service';
import { authService } from '../services/auth.service';


import { propertyService } from '../services/property.service';
import { ownerService } from '../services/owner.service';
import type { BookingWithDetails, MonthlyPayment } from '../types/booking.types';
import type { Property } from '../types/property.types';
import type { Owner } from '../types/owner.types';
import BookingCard from '../components/bookings/BookingCard';
import BookingCardSkeleton from '../components/bookings/BookingCardSkeleton';
import InvoiceModal from '../components/bookings/InvoiceModal';
import MonthlyPaymentsModal from '../components/bookings/MonthlyPaymentsModal';
import VacateWarningModal from '../components/bookings/VacateWarningModal';
import { getRemainingVacateDays } from '../utils/vacate';
import { resolveRentCoverageSummary } from '../utils/rent-coverage';
import { toast } from 'react-hot-toast';
import { buildMonthlyPaymentTimeline } from '../utils/booking.utils';
import RejectionPopup from '../components/bookings/RejectionPopup';
import PaymentErrorOverlay from '../components/payments/PaymentErrorOverlay';
import OwnerApprovalPopup from '../components/bookings/OwnerApprovalPopup';
import { buildFreshBookingRetryRedirect } from '../utils/payment-result-route';

const normalizeStatus = (status: string) => String(status || '').toLowerCase().replace(/_/g, '-');
const BOOKING_HISTORY_ARCHIVE_STORAGE_KEY = 'roomfindr_customer_archived_booking_ids';
const BOOKING_HISTORY_HIDDEN_STORAGE_KEY = 'roomfindr_customer_hidden_history_booking_ids';
const ABANDONED_BOOKING_PAYMENT_STORAGE_KEY = 'roomfindr_abandoned_booking_payment_ids';

const activeStatusSet = new Set([
    'requested',
    'pending',
    'accepted',
    'approved',
    'confirmed',
    'paid',
    'payment-pending',
    'payment-failed',
    'checked-in',
    'booked',
    'active',
    'ongoing',
    'rejected',
    'refunded'
]);

const historyStatusSet = new Set([
    'cancelled',
    'checked-out',
    'cancelled-by-customer',
    'vacated',
    'completed',
    'refunded'
]);

const refundLifecycleStatusSet = new Set([
    'cancelled',
    'cancelled-by-customer',
    'rejected',
    'refunded'
]);

const VERIFY_COOLDOWN_MS = 10 * 60_000;

const isVacatedLike = (booking: BookingWithDetails) => {
    const normalizedStatus = normalizeStatus(booking.status);
    const normalizedPaymentStatus = normalizeStatus(booking.paymentStatus);
    const hasPaidRefundLifecycle =
        refundLifecycleStatusSet.has(normalizedStatus) &&
        normalizedPaymentStatus === 'paid';

    if (hasPaidRefundLifecycle) return false;
    if (booking.vacateDate) return true;
    if (booking.stayStatus === 'vacated' || booking.stayStatus === 'vacate_requested') return true;
    return normalizedStatus === 'vacated' || normalizedStatus === 'vacate-requested';
};

const isCompletedRefundedBooking = (booking: BookingWithDetails) => {
    const normalizedStatus = normalizeStatus(booking.status);
    const normalizedPaymentStatus = normalizeStatus(booking.paymentStatus);
    return normalizedStatus === 'refunded' || normalizedPaymentStatus === 'refunded';
};

const readStoredBookingIdSet = (storageKey: string): Set<string> => {
    if (typeof window === 'undefined') return new Set();

    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
    } catch {
        return new Set();
    }
};

const writeStoredBookingIdSet = (storageKey: string, values: Set<string>) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(values)));
};

const pruneStoredBookingIdSet = (storageKey: string, validIds: Set<string>) => {
    const current = readStoredBookingIdSet(storageKey);
    const next = new Set(Array.from(current).filter((bookingId) => validIds.has(bookingId)));
    if (next.size !== current.size) {
        writeStoredBookingIdSet(storageKey, next);
    }
    return next;
};

const readSessionBookingIdSet = (storageKey: string): Set<string> => {
    if (typeof window === 'undefined') return new Set();

    try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
    } catch {
        return new Set();
    }
};

const writeSessionBookingIdSet = (storageKey: string, values: Set<string>) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(values)));
};

const applyAbandonedPaymentOverrides = (
    bookings: BookingWithDetails[],
    abandonedBookingIds: Set<string>
) => bookings.map((booking) => {
    const pendingPayment = booking.paymentStatus === 'pending' || booking.paymentStatus === 'payment_pending';
    if (!abandonedBookingIds.has(booking.bookingId) || !pendingPayment) {
        return booking;
    }

    return {
        ...booking,
        status: 'payment_failed' as const,
        paymentStatus: 'failed' as const,
    } as BookingWithDetails;
});

const isSupersededRetryCandidate = (booking: BookingWithDetails) => {
    const normalizedStatus = normalizeStatus(booking.status);
    const normalizedPaymentStatus = normalizeStatus(booking.paymentStatus);

    return (
        ['payment-pending', 'payment-failed', 'pending'].includes(normalizedStatus) ||
        ['pending', 'payment-pending', 'failed'].includes(normalizedPaymentStatus)
    );
};

const isReplacementForRetryCandidate = (booking: BookingWithDetails) => {
    const normalizedStatus = normalizeStatus(booking.status);
    const normalizedPaymentStatus = normalizeStatus(booking.paymentStatus);

    if (['paid', 'completed', 'success', 'authorized', 'refunded'].includes(normalizedPaymentStatus)) {
        return true;
    }

    return [
        'requested',
        'approved',
        'accepted',
        'confirmed',
        'checked-in',
        'checked-out',
        'vacated',
        'completed',
        'booked',
        'active',
        'ongoing',
        'refunded'
    ].includes(normalizedStatus);
};

const getBookingDeduplicationKey = (booking: BookingWithDetails) => {
    const propertyKey = String(booking.propertyId || '').trim();
    const roomKey = String(booking.roomId || booking.roomNumber || '').trim();
    return `${propertyKey}::${roomKey}`;
};

const buildSupersededRetryBookingIds = (bookings: BookingWithDetails[]) => {
    const suppressedIds = new Set<string>();

    bookings.forEach((booking) => {
        if (!isSupersededRetryCandidate(booking)) {
            return;
        }

        const bookingCreatedAt = new Date(String(booking.createdAt || 0)).getTime();
        const bookingKey = getBookingDeduplicationKey(booking);

        const hasNewerReplacement = bookings.some((candidate) => {
            if (candidate.bookingId === booking.bookingId) {
                return false;
            }

            if (getBookingDeduplicationKey(candidate) !== bookingKey) {
                return false;
            }

            if (!isReplacementForRetryCandidate(candidate)) {
                return false;
            }

            const candidateCreatedAt = new Date(String(candidate.createdAt || 0)).getTime();
            return Number.isFinite(candidateCreatedAt)
                ? candidateCreatedAt >= bookingCreatedAt
                : true;
        });

        if (hasNewerReplacement) {
            suppressedIds.add(booking.bookingId);
        }
    });

    return suppressedIds;
};

const splitBookings = (
    bookings: BookingWithDetails[],
    archivedBookingIds: Set<string>,
    hiddenHistoryBookingIds: Set<string>
) => {
    const active: BookingWithDetails[] = [];
    const history: BookingWithDetails[] = [];
    const supersededRetryBookingIds = buildSupersededRetryBookingIds(bookings);

    bookings.forEach((booking) => {
        if (supersededRetryBookingIds.has(booking.bookingId)) {
            return;
        }

        if (hiddenHistoryBookingIds.has(booking.bookingId)) {
            return;
        }

        const normalized = normalizeStatus(booking.status);
        const vacatedLike = isVacatedLike(booking);
        if (archivedBookingIds.has(booking.bookingId) || isCompletedRefundedBooking(booking) || vacatedLike || historyStatusSet.has(normalized)) {
            history.push(booking);
            return;
        }
        if (activeStatusSet.has(normalized)) {
            active.push(booking);
        }
    });

    return { active, history };
};

const actionableRentStatuses = new Set(['pending', 'failed']);

const resolveBookingMonthlyAmount = (booking: BookingWithDetails) => {
    let monthlyAmount = Number(booking.monthlyRent || booking.propertyDetails?.pricePerMonth || 0);

    if (booking.propertyDetails?.rooms && booking.roomId) {
        const room = booking.propertyDetails.rooms[booking.roomId];
        if (room?.price) {
            monthlyAmount = Number(room.price);
        }
    }

    return monthlyAmount;
};

const buildBookingMonthlyPayments = (
    booking: BookingWithDetails,
    payments: MonthlyPayment[] = [],
    overrides?: {
        rentCycleStartMonth?: string;
        rentCanPay?: boolean;
    }
) => buildMonthlyPaymentTimeline({
    startDate: booking.startDate,
    endDate: booking.endDate,
    durationMonths: booking.durationMonths || 1,
    monthlyAmount: resolveBookingMonthlyAmount(booking),
    payments,
    rentCycleStartMonth: overrides?.rentCycleStartMonth ?? booking.currentCycleStartDate?.slice(0, 7) ?? '',
    rentCanPay: overrides?.rentCanPay ?? actionableRentStatuses.has(String(booking.rentPaymentStatus || '').toLowerCase()),
});

const getVacateReferenceDueDate = (booking?: BookingWithDetails | null) => {
    if (!booking) return null;

    return resolveRentCoverageSummary({
        status: booking.status,
        stayStatus: booking.stayStatus,
        vacateDate: booking.vacateDate,
        paymentType: booking.paymentType,
        paymentStatus: booking.paymentStatus,
        durationMonths: booking.durationMonths,
        cycleNextDueDate: booking.nextDueDate,
        bookingNextDueDate: booking.nextDueDate,
        legacyNextPaymentDate: booking.nextPaymentDate,
        currentCycleStartDate: booking.currentCycleStartDate || null,
        checkInDate: booking.checkInDate || null,
        startDate: booking.startDate,
        cycleDurationDays: booking.cycleDurationDays,
    }).effectiveNextDueDate;
};

const Bookings = () => {
    const { currentUser } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const appType = String(import.meta.env.VITE_APP_TYPE || 'customer').toLowerCase();
    const resolvedCustomerId = currentUser?.id || authService.getCachedCurrentUser()?.id || '';
    const highlightedBookingId = searchParams.get('highlight') || searchParams.get('booking_id') || '';
    const paymentResult = String(searchParams.get('payment_result') || '').toLowerCase();
    const paymentResultMessage = String(searchParams.get('payment_message') || '').trim();
    const paymentResultContext = String(searchParams.get('payment_context') || '').toLowerCase();

    // State
    const [activeBookings, setActiveBookings] = useState<BookingWithDetails[]>([]);
    const [bookingHistory, setBookingHistory] = useState<BookingWithDetails[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

    // Modals
    const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);
    const [vacateWarningBooking, setVacateWarningBooking] = useState<BookingWithDetails | null>(null);
    const [isSubmittingVacate, setIsSubmittingVacate] = useState(false);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);
    const [showMonthlyPaymentsModal, setShowMonthlyPaymentsModal] = useState(false);
    const [monthlyPayments, setMonthlyPayments] = useState<MonthlyPayment[]>([]);
    const [rejectedBookingToShow, setRejectedBookingToShow] = useState<BookingWithDetails | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const [showPaymentError, setShowPaymentError] = useState(false);
    const [showOwnerApproval, setShowOwnerApproval] = useState(false);
    const [retryingBookingIds, setRetryingBookingIds] = useState<Set<string>>(new Set());
    const [archivedBookingIds, setArchivedBookingIds] = useState<Set<string>>(() => readStoredBookingIdSet(BOOKING_HISTORY_ARCHIVE_STORAGE_KEY));
    const [hiddenHistoryBookingIds, setHiddenHistoryBookingIds] = useState<Set<string>>(() => readStoredBookingIdSet(BOOKING_HISTORY_HIDDEN_STORAGE_KEY));
    const [abandonedPaymentBookingIds, setAbandonedPaymentBookingIds] = useState<Set<string>>(() => readSessionBookingIdSet(ABANDONED_BOOKING_PAYMENT_STORAGE_KEY));
    const verifiedPendingRef = React.useRef<Map<string, number>>(new Map());
    const hasAutoSelectedHighlightedTabRef = React.useRef(false);
    const hasResolvedInitialBookingsRef = React.useRef(false);

    // Cache for property and owner details
    const detailsCacheRef = React.useRef<{
        properties: Record<string, Property>,
        owners: Record<string, Owner>
    }>({ properties: {}, owners: {} });

    const [, tick] = useState(0);
    const forceUpdate = () => tick(prev => prev + 1);

    const clearPaymentResultParams = React.useCallback(() => {
        const params = new URLSearchParams(searchParams);
        [
            'owner_wait',
            'payment_result',
            'payment_message',
            'payment_context',
            'app',
        ].forEach((key) => params.delete(key));
        const next = params.toString();
        navigate(next ? `/bookings?${next}` : '/bookings', { replace: true });
    }, [navigate, searchParams]);

    const applyBookingsSnapshot = React.useCallback((bookings: BookingWithDetails[]) => {
        const cache = detailsCacheRef.current;
        const validBookingIds = new Set(bookings.map((booking) => booking.bookingId));
        const nextArchivedBookingIds = pruneStoredBookingIdSet(BOOKING_HISTORY_ARCHIVE_STORAGE_KEY, validBookingIds);
        const nextHiddenHistoryBookingIds = pruneStoredBookingIdSet(BOOKING_HISTORY_HIDDEN_STORAGE_KEY, validBookingIds);
        const nextAbandonedBookingIds = new Set(
            Array.from(readSessionBookingIdSet(ABANDONED_BOOKING_PAYMENT_STORAGE_KEY)).filter((bookingId) => {
                const booking = bookings.find((item) => item.bookingId === bookingId);
                if (!booking) return false;
                return booking.paymentStatus === 'pending' || booking.paymentStatus === 'payment_pending';
            })
        );

        writeSessionBookingIdSet(ABANDONED_BOOKING_PAYMENT_STORAGE_KEY, nextAbandonedBookingIds);
        setArchivedBookingIds(nextArchivedBookingIds);
        setHiddenHistoryBookingIds(nextHiddenHistoryBookingIds);
        setAbandonedPaymentBookingIds(nextAbandonedBookingIds);

        const enriched = applyAbandonedPaymentOverrides(
            bookings.map((booking) => ({
                ...booking,
                propertyDetails: booking.propertyDetails || cache.properties[booking.propertyId] || undefined,
                ownerDetails: booking.ownerDetails || cache.owners[booking.ownerId] || undefined,
            })),
            nextAbandonedBookingIds
        );

        const split = splitBookings(enriched, nextArchivedBookingIds, nextHiddenHistoryBookingIds);
        setActiveBookings(split.active);
        setBookingHistory(split.history);
        setLoading(false);
        hasResolvedInitialBookingsRef.current = true;

        return { nextAbandonedBookingIds, nextArchivedBookingIds, nextHiddenHistoryBookingIds };
    }, []);

    useEffect(() => {
        if (!resolvedCustomerId) return;

        const unsubscribeBookings = bookingService.subscribeToCustomerBookings(resolvedCustomerId, async (bookings) => {
            const cache = detailsCacheRef.current;
            const { nextAbandonedBookingIds, nextArchivedBookingIds, nextHiddenHistoryBookingIds } = applyBookingsSnapshot(bookings as BookingWithDetails[]);

            const uniquePropertyIds = [...new Set(bookings.map(b => b.propertyId))];
            const uniqueOwnerIds = [...new Set(bookings.map(b => b.ownerId))];
            const missingProperties = uniquePropertyIds.filter(id => !cache.properties[id]);
            const missingOwners = uniqueOwnerIds.filter(id => !cache.owners[id]);

            if (missingProperties.length === 0 && missingOwners.length === 0) return;

            const [newProperties, newOwners] = await Promise.all([
                missingProperties.length > 0 ? propertyService.getPropertiesByIds(missingProperties) : Promise.resolve({} as Record<string, Property>),
                missingOwners.length > 0 ? ownerService.getOwnersByIds(missingOwners) : Promise.resolve({} as Record<string, Owner>),
            ]);

            detailsCacheRef.current = {
                properties: { ...cache.properties, ...newProperties },
                owners: { ...cache.owners, ...newOwners }
            };
            forceUpdate();

            const finalEnriched = applyAbandonedPaymentOverrides(
                bookings.map(b => ({
                    ...b,
                    propertyDetails: newProperties[b.propertyId] || detailsCacheRef.current.properties[b.propertyId],
                    ownerDetails: newOwners[b.ownerId] || detailsCacheRef.current.owners[b.ownerId]
                })),
                nextAbandonedBookingIds
            );

            const finalSplit = splitBookings(finalEnriched, nextArchivedBookingIds, nextHiddenHistoryBookingIds);
            setActiveBookings(finalSplit.active);
            setBookingHistory(finalSplit.history);
        });

        const unsubscribeNotifications = notificationService.subscribeToUnread(resolvedCustomerId, (count, notifications) => {
            if (count > 0) notificationService.markAsRead(resolvedCustomerId, notifications.map(n => n.id));
        });

        return () => {
            unsubscribeBookings();
            unsubscribeNotifications();
        };
    }, [applyBookingsSnapshot, currentUser?.id, resolvedCustomerId]);

    useEffect(() => {
        if (!resolvedCustomerId || hasResolvedInitialBookingsRef.current) return;

        const timer = window.setTimeout(() => {
            if (hasResolvedInitialBookingsRef.current) return;

            void bookingService.getCustomerBookings(resolvedCustomerId)
                .then((bookings) => {
                    applyBookingsSnapshot(bookings as BookingWithDetails[]);
                })
                .catch((error) => {
                    console.error('[Bookings] Fallback direct fetch failed:', error);
                    setLoading(false);
                });
        }, 2500);

        return () => window.clearTimeout(timer);
    }, [applyBookingsSnapshot, resolvedCustomerId]);

    useEffect(() => {
        const hardStopTimer = window.setTimeout(() => {
            if (hasResolvedInitialBookingsRef.current) return;
            setLoading(false);
        }, 9000);

        return () => window.clearTimeout(hardStopTimer);
    }, []);

    useEffect(() => {
        if (activeBookings.length === 0) return;
        void paymentService.preloadProvider();
    }, [activeBookings.length]);

    useEffect(() => {
        if (!activeBookings.length) return;
        const pendingBookings = activeBookings.filter(b => b.paymentStatus === 'pending' || b.paymentStatus === 'payment_pending');
        const now = Date.now();
        const pendingIds = new Set(pendingBookings.map(b => b.bookingId));
        verifiedPendingRef.current.forEach((_value, key) => {
            if (!pendingIds.has(key)) {
                verifiedPendingRef.current.delete(key);
            }
        });
        pendingBookings.forEach(async (booking) => {
            const lastAttempt = verifiedPendingRef.current.get(booking.bookingId) || 0;
            if (now - lastAttempt < VERIFY_COOLDOWN_MS) return;
            verifiedPendingRef.current.set(booking.bookingId, now);
            const verify = await paymentService.verifyPaymentStatus({
                bookingId: booking.bookingId,
                paymentType: 'booking',
            });
            if (verify?.status === 'paid') {
                if (currentUser?.id) {
                    await offerService.redeemPendingOfferForBooking(booking.bookingId, currentUser.id);
                }
                setShowOwnerApproval(true);
                return;
            }
            if (verify?.status === 'failed') {
                setAbandonedPaymentBookingIds((prev) => {
                    const next = new Set(prev);
                    next.add(booking.bookingId);
                    writeSessionBookingIdSet(ABANDONED_BOOKING_PAYMENT_STORAGE_KEY, next);
                    return next;
                });
            }
        });
    }, [activeBookings, currentUser?.id]);
    useEffect(() => {
        const ownerWait = searchParams.get('owner_wait') === '1' || searchParams.get('owner_wait') === 'true';
        if (ownerWait || paymentResult === 'success') {
            setShowOwnerApproval(true);
        }
    }, [paymentResult, searchParams]);

    useEffect(() => {
        if (paymentResult !== 'success') return;
        if (!highlightedBookingId || !currentUser?.id) return;

        void offerService.redeemPendingOfferForBooking(highlightedBookingId, currentUser.id);
    }, [currentUser?.id, highlightedBookingId, paymentResult]);

    useEffect(() => {
        if (paymentResult !== 'failed') return;
        setPaymentError(paymentResultMessage || (
            paymentResultContext.includes('verification')
                ? 'Payment confirmation is taking longer than expected. If money was debited, please wait for refund to the original payment method before retrying.'
                : 'Payment could not be completed. Please try again.'
        ));
        setShowPaymentError(true);
    }, [clearPaymentResultParams, paymentResult, paymentResultContext, paymentResultMessage]);

    useEffect(() => {
        if (!highlightedBookingId) return;
        if (hasAutoSelectedHighlightedTabRef.current) return;

        const highlightedInHistory = bookingHistory.some((booking) => booking.bookingId === highlightedBookingId);
        const highlightedInActive = activeBookings.some((booking) => booking.bookingId === highlightedBookingId);

        if (highlightedInHistory && activeTab !== 'history') {
            hasAutoSelectedHighlightedTabRef.current = true;
            setActiveTab('history');
            return;
        }

        if (highlightedInActive && activeTab !== 'active') {
            hasAutoSelectedHighlightedTabRef.current = true;
            setActiveTab('active');
        }
    }, [activeBookings, activeTab, bookingHistory, highlightedBookingId]);


    const handleMonthlyPayments = async (bookingId: string) => {
        const booking = activeBookings.find(b => b.bookingId === bookingId);
        if (booking) {
            setSelectedBooking(booking);
            setMonthlyPayments(buildBookingMonthlyPayments(booking));
            setShowMonthlyPaymentsModal(true);

            try {
                const [paymentsResult, rentCycleResult] = await Promise.allSettled([
                    bookingService.getMonthlyPayments(bookingId),
                    bookingService.getBookingRentCycle(bookingId)
                ]);

                const existingPayments = paymentsResult.status === 'fulfilled'
                    ? paymentsResult.value
                    : [];
                const rentCycle = rentCycleResult.status === 'fulfilled'
                    ? rentCycleResult.value
                    : null;

                if (paymentsResult.status === 'rejected') {
                    console.warn('[Bookings] Falling back to seeded monthly timeline because payments could not be fetched.', paymentsResult.reason);
                }
                if (rentCycleResult.status === 'rejected') {
                    console.warn('[Bookings] Falling back to booking rent metadata because the rent cycle could not be fetched.', rentCycleResult.reason);
                }

                setMonthlyPayments(buildBookingMonthlyPayments(booking, existingPayments, {
                    rentCycleStartMonth: rentCycle?.currentCycleStartDate?.slice(0, 7) || '',
                    rentCanPay: rentCycle?.canPayRent,
                }));
            } catch (error) {
                console.error("Error fetching payments", error);
            }
        }
    };


    const handleViewInvoice = (bookingId: string) => {
        const booking = [...activeBookings, ...bookingHistory].find(b => b.bookingId === bookingId);
        if (booking) {
            setSelectedBooking(booking);
            setShowInvoiceModal(true);
        }
    };

    const handleViewPortal = () => navigate('/chat');



    const handleInitiateUsingPayment = async (payment: MonthlyPayment) => {
        if (!selectedBooking || !currentUser) return;

        setIsProcessing(true);
        try {
            const liveRentCycle = await bookingService.getBookingRentCycle(selectedBooking.bookingId).catch(() => null);
            const liveMonth = liveRentCycle?.currentCycleStartDate
                ? format(new Date(liveRentCycle.currentCycleStartDate), 'yyyy-MM')
                : payment.month;

            if (liveRentCycle && !liveRentCycle.canPayRent) {
                toast(liveRentCycle.message || 'Rent payment is not open for this booking yet.', { icon: 'i' });
                return;
            }

            if (payment.status === 'paid') {
                toast('This rent cycle is already verified.', { icon: 'i' });
                return;
            }
            const verify = await paymentService.verifyPaymentStatus({
                bookingId: selectedBooking.bookingId,
                paymentType: 'monthly',
                metadata: { month: liveMonth }
            });
            if (verify?.status === 'paid') {
                toast('This rent cycle is already verified.', { icon: 'i' });
                return;
            }

            const params = new URLSearchParams();
            params.set('booking_id', selectedBooking.bookingId);
            params.set('context', 'rent');
            params.set('month', liveMonth);
            params.set('amount', String(payment.amount));
            params.set('app', appType);

            navigate(`/payment?${params.toString()}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Payment initiation failed';
            toast.error(msg);
            setPaymentError(msg);
            setShowPaymentError(true);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRetryBookingPayment = async (booking: BookingWithDetails) => {
        if (!currentUser || retryingBookingIds.has(booking.bookingId)) return;
        if (booking.paymentStatus === 'paid') {
            setShowOwnerApproval(true);
            return;
        }

        const nextAbandonedIds = new Set(abandonedPaymentBookingIds);
        if (nextAbandonedIds.delete(booking.bookingId)) {
            setAbandonedPaymentBookingIds(nextAbandonedIds);
            writeSessionBookingIdSet(ABANDONED_BOOKING_PAYMENT_STORAGE_KEY, nextAbandonedIds);
        }

        setRetryingBookingIds(prev => new Set(prev).add(booking.bookingId));

        try {
            const verify = await paymentService.verifyPaymentStatus({
                bookingId: booking.bookingId,
                paymentType: 'booking',
            });
            if (verify?.status === 'paid') {
                setShowOwnerApproval(true);
                return;
            }

            await paymentService.markPaymentFailed({
                bookingId: booking.bookingId,
                paymentType: 'booking',
                reason: 'Customer requested a fresh booking retry',
            });

            navigate(buildFreshBookingRetryRedirect({
                bookingId: booking.bookingId,
                propertyId: booking.propertyId,
                roomId: booking.roomId,
                app: appType,
                isRentPayment: false,
            }));
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Payment initiation failed';
            toast.error(msg);
            setPaymentError(msg);
            setShowPaymentError(true);
        } finally {
            setRetryingBookingIds(prev => {
                const next = new Set(prev);
                next.delete(booking.bookingId);
                return next;
            });
        }
    };

    const handleMoveBookingToHistory = React.useCallback((booking: BookingWithDetails) => {
        const next = new Set(archivedBookingIds);
        next.add(booking.bookingId);
        setArchivedBookingIds(next);
        writeStoredBookingIdSet(BOOKING_HISTORY_ARCHIVE_STORAGE_KEY, next);
        setActiveTab('history');
        toast.success('Booking moved to history.');
    }, [archivedBookingIds]);

    const handleHideBookingFromHistory = React.useCallback((booking: BookingWithDetails) => {
        const next = new Set(hiddenHistoryBookingIds);
        next.add(booking.bookingId);
        setHiddenHistoryBookingIds(next);
        writeStoredBookingIdSet(BOOKING_HISTORY_HIDDEN_STORAGE_KEY, next);
        toast.success('Booking removed from history view.');
    }, [hiddenHistoryBookingIds]);


    const handleVacate = (booking: BookingWithDetails) => {
        setVacateWarningBooking(booking);
    };

    const handleConfirmVacate = async () => {
        if (!vacateWarningBooking) return;

        try {
            setIsSubmittingVacate(true);
            await bookingService.vacateBooking(vacateWarningBooking.bookingId);
            toast.success('Vacate request sent! Waiting for approval.');
            setVacateWarningBooking(null);
        } catch (error) {
            console.error('Vacate error:', error);
            toast.error('Failed to send vacate request');
        } finally {
            setIsSubmittingVacate(false);
        }
    };

    const renderBookingsList = (bookings: BookingWithDetails[]) => {
        const effectiveBookings = applyAbandonedPaymentOverrides(bookings, abandonedPaymentBookingIds);
        if (loading) return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{[1, 2, 3].map(i => <BookingCardSkeleton key={i} />)}</div>;
        if (effectiveBookings.length === 0) return (
            <div className="flex flex-col items-center justify-center py-20 bg-white/40 backdrop-blur-xl rounded-[40px] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="w-32 h-32 bg-orange-50 rounded-full flex items-center justify-center mb-8 relative">
                    <div className="absolute inset-0 bg-orange-500/10 rounded-full animate-ping" />
                    <svg className="h-14 w-14 text-orange-600 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 mb-2">No Bookings Yet</h3>
                <p className="text-slate-400 font-bold text-[11px] sm:text-[13px] max-w-sm text-center px-6 sm:px-8 mb-6 sm:mb-8 leading-relaxed uppercase tracking-wide">
                    Your future home is just a click away. Start exploring our premium properties today.
                </p>
                {activeTab === 'active' && (
                    <button
                        onClick={() => navigate('/')}
                        className="px-8 sm:px-12 py-3 sm:py-4 bg-[var(--rf-color-action)] text-white text-[10px] sm:text-[11px] font-black uppercase tracking-[0.18em] sm:tracking-[0.2em] rounded-2xl shadow-xl shadow-orange-200 hover:scale-105 active:scale-95 transition-all"
                    >
                        Explore Now
                    </button>
                )}
            </div>
        );
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {effectiveBookings.map(booking => (
                    <BookingCard
                        key={booking.bookingId}
                        booking={booking}
                        listType={activeTab}
                        onViewInvoice={handleViewInvoice}
                        onViewPortal={handleViewPortal}
                        onMonthlyPayments={handleMonthlyPayments}
                        onVacate={handleVacate}
                        onRetryBooking={() => handleRetryBookingPayment(booking)}
                        onMoveToHistory={activeTab === 'active' ? () => handleMoveBookingToHistory(booking) : undefined}
                        onHideFromHistory={activeTab === 'history' ? () => handleHideBookingFromHistory(booking) : undefined}
                        isRetryingPayment={retryingBookingIds.has(booking.bookingId)}
                    />
                ))}
            </div>
        );
    };

    return (
        <div className="rfm-bookings-page min-h-screen bg-[#F8FAFC] pb-24 md:pb-12 font-['Inter',_sans-serif] animate-in fade-in duration-700">
            <VacateWarningModal
                open={Boolean(vacateWarningBooking)}
                remainingDays={getRemainingVacateDays(getVacateReferenceDueDate(vacateWarningBooking)?.toISOString() || null)}
                onClose={() => {
                    if (isSubmittingVacate) return;
                    setVacateWarningBooking(null);
                }}
                onConfirm={handleConfirmVacate}
                isSubmitting={isSubmittingVacate}
            />
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-4 sm:pt-5 sm:pb-8">
                <div className="rfm-bookings-header mb-3 sm:mb-4">
                    <div className="rfm-bookings-tabs flex bg-white/60 backdrop-blur-md p-1 rounded-[18px] sm:rounded-[22px] border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] w-full sm:w-fit">
                        <button
                            onClick={() => setActiveTab('active')}
                            className={`rfm-bookings-tab flex-1 sm:flex-none px-6 sm:px-10 py-2.5 sm:py-3.5 text-[10px] sm:text-[11px] font-black uppercase tracking-widest rounded-[14px] sm:rounded-[18px] transition-all duration-500 ${activeTab === 'active' ? 'bg-[var(--rf-color-action)] text-white shadow-xl shadow-orange-200' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Active
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`rfm-bookings-tab flex-1 sm:flex-none px-6 sm:px-10 py-2.5 sm:py-3.5 text-[10px] sm:text-[11px] font-black uppercase tracking-widest rounded-[14px] sm:rounded-[18px] transition-all duration-500 ${activeTab === 'history' ? 'bg-[var(--rf-color-action)] text-white shadow-xl shadow-orange-200' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            History
                        </button>
                    </div>
                </div>

                {renderBookingsList(activeTab === 'active' ? activeBookings : bookingHistory)}
            </div>

            <InvoiceModal booking={selectedBooking} isOpen={showInvoiceModal} onClose={() => setShowInvoiceModal(false)} />
            <MonthlyPaymentsModal booking={selectedBooking} payments={monthlyPayments} isOpen={showMonthlyPaymentsModal} onClose={() => setShowMonthlyPaymentsModal(false)} onPayNow={handleInitiateUsingPayment} isProcessing={isProcessing} />
            {rejectedBookingToShow && <RejectionPopup booking={rejectedBookingToShow} onClose={() => setRejectedBookingToShow(null)} onExplore={() => { setRejectedBookingToShow(null); navigate('/'); }} />}
            <PaymentErrorOverlay
                open={showPaymentError}
                title="Payment Failed"
                message={paymentError || 'Payment could not be started. Please try again.'}
                onClose={() => {
                    setShowPaymentError(false);
                    if (paymentResult === 'failed') {
                        clearPaymentResultParams();
                    }
                }}
                onGoBookings={() => {
                    setShowPaymentError(false);
                    if (paymentResult === 'failed') {
                        clearPaymentResultParams();
                        return;
                    }
                    navigate('/bookings');
                }}
                onViewDetails={() => {
                    const params = new URLSearchParams();
                    if (paymentError) params.set('message', paymentError);
                    params.set('context', 'bookings');
                    navigate(`/payment/error?${params.toString()}`);
                }}
            />
            <OwnerApprovalPopup
                open={showOwnerApproval}
                onClose={() => {
                    setShowOwnerApproval(false);
                    clearPaymentResultParams();
                }}
            />
        </div>
    );
};

export default Bookings;
