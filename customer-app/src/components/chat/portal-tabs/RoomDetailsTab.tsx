import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { FaUsers, FaSnowflake, FaWifi, FaTv, FaBath, FaWindowMaximize, FaExclamationCircle, FaMapMarkerAlt, FaComment } from 'react-icons/fa';
import { bookingService } from '../../../services/booking.service';
import type { Booking } from '../../../types/booking.types';
import type { Property, Room } from '../../../types/property.types';
import { formatResidentDate, startRoommateChat, type Roommate } from './roommateUtils';

interface RoomDetailsTabProps {
    booking: Booking;
    property: Property;
    currentUser: User | null;
}

const RoomDetailsTab = ({ booking, property, currentUser }: RoomDetailsTabProps) => {
    const navigate = useNavigate();
    const [roommates, setRoommates] = useState<Roommate[]>([]);
    const [fetchingRoommates, setFetchingRoommates] = useState(!!booking?.customerId);

    // 👥 Real-time subscription to roommates
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

    // 🔍 Find the current room from property.rooms record or use a fallback
    let room: Room | undefined = property?.rooms ? property.rooms[booking?.roomId] : undefined;

    // Fallback 1: Try to find by room number if ID lookup fails
    if (!room && property?.rooms) {
        room = Object.values(property.rooms).find(r => r.roomNumber === booking?.roomNumber);
    }

    // Fallback 2: Create a virtual room if we have a room number but no database record
    if (!room && (booking?.roomNumber || booking?.roomId)) {
        room = {
            roomId: booking?.roomId || 'generic',
            roomNumber: booking?.roomNumber || 'Assigned',
            type: 'Shared',
            price: booking?.monthlyRent || 0,
            capacity: 3,
            bookedCount: (roommates?.length || 0) + 1, // Start with Others + Me
            availableCount: 2,
            status: 'available',
            amenities: ['Wifi', 'Water Purifier', 'Cleaning'],
            images: property?.images?.length > 0 ? [property.images[0]] : []
        };
    }

    // 🔄 SYNC COUNT: Ensure our local room object matches the reality of checked-in residents
    const enrichedRoom = room ? {
        ...room,
        bookedCount: (roommates?.length || 0) + 1
    } : undefined;

    const roomAmenities = [
        { label: 'High-speed Wifi', icon: FaWifi, active: property?.features?.wifi },
        { label: 'Air Conditioning', icon: FaSnowflake, active: property?.features?.ac || enrichedRoom?.amenities?.includes('AC') },
        { label: 'Smart TV', icon: FaTv, active: enrichedRoom?.amenities?.includes('TV') },
        { label: 'Attached Bath', icon: FaBath, active: true },
        { label: 'Large Window', icon: FaWindowMaximize, active: true },
    ];

    if (!enrichedRoom) {
        return (
            <div className="p-8 text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                    <FaExclamationCircle className="text-blue-500 animate-pulse" size={32} />
                </div>
                <h3 className="text-[18px] font-bold text-[#111827]">Room details pending</h3>
                <p className="text-[14px] text-[#6B7280] mt-1">Your room assignment is being finalized by management.</p>
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4 font-['Inter',_sans-serif] animate-in fade-in duration-500">
            {/* 🧱 MAIN ROOM CARD (UNIFIED DESIGN) */}
            <div className="w-full h-[180px] rounded-[24px] bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-6 text-white shadow-xl relative overflow-hidden flex flex-col justify-between border border-white/5">
                <div className="relative z-10">
                    <h2 className="text-[22px] font-black leading-tight tracking-tight">Suite {enrichedRoom.roomNumber}</h2>
                    <p className="flex items-center text-blue-100/70 text-[13px] mt-2 font-medium">
                        <FaMapMarkerAlt className="mr-2 shrink-0 text-blue-400" size={14} />
                        <span className="truncate">{property?.title || 'Property Name'}</span>
                    </p>
                </div>

                <div className="relative z-10 flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Accommodation</span>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            <span className="text-[15px] font-black">{enrichedRoom.type} Room</span>
                        </div>
                    </div>

                    {/* Bed Badge */}
                    <div className="w-[60px] h-[60px] bg-white/10 backdrop-blur-md border border-white/20 rounded-[18px] flex flex-col items-center justify-center shadow-inner">
                        <span className="text-[10px] font-black text-white/50 leading-none mb-1 uppercase tracking-tighter">Bed</span>
                        <span className="text-[20px] font-black text-white leading-none">#1</span>
                    </div>
                </div>

                <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl" />
            </div>

            {/* 👥 Residents Section */}
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

            {/* 🛠 Room Amenities */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm p-6">
                <h3 className="text-[17px] font-black text-[#111827] mb-5">In-Room Features</h3>
                <div className="grid grid-cols-2 gap-3">
                    {roomAmenities.map((amenity, idx) => (
                        <div key={idx} className={`p-4 rounded-[20px] flex flex-col gap-3 border transition-all ${amenity.active ? 'bg-white border-gray-100 shadow-sm' : 'bg-gray-50/30 border-transparent opacity-40'}`}>
                            <div className={`w-10 h-10 rounded-[14px] flex items-center justify-center ${amenity.active ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                                <amenity.icon size={16} />
                            </div>
                            <span className="text-[12px] font-black text-[#111827] leading-tight">{amenity.label}</span>
                        </div>
                    ))}
                </div>
            </div>

        </div>
    );
};

export default RoomDetailsTab;
