import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiUser, FiEye, FiLogOut, FiPhone, FiCalendar, FiChevronDown, FiAlertCircle } from 'react-icons/fi';
import type { Booking } from '../../types/booking.types';
import { format } from 'date-fns';

interface GroupedRoomCardProps {
    roomNumber: string;
    propertyTitle: string;
    capacity: number;
    bookings: Booking[];
    isExpanded: boolean;
    onToggle: () => void;
    onCheckOut: (bookingId: string, propertyId: string, roomId: string) => void;
    onViewDetails: (booking: Booking) => void;
}

const GroupedRoomCard: React.FC<GroupedRoomCardProps> = ({
    roomNumber,
    propertyTitle,
    capacity,
    bookings,
    isExpanded,
    onToggle,
    onCheckOut,
    onViewDetails
}) => {
    const membersPresent = bookings.length;
    const vacancy = Math.max(0, capacity - membersPresent);
    const isFull = vacancy === 0;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`
                relative bg-white rounded-[20px] border transition-all duration-300 overflow-hidden
                ${isFull ? 'border-red-100 shadow-[0_8px_30px_rgb(254,202,202,0.3)]' : 'border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]'}
                ${isExpanded ? 'shadow-[0_20px_40px_rgb(0,0,0,0.12)] -translate-y-1' : 'hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] hover:-translate-y-1'}
            `}
        >
            {/* Red Pulse Border for Full Rooms */}
            {isFull && (
                <div className="absolute inset-0 rounded-[20px] ring-2 ring-red-500/20 animate-pulse pointer-events-none" />
            )}

            {/* Header Section */}
            <div
                className="p-5 cursor-pointer"
                onClick={onToggle}
            >
                <div className="flex justify-between items-start gap-3">
                    <div className="flex gap-4 items-center">
                        {/* Room Badge */}
                        <div className={`
                            w-[52px] h-[52px] rounded-xl flex items-center justify-center shadow-lg
                            bg-gradient-to-br ${isFull ? 'from-red-500 to-rose-600' : 'from-blue-500 to-indigo-600'}
                        `}>
                            <span className="text-white font-black text-lg tracking-tighter shadow-sm">
                                {roomNumber}
                            </span>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-gray-900 leading-tight mb-0.5">
                                Room {roomNumber}
                            </h3>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate max-w-[150px]">
                                {propertyTitle}
                            </p>
                        </div>
                    </div>

                    {/* Stats Pills */}
                    <div className="flex flex-col items-end gap-1.5">
                        <div className={`
                            px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide flex items-center gap-1 shadow-sm
                            bg-blue-50 text-blue-700 border border-blue-100
                        `}>
                            <FiUser size={10} className="stroke-[3px]" />
                            {membersPresent} Present
                        </div>

                        <div className={`
                            px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide shadow-sm flex items-center gap-1
                            ${isFull
                                ? 'bg-red-50 text-red-600 border border-red-100'
                                : 'bg-blue-50 text-blue-600 border border-blue-100 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                            }
                        `}>
                            {isFull ? (
                                <>
                                    <FiAlertCircle size={10} className="stroke-[3px]" />
                                    Full
                                </>
                            ) : (
                                <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                    {vacancy} Vacancy
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Expand Indicator */}
                <div className="flex justify-center mt-1 group relative">
                    <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        className="p-1 rounded-full bg-gray-50 text-gray-400 group-hover:bg-gray-100 group-hover:text-gray-600 transition-colors"
                    >
                        <FiChevronDown size={18} />
                    </motion.div>
                </div>
            </div>

            {/* Accordion Content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                        className="bg-gray-50/50 border-t border-gray-100"
                    >
                        <div className="p-4 space-y-3">
                            {bookings.map((booking) => (
                                (() => {
                                    const start = new Date(booking.startDate);
                                    const end = new Date(booking.endDate);
                                    const paymentBadge = (
                                        <div className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${booking.paymentStatus === 'paid' ? 'bg-blue-50 text-blue-700' : 'bg-yellow-50 text-yellow-700'
                                            }`}>
                                            {booking.paymentStatus.toUpperCase()}
                                        </div>
                                    );
                                    const actionButtons = (
                                        <>
                                            <ActionButton
                                                icon={<FiEye size={16} />}
                                                onClick={() => onViewDetails(booking)}
                                                color="gray"
                                                tooltip="Details"
                                            />
                                            <ActionButton
                                                icon={<FiLogOut size={16} />}
                                                onClick={() => onCheckOut(booking.bookingId, booking.propertyId, booking.roomId)}
                                                color="red"
                                                tooltip="Check Out"
                                            />
                                        </>
                                    );

                                    return (
                                        <motion.div
                                            key={booking.bookingId}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all group flex flex-col md:flex-row items-center gap-4"
                                        >
                                            {/* Mobile resident summary */}
                                            <div className="flex w-full items-start gap-3 md:hidden">
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-500 font-bold text-lg border-2 border-white shadow-sm shrink-0">
                                                    {booking.customerName.charAt(0)}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="truncate text-sm font-black text-gray-900">{booking.customerName}</h4>
                                                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                                                        <FiPhone size={10} />
                                                        <span className="truncate">{booking.customerPhone}</span>
                                                    </div>
                                                </div>
                                                <div className="shrink-0 space-y-1 text-right">
                                                    <div className="flex items-center justify-end gap-1 text-[10px] font-black text-gray-800">
                                                        <FiCalendar size={10} className="text-gray-400" />
                                                        {format(start, 'MMM d, yyyy')}
                                                    </div>
                                                    <div className="text-[10px] font-black text-gray-800">
                                                        {format(end, 'MMM d, yyyy')}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Desktop avatar & info */}
                                            <div className="hidden items-center gap-4 w-full md:w-auto flex-1 md:flex">
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-500 font-bold text-lg border-2 border-white shadow-sm shrink-0">
                                                    {booking.customerName.charAt(0)}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-gray-900">{booking.customerName}</h4>
                                                    <div className="flex items-center gap-2 text-xs text-gray-500 font-medium mt-0.5">
                                                        <FiPhone size={10} />
                                                        <span>{booking.customerPhone}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Desktop dates & status */}
                                            <div className="hidden md:flex flex-col items-end w-auto gap-0.5">
                                                <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                                                    <FiCalendar size={12} className="text-gray-400" />
                                                    {format(start, 'MMM d')} - {format(end, 'MMM d, yyyy')}
                                                </span>
                                                {paymentBadge}
                                            </div>

                                            {/* Mobile payment & actions */}
                                            <div className="flex w-full items-center justify-between border-t border-gray-50 pt-3 md:hidden">
                                                {paymentBadge}
                                                <div className="flex items-center gap-2">
                                                    {actionButtons}
                                                </div>
                                            </div>

                                            {/* Desktop actions */}
                                            <div className="hidden items-center gap-2 w-auto justify-end md:flex">
                                                {actionButtons}
                                            </div>
                                        </motion.div>
                                    );
                                })()
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

interface ActionButtonProps {
    icon: React.ReactNode;
    onClick: () => void;
    color: 'blue' | 'red' | 'gray';
    tooltip: string;
}

// Helper Subcomponent for Buttons
const ActionButton = ({ icon, onClick, color, tooltip }: ActionButtonProps) => {
    const colors: Record<'blue' | 'red' | 'gray', string> = {
        blue: "text-blue-600 hover:bg-blue-50 border-blue-100",
        red: "text-rose-600 hover:bg-rose-50 border-rose-100",
        gray: "text-gray-600 hover:bg-gray-100 border-gray-200"
    };

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            title={tooltip}
            className={`
                w-9 h-9 rounded-full flex items-center justify-center border bg-white shadow-sm transition-all duration-200
                ${colors[color]} hover:scale-110 active:scale-95
            `}
        >
            {icon}
        </button>
    );
};

export default GroupedRoomCard;

