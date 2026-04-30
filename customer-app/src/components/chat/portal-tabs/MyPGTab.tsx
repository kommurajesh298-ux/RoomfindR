import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import type { Booking } from '../../../types/booking.types';
import type { Property } from '../../../types/property.types';
import type { Owner } from '../../../types/owner.types';
import { FaMapMarkerAlt, FaCalendarAlt, FaMoneyBillWave, FaShieldAlt, FaUsers, FaComment } from 'react-icons/fa';
import { bookingService } from '../../../services/booking.service';
import { toast } from 'react-hot-toast';
import VacateWarningModal from '../../bookings/VacateWarningModal';
import { getRemainingVacateDays } from '../../../utils/vacate';
import { resolveRentCoverageSummary } from '../../../utils/rent-coverage';
import { formatResidentDate, startRoommateChat, type Roommate } from './roommateUtils';

interface MyPGTabProps {
    booking: Booking;
    property: Property;
    owner: Owner | null;
    currentUser: User | null;
}

const MyPGTab: React.FC<MyPGTabProps> = ({ booking, property, owner, currentUser }) => {
    const navigate = useNavigate();
    const [roommates, setRoommates] = useState<Roommate[]>([]);
    const [fetchingRoommates, setFetchingRoommates] = useState(!!booking?.customerId);
    const [showVacateWarning, setShowVacateWarning] = useState(false);
    const [sendingVacateRequest, setSendingVacateRequest] = useState(false);
    const vacateReferenceDueDate = resolveRentCoverageSummary({
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
        cycleDurationDays: booking.cycleDurationDays
    }).effectiveNextDueDate;

    // Real-time subscription to roommates
    useEffect(() => {
        if (booking?.customerId) {
            const unsubscribe = bookingService.subscribeToRoommates(
                booking.roomId,
                booking.customerId,
                (data) => {
                    setRoommates(data || []);
                    setFetchingRoommates(false);
                },
                booking.propertyId,
                booking.roomNumber
            );
            return () => unsubscribe();
        }
    }, [booking.roomId, booking.customerId, booking.propertyId, booking.roomNumber]);

    return (
        <div className="px-3 pb-3 pt-3 space-y-3 font-['Inter',_sans-serif] animate-in fade-in duration-500">
            <VacateWarningModal
                open={showVacateWarning}
                remainingDays={getRemainingVacateDays(vacateReferenceDueDate ? vacateReferenceDueDate.toISOString() : null)}
                onClose={() => {
                    if (sendingVacateRequest) return;
                    setShowVacateWarning(false);
                }}
                onConfirm={async () => {
                    try {
                        setSendingVacateRequest(true);
                        await bookingService.vacateBooking(booking.bookingId);
                        toast.success('Vacate request sent! Waiting for approval.');
                        setShowVacateWarning(false);
                        window.location.reload();
                    } catch (error) {
                        console.error('Vacate error:', error);
                        toast.error('Failed to send vacate request');
                    } finally {
                        setSendingVacateRequest(false);
                    }
                }}
                isSubmitting={sendingVacateRequest}
            />
            {/* MAIN PG CARD (ANDROID STANDARDIZED) */}
            <div className="w-full h-[172px] rounded-[24px] bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-5 text-white shadow-xl relative overflow-hidden flex flex-col justify-between border border-white/5">
                <div className="relative z-10">
                    <h2 className="rfm-pg-title-single-line text-[22px] font-black leading-tight tracking-tight" title={property?.title || 'My PG'}>{property?.title || 'My PG'}</h2>
                    <p className="flex items-center text-blue-100/70 text-[13px] mt-2 font-medium">
                        <FaMapMarkerAlt className="mr-2 shrink-0 text-blue-400" size={14} />
                        <span className="truncate">{property?.address?.text?.split(',')[0] || 'Address not available'}</span>
                    </p>
                </div>

                <div className="relative z-10 flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Active Stay</span>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            <span className="text-[15px] font-black">
                                {booking?.startDate ? `Resident since ${formatResidentDate(booking.startDate, 'MMM yyyy')}` : 'Active Resident'}
                            </span>
                        </div>
                    </div>

                    <div className="w-[60px] h-[60px] bg-white/10 backdrop-blur-md border border-white/20 rounded-[18px] flex flex-col items-center justify-center shadow-inner">
                        <span className="text-[10px] font-black text-white/50 leading-none mb-1 uppercase tracking-tighter">Room</span>
                        <span className="text-[20px] font-black text-white leading-none">
                            {booking?.roomNumber || booking?.roomId?.slice(-2).toUpperCase() || '??'}
                        </span>
                    </div>
                </div>

                <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl" />
            </div>

            {/* INFO CARDS (ANDROID STANDARDIZED) */}
            <div className="grid grid-cols-2 gap-2.5">
                <div className="h-[86px] bg-white rounded-[20px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <div className="w-8 h-8 rounded-[10px] bg-blue-50 flex items-center justify-center">
                        <FaCalendarAlt className="text-blue-600" size={16} />
                    </div>
                    <div>
                        <p className="text-[10px] text-[#6B7280] font-black uppercase tracking-wider leading-none mb-1.5">Join Date</p>
                        <p className="text-[15px] font-black text-[#111827] leading-none">
                            {formatResidentDate(booking?.startDate, 'dd MMM yyyy')}
                        </p>
                    </div>
                </div>

                <div className="h-[86px] bg-white rounded-[20px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <div className="w-8 h-8 rounded-[10px] bg-blue-50 flex items-center justify-center">
                        <FaMoneyBillWave className="text-blue-600" size={16} />
                    </div>
                    <div>
                        <p className="text-[10px] text-[#6B7280] font-black uppercase tracking-wider leading-none mb-1.5">Monthly Rent</p>
                        <p className="text-[15px] font-black text-[#111827] leading-none">₹{property?.pricePerMonth?.toLocaleString() || '0'}</p>
                    </div>
                </div>

                <div className="h-[86px] bg-white rounded-[20px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <div className="w-8 h-8 rounded-[10px] bg-orange-50 flex items-center justify-center">
                        <FaShieldAlt className="text-orange-500" size={16} />
                    </div>
                    <div>
                        <p className="text-[10px] text-[#6B7280] font-black uppercase tracking-wider leading-none mb-1.5">Advance Amount</p>
                        <p className="text-[15px] font-black text-[#111827] leading-none">₹{booking?.advancePaid?.toLocaleString() || '0'}</p>
                    </div>
                </div>

                <div className="h-[86px] bg-white rounded-[20px] p-[14px] border border-gray-100 shadow-sm flex flex-col justify-between">
                    <div className="w-8 h-8 rounded-[10px] bg-purple-50 flex items-center justify-center">
                        <FaMapMarkerAlt className="text-purple-600" size={16} />
                    </div>
                    <div>
                        <p className="text-[10px] text-[#6B7280] font-black uppercase tracking-wider leading-none mb-1.5">Area</p>
                        <p className="text-[15px] font-black text-[#111827] leading-none truncate">{property?.city || 'Unknown'}</p>
                    </div>
                </div>
            </div>

            {/* Property Manager (Polished) */}
            {owner && (
                <div className="bg-white rounded-[24px] border border-gray-100 p-5 shadow-sm flex items-center gap-4">
                    <div className="relative">
                        <img
                            src={owner.profilePhotoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(owner.name)}&background=3B82F6&color=fff`}
                            alt={owner.name}
                            className="w-[56px] h-[56px] rounded-[18px] object-cover border-2 border-white shadow-md"
                        />
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-blue-500 border-2 border-white rounded-full flex items-center justify-center">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                        </div>
                    </div>
                    <div className="flex-1">
                        <p className="text-[10px] text-[#6B7280] font-black uppercase tracking-[0.1em]">Property Manager</p>
                        <h3 className="text-[17px] font-black text-[#111827] leading-tight mt-0.5">{owner.name}</h3>
                        <p className="text-[13px] font-bold text-blue-600 mt-0.5">{owner.phone}</p>
                    </div>
                </div>
            )}

            {/* Residents Section */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm p-6">
                <div className="flex justify-between items-center mb-5">
                    <h3 className="text-[17px] font-black text-[#111827] flex items-center gap-2">
                        <FaUsers className="text-blue-500" />
                        Residents ({roommates.length})
                    </h3>
                    {fetchingRoommates && <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />}
                </div>

                <div className="space-y-4">
                    {roommates.length > 0 ? (
                        roommates.map((member, idx) => (
                            <div key={idx} className={`flex items-center gap-4 p-3 rounded-[20px] border transition-colors ${member.is_me ? 'bg-blue-50/50 border-blue-100' : 'bg-gray-50/50 border-transparent hover:border-blue-100'}`}>
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-100 to-blue-50 flex items-center justify-center border-2 border-white shadow-sm shrink-0">
                                    <span className="text-indigo-600 font-black text-[15px]">
                                        {member.customer_name?.charAt(0) || 'R'}
                                    </span>
                                </div>
                                <div className="flex-1">
                                    <p className="text-[15px] font-black text-[#111827] leading-tight">
                                        {member.customer_name} {member.is_me && <span className="text-[11px] text-blue-600 ml-1">(You)</span>}
                                    </p>
                                    <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider mt-0.5">
                                        Resident since {member.created_at ? formatResidentDate(member.created_at, 'MMM yyyy') : 'Recently'}
                                    </p>
                                </div>
                                {!member.is_me && member.customer_id && (
                                    <button
                                        onClick={() => void startRoommateChat(currentUser, member, navigate)}
                                        className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center active:scale-90 transition-all border border-blue-100"
                                        title="Chat with roommate"
                                    >
                                        <FaComment size={16} />
                                    </button>
                                )}
                            </div>
                        ))
                    ) : !fetchingRoommates && (
                        <div className="flex flex-col items-center py-6 text-center">
                            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                <FaUsers className="text-gray-300" size={20} />
                            </div>
                            <p className="text-[13px] font-bold text-gray-400">
                                No residents recorded yet.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* PG Guidelines */}
            <div className="bg-white rounded-[24px] border border-gray-100 p-6 shadow-sm">
                <h3 className="text-[17px] font-black text-[#111827] mb-5">PG Guidelines</h3>
                <div className="grid gap-4">
                    {[
                        "Quiet hours: 10 PM - 7 AM",
                        "No smoking inside rooms",
                        "Inform admin for late entry",
                        "Keep common areas clean",
                        "Visitors not allowed after 8 PM"
                    ].map((rule, i) => (
                        <div key={i} className="flex items-start gap-4 p-3 bg-gray-50/50 rounded-2xl border border-transparent">
                            <div className="w-8 h-8 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0 shadow-sm">
                                <span className="text-[13px] font-black text-blue-600">{i + 1}</span>
                            </div>
                            <span className="text-[14px] text-[#475569] font-semibold leading-relaxed pt-1.5">{rule}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* VACATE ACTION */}
            <div className="bg-white rounded-[24px] border border-gray-100 p-6 shadow-sm">
                <h3 className="text-[17px] font-black text-[#111827] mb-2">Vacate PG</h3>

                {(booking.vacateDate && booking.status === 'checked-in') ? (
                    <div className="bg-orange-50 border border-orange-100 rounded-[18px] p-4 flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-xl">⏳</span>
                        </div>
                        <div>
                            <p className="text-[14px] font-black text-orange-800">Request Pending</p>
                            <p className="text-[12px] text-orange-600 font-medium">Waiting for owner approval.</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <p className="text-[13px] text-gray-500 mb-4 font-medium">
                            Planning to leave? Initiate a vacate request to inform the owner.
                        </p>
                        <button
                            onClick={() => setShowVacateWarning(true)}
                            className="w-full h-[50px] bg-red-50 text-red-600 font-black rounded-[18px] uppercase tracking-widest text-[12px] hover:bg-red-100 transition-colors border border-red-100 shadow-sm flex items-center justify-center gap-2"
                        >
                            Request Vacate
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default MyPGTab;

