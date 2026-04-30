import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { bookingService } from '../../services/booking.service';



import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import type { Property, Room } from '../../types/property.types';
import { useNavigate } from 'react-router-dom';
import { offerService } from '../../services/offer.service';
import { propertyService } from '../../services/property.service';
import type { Offer } from '../../types/booking.types';
import { FiCalendar, FiCheckCircle, FiCreditCard, FiGift, FiX, FiArrowRight, FiArrowLeft, FiTag, FiUser, FiPhone, FiMail, FiLock, FiChevronDown, FiChevronUp, FiClock, FiAlertTriangle } from 'react-icons/fi';
import PaymentErrorOverlay from '../payments/PaymentErrorOverlay';

interface BookingModalFullProps {
    property: Property;
    selectedRoom?: Room;
    onClose: () => void;
}

export const BookingModalFull: React.FC<BookingModalFullProps> = ({
    property,
    selectedRoom,
    onClose
}) => {
    const { currentUser, userData } = useAuth();
    const navigate = useNavigate();

    const secureOnClose = () => {
        if (paymentInProgress) {
            toast.error("Payment in progress. Please don't close.");
            return;
        }
        onClose();
    };
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [loading, setLoading] = useState(false);
    const [conflictError, setConflictError] = useState<string | null>(null);
    const [paymentInProgress, setPaymentInProgress] = useState(false);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const [showPaymentError, setShowPaymentError] = useState(false);

    const normalizedConflictError = React.useMemo(() => {
        const raw = String(conflictError || '').trim();
        if (!raw) return null;

        const clean = raw
            .replace(/^VACATE_APPROVAL_PENDING:\s*/i, '')
            .replace(/^ACTIVE_PG_BOOKING_EXISTS:\s*/i, '')
            .trim();

        const isVacatePending = /owner approval/i.test(raw) || /approve vacate/i.test(raw);

        return {
            isVacatePending,
            title: isVacatePending ? 'Vacate Approval Pending' : 'Booking Not Available',
            description: clean,
            accentClass: isVacatePending
                ? 'from-amber-500 via-orange-500 to-rose-500'
                : 'from-red-500 via-orange-500 to-amber-500',
            panelClass: isVacatePending
                ? 'border-amber-200 bg-[linear-gradient(180deg,#fffaf0_0%,#ffffff_100%)]'
                : 'border-rose-200 bg-[linear-gradient(180deg,#fff7f7_0%,#ffffff_100%)]',
            badgeClass: isVacatePending
                ? 'bg-amber-100 text-amber-700 border-amber-200'
                : 'bg-rose-100 text-rose-700 border-rose-200',
            Icon: isVacatePending ? FiClock : FiAlertTriangle,
            primaryLabel: isVacatePending ? 'Open My Booking' : 'View My Booking',
            secondaryLabel: isVacatePending ? 'Okay, I Will Wait' : 'Close'
        };
    }, [conflictError]);


    // Step 1: Date Selection
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [durationMonths, setDurationMonths] = useState(0);

    // Step 2: Payment Type
    const [paymentType, setPaymentType] = useState<'advance' | 'full'>('advance');

    // Step 3: Occupant Details
    const [occupantName, setOccupantName] = useState(userData?.name || '');
    const [occupantPhone, setOccupantPhone] = useState(userData?.phone || '');
    const [occupantEmail, setOccupantEmail] = useState(userData?.email || '');

    // Offer State
    const [offerCode, setOfferCode] = useState('');
    const [appliedOffer, setAppliedOffer] = useState<Offer | null>(null);
    const [isApplyingOffer, setIsApplyingOffer] = useState(false);
    const [discountAmount, setDiscountAmount] = useState(0);
    const [showVoucher, setShowVoucher] = useState(false); // Controls voucher accordion

    const isConflictMessage = (message: string) => (
        message.includes('ACTIVE_PG_BOOKING_EXISTS')
        || message.includes('VACATE_APPROVAL_PENDING')
    );

    const getCleanConflictMessage = (message: string) => message
        .replace(/^ACTIVE_PG_BOOKING_EXISTS:\s*/i, '')
        .replace(/^VACATE_APPROVAL_PENDING:\s*/i, '')
        .trim();

    // Derived Refs
    const appliedOfferRef = React.useRef(appliedOffer);

    useEffect(() => {
        appliedOfferRef.current = appliedOffer;
    }, [appliedOffer]);

    useEffect(() => {
        const nextName = String(userData?.name || currentUser?.user_metadata?.name || '').trim();
        const nextPhone = String(userData?.phone || currentUser?.phone || '').trim();
        const nextEmail = String(userData?.email || currentUser?.email || '').trim();

        if (!occupantName.trim() && nextName) {
            setOccupantName(nextName);
        }
        if (!occupantPhone.trim() && nextPhone) {
            setOccupantPhone(nextPhone);
        }
        if (!occupantEmail.trim() && nextEmail) {
            setOccupantEmail(nextEmail);
        }
    }, [
        currentUser?.email,
        currentUser?.phone,
        currentUser?.user_metadata?.name,
        occupantEmail,
        occupantName,
        occupantPhone,
        userData?.email,
        userData?.name,
        userData?.phone,
    ]);

    // Load applied offer from localStorage
    useEffect(() => {
        const storedOffer = localStorage.getItem('appliedOffer');
        if (storedOffer && !appliedOffer) {
            setOfferCode(storedOffer);
        }
    }, [appliedOffer]);

    // Load property rooms if missing
    const [localRooms, setLocalRooms] = useState<Record<string, Room>>(property.rooms || {});

    useEffect(() => {
        if (!property.propertyId) return;
        if (property.rooms && Object.keys(property.rooms).length > 0) {
            setLocalRooms(property.rooms);
            return;
        }

        const unsubscribe = propertyService.subscribeToRooms(property.propertyId, (rooms) => {
            const roomsRecord: Record<string, Room> = {};
            rooms.forEach(r => {
                roomsRecord[r.roomId] = r;
            });
            setLocalRooms(roomsRecord);
        });

        return () => unsubscribe();
    }, [property.propertyId, property.rooms]);

    useEffect(() => {
        const category = (property.tags && property.tags.length > 0) ? property.tags[0] : 'all';
        const unsubscribe = offerService.subscribeToEligibleOffers(category, () => { });
        return () => unsubscribe();
    }, [property.tags]);

    // Auto-apply property specific offer
    useEffect(() => {
        if (property.autoOffer) {
            // Only auto-apply if nothing is applied, OR if the hardcoded "AUTO" was applied previously
            if (!appliedOffer || appliedOffer.code === 'AUTO') {
                setAppliedOffer(property.autoOffer);
                setOfferCode(property.autoOffer.code);

                const timer = setTimeout(() => {
                    toast.success(`Exclusive offer for ${property.title} applied!`, {
                        icon: '🎉',
                        duration: 4000
                    });
                }, 500);
                return () => clearTimeout(timer);
            }
        }
    }, [property.autoOffer, property.propertyId, property.title, appliedOffer?.code, appliedOffer]);

    // Initialize dates on mount
    useEffect(() => {
        const today = new Date();
        const nextMonth = new Date(today);
        nextMonth.setMonth(today.getMonth() + 1);
        setStartDate(today.toISOString().split('T')[0]);
        setEndDate(nextMonth.toISOString().split('T')[0]);
    }, []);

    // Price calculation variables
    const [durationDays, setDurationDays] = useState(0);

    // Calculate duration when dates change
    useEffect(() => {
        if (!startDate || !endDate) {
            setDurationMonths(0);
            setDurationDays(0);
            return;
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = end.getTime() - start.getTime();
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        setDurationDays(days);
        setDurationMonths(Math.max(0, Math.ceil(days / 30)));
    }, [startDate, endDate]);

    const refreshLatestRooms = async () => {
        try {
            const latestProperty = await propertyService.getPropertyById(property.propertyId);
            if (latestProperty?.rooms) {
                setLocalRooms(latestProperty.rooms);
                return Object.values(latestProperty.rooms);
            }
        } catch (error) {
            console.error('Failed to refresh latest room availability:', error);
        }
        return Object.values(localRooms);
    };

    // Pricing Logic
    const currentRoom = (selectedRoom?.roomId ? localRooms[selectedRoom.roomId] : null)
        || selectedRoom
        || (Object.values(localRooms).length > 0 ? Object.values(localRooms)[0] : null);
    const basePrice = currentRoom?.price || property.pricePerMonth;
    const rentAmount = (durationDays > 0 && durationDays < 30)
        ? (basePrice / 30) * durationDays
        : basePrice * durationMonths;

    const subtotal = rentAmount;
    const advanceAmount = 500;

    // Tax
    const currentTax = paymentType === 'advance' ? (advanceAmount * 0.18) : (subtotal * 0.18);
    const baseTotalDue = (paymentType === 'advance' ? advanceAmount : subtotal) + currentTax;

    // Recalculate discount
    const calculateDiscounts = (pType: 'advance' | 'full') => {
        let coupon = 0;
        let reward = 0;
        const amt = pType === 'advance' ? advanceAmount : subtotal;

        // 1. Coupon Logic
        if (appliedOffer) {
            if (appliedOffer.type === 'percentage') {
                coupon = (amt * appliedOffer.value!) / 100;
                if (coupon > appliedOffer.maxDiscount!) coupon = appliedOffer.maxDiscount!;
            } else {
                coupon = appliedOffer.value!;
            }
        }

        // 2. Full Payment Reward Logic
        if (pType === 'full' && durationMonths >= (property.fullPaymentDiscount?.minMonths || 3) && property.fullPaymentDiscount?.active) {
            const fp = property.fullPaymentDiscount;
            reward = (fp.type === 'percentage' ? (subtotal * fp.amount) / 100 : fp.amount);
        }

        return { coupon, reward, total: Math.min(coupon + reward, amt) };
    };

    const advResults = calculateDiscounts('advance');
    const fullResults = calculateDiscounts('full');

    useEffect(() => {
        setDiscountAmount(paymentType === 'advance' ? advResults.total : fullResults.total);

        if (paymentType === 'full' && fullResults.reward > 0) {
            const toastKey = `fp-discount-${property.propertyId}`;
            if (!sessionStorage.getItem(toastKey)) {
                toast.success(`Bonus: ₹${fullResults.reward.toLocaleString()} Full Payment Reward applied!`, { icon: '💰' });
                sessionStorage.setItem(toastKey, 'true');
            }
        }
    }, [paymentType, advResults.total, fullResults.total, fullResults.reward, property.propertyId]);

    const totalDue = baseTotalDue - discountAmount;

    const getRoomFullMessage = (availableRoomsCount: number) => (
        availableRoomsCount > 0
            ? 'This room was just booked by someone else. Please choose another available room.'
            : 'All beds in this property are filled right now. Please check back later.'
    );

    // Handlers
    const handleApplyOffer = async () => {
        if (!offerCode.trim()) {
            toast.error('Please enter an offer code');
            return;
        }
        if (!currentUser) {
            toast.error('Please login to apply offer');
            return;
        }

        setIsApplyingOffer(true);
        try {
            const amountToValidate = paymentType === 'advance' ? advanceAmount : subtotal;
            const result = await offerService.validateOffer(offerCode, currentUser.id, amountToValidate);
            if (result.success && result.offer) {
                setAppliedOffer(result.offer);
                localStorage.setItem('appliedOffer', result.offer.code);
                toast.success(`Offer ${result.offer.code} applied!`);
            } else {
                toast.error(result.message || 'Invalid offer code');
            }
        } catch {
            toast.error('Failed to apply offer');
        } finally {
            setIsApplyingOffer(false);
        }
    };

    const handleRemoveOffer = () => {
        setAppliedOffer(null);
        setOfferCode('');
        setDiscountAmount(0);
        localStorage.removeItem('appliedOffer');
        toast.success('Offer removed');
    };

    const handleDateNext = async () => {
        if (!startDate || !endDate) {
            toast.error('Please select both dates');
            return;
        }
        if (new Date(startDate) >= new Date(endDate)) {
            toast.error('End date must be after start date');
            return;
        }
        setLoading(true);
        const latestRoom = (selectedRoom?.roomId ? localRooms[selectedRoom.roomId] : null) || currentRoom;
        if (!latestRoom || latestRoom.status !== 'available' || (latestRoom.availableCount ?? 0) <= 0) {
            const refreshedRooms = await refreshLatestRooms();
            const availableRoomsCount = refreshedRooms.filter((room) => room.status === 'available' && (room.availableCount ?? 0) > 0).length;
            toast.error(getRoomFullMessage(availableRoomsCount));
            onClose();
            setLoading(false);
            return;
        }
        const finalRoomId = latestRoom.roomId;
        if (!finalRoomId) {
            toast.error('No rooms available for this property currently.');
            setLoading(false);
            return;
        }
        // Simplified validation for UI focus
        const validation = await bookingService.validateBooking({
            propertyId: property.propertyId,
            roomId: finalRoomId,
            startDate: startDate,
            endDate: endDate
        }, currentUser?.id);
        setLoading(false);
        if (!validation.success) {
            if (validation.message && isConflictMessage(validation.message)) {
                setConflictError(getCleanConflictMessage(validation.message));
                return;
            }
            toast.error(validation.message || 'Dates not available');
            return;
        }
        setStep(2);
    };

    const handleProceedToPayment = async () => {
        if (!occupantName || !occupantPhone || !occupantEmail) {
            toast.error('Please fill all occupant details');
            return;
        }
        if (!property.ownerId) {
            toast.error('Error: Property owner information is missing.');
            return;
        }

        setLoading(true);
        const latestRoom = (selectedRoom?.roomId ? localRooms[selectedRoom.roomId] : null) || currentRoom;
        if (!latestRoom || latestRoom.status !== 'available' || (latestRoom.availableCount ?? 0) <= 0) {
            const refreshedRooms = await refreshLatestRooms();
            const availableRoomsCount = refreshedRooms.filter((room) => room.status === 'available' && (room.availableCount ?? 0) > 0).length;
            toast.error(getRoomFullMessage(availableRoomsCount));
            onClose();
            setLoading(false);
            return;
        }
        const finalRoomId = latestRoom.roomId;
        const finalRoomNumber = latestRoom.roomNumber || 'N/A';

        try {
            if (!finalRoomId) {
                throw new Error('Missing room information');
            }

            // 1. Create Pending Booking
            const currentBookingId = await bookingService.createBooking({
                propertyId: property.propertyId,
                propertyTitle: property.title,
                roomId: finalRoomId,
                roomNumber: finalRoomNumber,
                customerId: currentUser!.id,
                customerName: occupantName,
                customerPhone: occupantPhone,
                customerEmail: occupantEmail,
                ownerId: property.ownerId,
                monthlyRent: property.pricePerMonth,
                startDate: startDate,
                endDate: endDate,
                durationMonths,
                paymentStatus: 'pending',
                transactionId: '',
                paymentType: paymentType,
                amountPaid: 0,
                advancePaid: paymentType === 'advance' ? advanceAmount : subtotal,
                status: 'payment_pending',
                notifications: [],
                offerApplied: !!appliedOffer,
                offerId: appliedOffer?.offerId || '',
                offerCode: appliedOffer?.code || '',
                discountAmount: discountAmount,
                finalAmount: totalDue
            });

            if (appliedOffer?.offerId && currentUser?.id) {
                offerService.rememberPendingOfferRedemption({
                    bookingId: currentBookingId,
                    offerId: appliedOffer.offerId,
                    userId: currentUser.id,
                    code: appliedOffer.code,
                });
            }

            // 2. Redirect to Payment Page (custom UI)
            setPaymentInProgress(false);
            toast.success('Proceeding to payment...');
            onClose();
            navigate(`/payment?bookingId=${currentBookingId}`);

            // onClose(); // We can close or wait for redirect. Usually browser redirect happens quickly.
        } catch (error) {
            console.error('Booking creation error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (isConflictMessage(errorMessage)) {
                setConflictError(getCleanConflictMessage(errorMessage));
            } else if (errorMessage.includes('ROOM_FULL')) {
                const refreshedRooms = await refreshLatestRooms();
                const availableRoomsCount = refreshedRooms.filter((room) => room.status === 'available' && (room.availableCount ?? 0) > 0).length;
                setShowPaymentError(false);
                setPaymentError(null);
                toast.error(getRoomFullMessage(availableRoomsCount));
                onClose();
            } else {
                const msg = 'Failed to initiate booking. Please try again.';
                toast.error(msg);
                setPaymentError(msg);
                setShowPaymentError(true);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            <div key="booking-modal" className="fixed inset-0 z-[150] flex items-center justify-center p-4">
                {/* Backdrop Blur Overlay */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
                    exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
                    onClick={onClose}
                    className="absolute inset-0 bg-gray-900/40"
                />

                {/* Main Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 20 }}
                    transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    className="relative w-full max-w-[720px] bg-white rounded-[20px] md:rounded-[26px] shadow-2xl overflow-hidden flex flex-col h-auto max-h-[90vh]"
                    style={{ isolation: 'isolate' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-4 md:px-8 md:py-6 border-b border-gray-100 bg-white sticky top-0 z-20">
                        <div className="flex items-center gap-3 md:gap-4 truncate">
                            {property.images && property.images.length > 0 && (
                                <img
                                    src={property.images[0]}
                                    alt={property.title}
                                    className="w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl object-cover shadow-sm bg-gray-100 shrink-0"
                                />
                            )}
                            <div className="truncate">
                                <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 mb-0.5 md:mb-1">
                                    <h2 className="text-lg md:text-2xl font-black text-gray-900 tracking-tight leading-none truncate">Book Your Stay</h2>
                                    <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-[9px] md:text-[10px] font-bold uppercase tracking-wider w-fit whitespace-nowrap">
                                        @ {property.ownerDetails?.name || 'Owner'}
                                    </span>
                                </div>
                                <p className="text-gray-500 font-medium text-[11px] md:text-sm truncate">at {property.title}</p>
                            </div>
                        </div>
                        <button
                            onClick={secureOnClose}
                            className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0"
                        >
                            <FiX size={18} />
                        </button>
                    </div>

                    {/* Step Progress Bar */}
                    <div className="px-6 py-4 md:px-8 md:py-6 bg-white border-b border-gray-50">
                        <div className="flex items-center justify-between relative px-2">
                            {/* Tracks */}
                            <div className="absolute top-1/2 left-0 w-full h-0.5 md:h-1 bg-gray-100 -z-10 rounded-full" />
                            <div
                                className="absolute top-1/2 left-0 h-0.5 md:h-1 bg-gradient-to-r from-orange-500 to-blue-500 -z-10 rounded-full transition-all duration-500"
                                style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}
                            />

                            {[1, 2, 3].map((s) => (
                                <div key={s} className="flex flex-col items-center gap-1.5 md:gap-2 bg-white px-1 md:px-2">
                                    <motion.div
                                        animate={{
                                            backgroundColor: step >= s ? '#F97316' : '#F3F4F6',
                                            scale: step === s ? (window.innerWidth < 768 ? 1.05 : 1.1) : 1
                                        }}
                                        className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[10px] md:text-xs font-bold transition-colors shadow-sm ${step >= s ? 'text-white shadow-orange-200' : 'text-gray-400'}`}
                                    >
                                        {step > s ? <FiCheckCircle size={window.innerWidth < 768 ? 12 : 14} /> : s}
                                    </motion.div>
                                    <span className={`text-[8px] md:text-[10px] font-bold uppercase tracking-widest ${step >= s ? 'text-orange-600' : 'text-gray-300'}`}>
                                        {s === 1 ? 'Dates' : s === 2 ? 'Payment' : 'Details'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="p-5 md:p-8 overflow-y-auto max-h-[60vh] no-scrollbar">
                        <AnimatePresence mode="wait">
                            {/* STEP 1: DATES */}
                            {step === 1 && (
                                <motion.div
                                    key="step1"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-6"
                                >
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                                        <div className="space-y-2 md:space-y-3">
                                            <label htmlFor="booking-check-in" className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest">Check-in</label>
                                            <div className="relative group">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-orange-600 transition-colors pointer-events-none">
                                                    <FiCalendar size={16} />
                                                </div>
                                                <input
                                                    id="booking-check-in"
                                                    name="checkInDate"
                                                    type="date"
                                                    value={startDate}
                                                    onChange={(e) => setStartDate(e.target.value)}
                                                    min={new Date().toISOString().split('T')[0]}
                                                    className="w-full h-[48px] md:h-14 pl-11 pr-4 md:pl-12 md:pr-4 bg-gray-50 border border-gray-100 text-gray-900 rounded-xl md:rounded-2xl text-[14px] md:text-base focus:ring-2 focus:ring-orange-100 focus:border-orange-500 focus:bg-white transition-all font-bold cursor-pointer"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2 md:space-y-3">
                                            <label htmlFor="booking-check-out" className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest">Check-out</label>
                                            <div className="relative group">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-orange-600 transition-colors pointer-events-none">
                                                    <FiCalendar size={16} />
                                                </div>
                                                <input
                                                    id="booking-check-out"
                                                    name="checkOutDate"
                                                    type="date"
                                                    value={endDate}
                                                    onChange={(e) => setEndDate(e.target.value)}
                                                    min={startDate || new Date().toISOString().split('T')[0]}
                                                    className="w-full h-[48px] md:h-14 pl-11 pr-4 md:pl-12 md:pr-4 bg-gray-50 border border-gray-100 text-gray-900 rounded-xl md:rounded-2xl text-[14px] md:text-base focus:ring-2 focus:ring-orange-100 focus:border-orange-500 focus:bg-white transition-all font-bold cursor-pointer"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Monthly Special Card */}
                                    {durationMonths >= 1 && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="bg-gradient-to-r from-orange-500 to-blue-500 rounded-[18px] md:rounded-[22px] p-4 md:p-6 text-white shadow-xl shadow-orange-200/50 relative overflow-hidden group"
                                        >
                                            <div className="absolute -right-8 -top-8 w-24 h-24 md:w-32 md:h-32 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
                                            <div className="flex items-center gap-4 md:gap-5 relative z-10">
                                                <div className="w-10 h-10 md:w-14 md:h-14 bg-white/20 backdrop-blur-md rounded-xl md:rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                                                    <FiGift size={22} className="text-white drop-shadow-sm md:hidden" />
                                                    <FiGift size={28} className="text-white drop-shadow-sm hidden md:block" />
                                                </div>
                                                <div>
                                                    <h4 className="font-black text-base md:text-xl tracking-tight mb-0.5 md:mb-1">Monthly Special Active!</h4>
                                                    <p className="text-blue-50 font-medium opacity-90 text-[11px] md:text-sm leading-relaxed">
                                                        Your stay exceeds 30 days. You only need to pay <span className="text-white font-black underline decoration-2 underline-offset-4">₹500 advance</span> now!
                                                    </p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* Action Button */}
                                    <div className="pt-2">
                                        <button
                                            onClick={handleDateNext}
                                            className="w-full h-[48px] md:h-14 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-xl md:rounded-2xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
                                        >
                                            <span className="text-[12px] md:text-base tracking-[0.5px] uppercase md:normal-case">Continue to Payment</span>
                                            <FiArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {/* STEP 2: PAYMENT */}
                            {step === 2 && (
                                <motion.div
                                    key="step2"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-6"
                                >
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 relative">
                                        {/* Always show Pay Advance option */}
                                        <div
                                            onClick={() => setPaymentType('advance')}
                                            className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border-2 cursor-pointer transition-all duration-300 ${paymentType === 'advance' ? 'border-orange-600 bg-orange-50/50' : 'border-gray-100 bg-white hover:border-gray-200'}`}
                                        >
                                            <div className="flex items-center justify-between mb-2 md:mb-3">
                                                <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center ${paymentType === 'advance' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                                    <FiCreditCard size={18} />
                                                </div>
                                                {paymentType === 'advance' && (
                                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-orange-600">
                                                        <FiCheckCircle size={window.innerWidth < 768 ? 18 : 24} fill="currentColor" className="text-white" />
                                                    </motion.div>
                                                )}
                                            </div>
                                            <p className="font-bold text-gray-900 text-[10px] md:text-sm mb-0.5 md:mb-1 uppercase tracking-wider text-orange-600">Pay Advance</p>
                                            <div className="flex items-baseline gap-2">
                                                <p className="text-base md:text-xl font-black text-gray-900">₹{(500 + (500 * 0.18) - advResults.total).toLocaleString()}</p>
                                                {advResults.total > 0 && (
                                                    <p className="text-xs text-gray-400 line-through font-medium">₹{(500 + (500 * 0.18)).toLocaleString()}</p>
                                                )}
                                            </div>
                                            {advResults.coupon > 0 && (
                                                <p className="text-[9px] text-blue-600 font-bold mt-1">₹{advResults.coupon.toLocaleString()} coupon applied</p>
                                            )}
                                        </div>
                                        <div
                                            onClick={() => setPaymentType('full')}
                                            className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border-2 cursor-pointer transition-all duration-300 ${paymentType === 'full' ? 'border-blue-600 bg-blue-50/50' : 'border-gray-100 bg-white hover:border-gray-200'}`}
                                        >
                                            {/* Special Offer Badge - Shows only the Reward amount (e.g. 1000) */}
                                            {fullResults.reward > 0 && (
                                                <motion.div
                                                    initial={{ y: 10, opacity: 0 }}
                                                    animate={{ y: 0, opacity: 1 }}
                                                    className="absolute -top-3 -right-2 bg-gradient-to-r from-orange-500 to-red-600 text-white text-[9px] md:text-[10px] font-black px-2.5 py-1.5 rounded-xl shadow-lg z-10 flex items-center gap-1"
                                                >
                                                    <FiGift /> ₹{fullResults.reward.toLocaleString()} REWARD
                                                </motion.div>
                                            )}

                                            <div className="flex items-center justify-between mb-2 md:mb-3">
                                                <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center ${paymentType === 'full' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                                    <FiCreditCard size={18} />
                                                </div>
                                                {paymentType === 'full' && (
                                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                                                        <FiCheckCircle size={window.innerWidth < 768 ? 20 : 24} className="text-blue-600" />
                                                    </motion.div>
                                                )}
                                            </div>
                                            <p className="font-bold text-gray-900 text-[10px] md:text-sm mb-0.5 md:mb-1 uppercase tracking-wider text-blue-600">Pay Full Amount</p>
                                            <div className="flex items-baseline gap-2">
                                                <p className="text-base md:text-xl font-black text-gray-900">₹{(subtotal + (subtotal * 0.18) - fullResults.total).toLocaleString()}</p>
                                                {fullResults.total > 0 && (
                                                    <p className="text-xs text-gray-400 line-through font-medium">₹{(subtotal + (subtotal * 0.18)).toLocaleString()}</p>
                                                )}
                                            </div>
                                            {fullResults.total > 0 && (
                                                <p className="text-[9px] text-blue-600 font-bold mt-1">
                                                    Total Saved: ₹{fullResults.total.toLocaleString()}
                                                    <span className="text-gray-400 font-medium ml-1">
                                                        ({fullResults.reward > 0 ? `₹${fullResults.reward.toLocaleString()} reward` : ''}
                                                        {fullResults.coupon > 0 ? ` + ₹${fullResults.coupon.toLocaleString()} coupon` : ''})
                                                    </span>
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Offer Tip Banner */}
                                    {property.fullPaymentDiscount?.active && durationMonths < (property.fullPaymentDiscount?.minMonths || 3) && (
                                        <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl flex items-start gap-3">
                                            <FiTag className="text-orange-600 shrink-0 mt-0.5" />
                                            <p className="text-[10px] md:text-xs text-orange-800 font-medium">
                                                Tip: Stay for <span className="font-bold">{property.fullPaymentDiscount.minMonths || 3} months</span> or more and pay in full to get <span className="font-bold">{property.fullPaymentDiscount.type === 'flat' ? '₹' : ''}{property.fullPaymentDiscount.amount}{property.fullPaymentDiscount.type === 'percentage' ? '%' : ''} off</span>!
                                            </p>
                                        </div>
                                    )}

                                    {/* Voucher Section */}
                                    <div className="border border-gray-100 rounded-xl md:rounded-2xl overflow-hidden">
                                        <button
                                            onClick={() => setShowVoucher(!showVoucher)}
                                            className="w-full flex items-center justify-between p-3 md:p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="flex items-center gap-2 md:gap-3">
                                                <FiTag className="text-orange-600" />
                                                <span className="font-bold text-xs md:text-sm text-gray-900">Voucher & Offers</span>
                                            </div>
                                            {showVoucher ? <FiChevronUp /> : <FiChevronDown />}
                                        </button>
                                        <AnimatePresence>
                                            {showVoucher && (
                                                <motion.div
                                                    initial={{ height: 0 }}
                                                    animate={{ height: 'auto' }}
                                                    exit={{ height: 0 }}
                                                    className="overflow-hidden bg-white"
                                                >
                                                    <div className="p-3 md:p-4 space-y-3">
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="text"
                                                                name="bookingOfferCode"
                                                                value={offerCode}
                                                                onChange={(e) => setOfferCode(e.target.value.toUpperCase())}
                                                                placeholder="Enter code"
                                                                className="flex-1 h-[40px] md:h-[44px] px-3 md:px-4 bg-gray-50 border border-gray-200 rounded-lg md:rounded-xl font-bold text-[12px] md:text-sm outline-none focus:border-orange-500 focus:bg-white transition-all"
                                                            />
                                                            <button
                                                                onClick={handleApplyOffer}
                                                                disabled={isApplyingOffer || !offerCode}
                                                                className="px-4 h-[40px] md:h-[44px] bg-gray-900 text-white rounded-lg md:rounded-xl font-bold text-[10px] md:text-xs uppercase tracking-wider hover:bg-black transition-colors disabled:opacity-50"
                                                            >
                                                                {isApplyingOffer ? '...' : 'Apply'}
                                                            </button>
                                                        </div>
                                                        {appliedOffer && (
                                                            <div className="flex items-center justify-between p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                                                                <span className="text-[10px] font-bold text-blue-700">Applied: {appliedOffer.code}</span>
                                                                <button onClick={handleRemoveOffer} className="text-[10px] font-bold text-red-500 hover:text-red-600">Remove</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    <div className="pt-2 flex gap-3">
                                        <button
                                            onClick={() => setStep(1)}
                                            className="px-4 md:px-6 h-[48px] md:h-14 rounded-xl md:rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                                        >
                                            <FiArrowLeft size={18} />
                                        </button>
                                        <button
                                            onClick={() => setStep(3)} // To Details
                                            className="flex-1 h-[48px] md:h-14 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-xl md:rounded-2xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
                                        >
                                            <span className="text-[12px] md:text-base tracking-[0.5px] uppercase md:normal-case">Confirm Details</span>
                                            <FiArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {/* STEP 3: OCCUPANT DETAILS */}
                            {step === 3 && (
                                <motion.div
                                    key="step3"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-6"
                                >
                                    <div className="bg-amber-50 border border-amber-100 rounded-xl md:rounded-2xl p-3 md:p-4 mb-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <FiLock className="text-amber-600" size={14} />
                                            <span className="text-[10px] md:text-xs font-bold text-amber-700 uppercase tracking-wider">Sandbox Test Mode</span>
                                        </div>
                                        <p className="text-[10px] md:text-xs text-amber-600 font-medium leading-relaxed">
                                            <span className="font-bold">UPI ONLY:</span> For testing, click <span className="font-bold underline">"Use"</span> next to <span className="font-bold">testsuccess@gocash</span> in the payment window.
                                        </p>
                                    </div>

                                    <div className="bg-orange-50/80 rounded-xl md:rounded-2xl p-3 md:p-4 flex items-center gap-3">
                                        <div className="w-8 h-8 md:w-10 md:h-10 bg-white rounded-full flex items-center justify-center text-orange-600 shadow-sm shrink-0">
                                            <FiUser size={16} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-900 text-xs md:text-sm">Who's Checking In?</p>
                                            <p className="text-[10px] md:text-xs text-gray-500">Please confirm your details</p>
                                        </div>
                                    </div>

                                    <div className="space-y-3 md:space-y-4">
                                        <div className="space-y-1">
                                            <label htmlFor="occupant-full-name" className="text-[10px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Full Name</label>
                                            <div className="relative">
                                                <FiUser className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                                <input
                                                    id="occupant-full-name"
                                                    name="occupantName"
                                                    type="text"
                                                    value={occupantName}
                                                    onChange={(e) => setOccupantName(e.target.value)}
                                                    className="w-full h-[48px] md:h-14 pl-9 pr-4 md:pl-10 md:pr-4 bg-gray-50 border border-gray-100 rounded-xl md:rounded-xl font-bold text-[14px] md:text-base text-gray-900 outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-500 focus:bg-white transition-all"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                                            <div className="space-y-1">
                                                <label htmlFor="occupant-phone" className="text-[10px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Phone</label>
                                                <div className="relative">
                                                    <FiPhone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                                    <input
                                                        id="occupant-phone"
                                                        name="occupantPhone"
                                                        type="tel"
                                                        value={occupantPhone}
                                                        onChange={(e) => setOccupantPhone(e.target.value)}
                                                        className="w-full h-[48px] md:h-14 pl-9 pr-4 md:pl-10 md:pr-4 bg-gray-50 border border-gray-100 rounded-xl md:rounded-xl font-bold text-[14px] md:text-base text-gray-900 outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-500 focus:bg-white transition-all"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <label htmlFor="occupant-email" className="text-[10px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Email</label>
                                                <div className="relative">
                                                    <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                                    <input
                                                        id="occupant-email"
                                                        name="occupantEmail"
                                                        type="email"
                                                        value={occupantEmail}
                                                        onChange={(e) => setOccupantEmail(e.target.value)}
                                                        className="w-full h-[48px] md:h-14 pl-9 pr-4 md:pl-10 md:pr-4 bg-gray-50 border border-gray-100 rounded-xl md:rounded-xl font-bold text-[14px] md:text-base text-gray-900 outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-500 focus:bg-white transition-all"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleProceedToPayment}
                                        disabled={loading}
                                        className="w-full h-[54px] bg-gray-900 text-white rounded-2xl font-bold uppercase tracking-widest text-[11px] shadow-xl shadow-gray-200 hover:bg-black transition-all flex items-center justify-center gap-2"
                                    >
                                        {loading ? 'Initiating...' : 'Proceed to Payment'} <FiArrowRight />
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>

                {/* CONFLICT ERROR MODAL (NON-DISMISSIBLE) */}
                {normalizedConflictError && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.18),rgba(15,23,42,0.88)_55%)] backdrop-blur-xl"
                        />
                        <motion.div
                            initial={{ scale: 0.94, opacity: 0, y: 18 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            className={`relative w-full max-w-md overflow-hidden rounded-[32px] border shadow-[0_32px_90px_rgba(15,23,42,0.28)] ${normalizedConflictError.panelClass}`}
                        >
                            <div className={`h-2 w-full bg-gradient-to-r ${normalizedConflictError.accentClass}`} />
                            <div className="p-7 text-center">
                                <div className={`mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] border shadow-sm ${normalizedConflictError.badgeClass}`}>
                                    <normalizedConflictError.Icon className="text-[34px]" />
                                </div>

                                <div className="mb-3 inline-flex items-center rounded-full border border-white/70 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 shadow-sm">
                                    Booking Notice
                                </div>

                                <h3 className="px-3 text-[28px] font-black leading-[1.05] tracking-tight text-slate-950">
                                    {normalizedConflictError.title}
                                </h3>

                                <p className="mt-4 px-2 text-[15px] font-semibold leading-7 text-slate-600">
                                    {normalizedConflictError.description}
                                </p>

                                {normalizedConflictError.isVacatePending && (
                                    <div className="mt-5 rounded-[24px] border border-amber-100 bg-white/90 px-4 py-4 text-left shadow-sm">
                                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-600">Why This Is Locked</p>
                                        <p className="mt-2 text-[14px] font-medium leading-6 text-slate-600">
                                            Another booking can start only after the owner approves your vacate request and releases your current stay.
                                        </p>
                                    </div>
                                )}

                                <div className="mt-7 space-y-3">
                                    <button
                                        onClick={() => navigate('/bookings')}
                                        className={`w-full rounded-[20px] bg-gradient-to-r px-5 py-4 text-[12px] font-black uppercase tracking-[0.18em] text-white shadow-lg transition-all hover:scale-[1.01] active:scale-[0.98] ${normalizedConflictError.accentClass}`}
                                    >
                                        {normalizedConflictError.primaryLabel}
                                    </button>
                                    <button
                                        onClick={() => setConflictError(null)}
                                        className="w-full rounded-[20px] border border-slate-200 bg-white px-5 py-4 text-[12px] font-black uppercase tracking-[0.18em] text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                                    >
                                        {normalizedConflictError.secondaryLabel}
                                    </button>
                                </div>
                            </div>
                            <div className="border-t border-slate-200/70 bg-slate-50/80 px-6 py-4 text-center">
                                <p className="text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase">
                                    RoomFindR Protection keeps one active stay at a time
                                </p>
                            </div>
                        </motion.div>
                    </div>
                )}

            </div>
            <PaymentErrorOverlay
                key="booking-payment-error"
                open={showPaymentError}
                message={paymentError || 'Payment could not be started. Please try again.'}
                onClose={() => setShowPaymentError(false)}
                onGoBookings={() => {
                    setShowPaymentError(false);
                    navigate('/bookings');
                }}
                onViewDetails={() => {
                    const params = new URLSearchParams();
                    if (paymentError) params.set('message', paymentError);
                    params.set('context', 'booking');
                    navigate(`/payment/error?${params.toString()}`);
                }}
            />
        </AnimatePresence>
    );
};

