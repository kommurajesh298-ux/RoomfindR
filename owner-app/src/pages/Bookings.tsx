import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    IoNotificationsOutline,
    IoBookOutline,
    IoAlertCircleOutline,
    IoChevronDownOutline
} from 'react-icons/io5';
import { useAuth } from '../hooks/useAuth';
import { bookingService } from '../services/booking.service';
import { propertyService } from '../services/property.service';
import type { Booking, BookingWithDetails } from '../types/booking.types';
import type { Property } from '../types/property.types';

import BookingCard from '../components/bookings/BookingCard';
import BookingCardSkeleton from '../components/bookings/BookingCardSkeleton';
import toast from 'react-hot-toast';
import RejectModal from '../components/bookings/RejectModal';
import BookingDetailsModal from '../components/bookings/BookingDetailsModal';
import BroadcastNotificationModal from '../components/bookings/BroadcastNotificationModal';
import VacancyManager from '../components/bookings/VacancyManager';
import GroupedRoomCard from '@components/bookings/GroupedRoomCard';
import PropertyPickerModal from '../components/bookings/PropertyPickerModal';
import { IoSearchOutline, IoFilterCircleOutline } from 'react-icons/io5';

const TABS = [
    { id: 'pending', label: 'Requests' },
    { id: 'approved', label: 'Approved' },
    { id: 'checked-in', label: 'Active' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'checked-out', label: 'History' },
    { id: 'rejected', label: 'Rejected' }
] as const;

type TabId = typeof TABS[number]['id'];

const normalizeStatus = (status?: string) =>
    String(status || '').toLowerCase().replace(/_/g, '-');

const hasVacateRequest = (booking: Booking) => {
    const status = normalizeStatus(booking.status);
    const stayStatus = normalizeStatus(booking.stayStatus);
    return status === 'vacate-requested' ||
        stayStatus === 'vacate-requested' ||
        (status === 'checked-in' && !!booking.vacateDate);
};

const isPendingBooking = (booking: Booking) => {
    const status = normalizeStatus(booking.status);
    const paymentStatus = normalizeStatus(booking.paymentStatus);
    if (hasVacateRequest(booking)) return true;
    if (!['requested', 'pending', 'payment-pending', 'paid'].includes(status)) return false;
    return ['paid', 'completed', 'success', 'authorized', 'verified'].includes(paymentStatus);
};

const isApprovedBooking = (booking: Booking) => {
    const status = normalizeStatus(booking.status);
    return ['approved', 'accepted', 'confirmed'].includes(status);
};

const isActiveBooking = (booking: Booking) => normalizeStatus(booking.status) === 'checked-in';

const isHistoryBooking = (booking: Booking) => {
    const status = normalizeStatus(booking.status);
    const stayStatus = normalizeStatus(booking.stayStatus);
    return ['checked-out', 'completed'].includes(status) || stayStatus === 'vacated';
};

const isCancelledBooking = (booking: Booking) => {
    const status = normalizeStatus(booking.status);
    return ['cancelled', 'cancelled-by-customer', 'refunded'].includes(status);
};

const isRejectedBooking = (booking: Booking) => normalizeStatus(booking.status) === 'rejected';

const Bookings: React.FC = () => {
    const { currentUser } = useAuth();
    const [activeTab, setActiveTab] = useState<TabId>('pending');
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showVacancyManager, setShowVacancyManager] = useState(false);
    const [roomStats, setRoomStats] = useState<Record<string, { capacity: number, bookedCount: number }>>({});
    const [expandedRoomIds, setExpandedRoomIds] = useState<Set<string>>(new Set());

    const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
    const [isPropertyPickerOpen, setIsPropertyPickerOpen] = useState(false);
    const [showSearch, setShowSearch] = useState(false);

    // Modal States
    const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isRejectOpen, setIsRejectOpen] = useState(false);
    const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    // Read URL params for tab switching
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        if (tab && TABS.some(t => t.id === tab)) {
            setActiveTab(tab as TabId);
        }
    }, [window.location.search]);

    useEffect(() => {
        if (!currentUser) return;

        // Subscribe to real-time properties for broadcast & filters
        const unsubscribeProps = propertyService.subscribeToOwnerProperties(currentUser.uid, (fetchedProperties) => {
            setProperties(fetchedProperties);
        });

        // Subscribe to real-time bookings
        // Subscribe to owner bookings
        const unsubscribeBookings = bookingService.subscribeToOwnerBookings(currentUser.uid, (fetchedBookings) => {
            // Bookings received and processed
            setBookings(fetchedBookings);
            setLoading(false);
        });

        return () => {
            unsubscribeProps();
            unsubscribeBookings();
        };
    }, [currentUser]);

    const filteredBookings = useMemo(() => {
        return bookings.filter(b => {
            const matchesTab = activeTab === 'pending'
                ? isPendingBooking(b)
                : activeTab === 'approved'
                    ? isApprovedBooking(b)
                    : activeTab === 'checked-in'
                        ? isActiveBooking(b)
                        : activeTab === 'checked-out'
                            ? isHistoryBooking(b)
                            : activeTab === 'cancelled'
                                ? isCancelledBooking(b)
                                : activeTab === 'rejected'
                                    ? isRejectedBooking(b)
                                    : false;
            // Simple search by ID or propertyId as we don't have customer names in the initial list
            const matchesSearch = b.bookingId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                b.propertyId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                b.roomNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                b.propertyTitle?.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesProperty = selectedPropertyId === 'all' || b.propertyId === selectedPropertyId;

            return matchesTab && matchesSearch && matchesProperty;
        });
    }, [bookings, activeTab, searchQuery, selectedPropertyId]);

    // Group everything by property for cleaner organization
    const propertySections = useMemo(() => {
        const propGroups: Record<string, { title: string, bookings: Booking[] }> = {};

        filteredBookings.forEach(booking => {
            const pid = booking.propertyId;
            if (!propGroups[pid]) {
                propGroups[pid] = {
                    title: booking.propertyTitle || 'Unknown Property',
                    bookings: []
                };
            }
            propGroups[pid].bookings.push(booking);
        });

        return Object.entries(propGroups).map(([propertyId, data]) => {
            if (activeTab === 'checked-in') {
                const roomGroups: Record<string, Booking[]> = {};
                data.bookings.forEach(b => {
                    const rid = b.roomId;
                    if (!roomGroups[rid]) roomGroups[rid] = [];
                    roomGroups[rid].push(b);
                });

                const sortedGroups = Object.values(roomGroups).sort((a, b) => {
                    const roomA = a[0].roomNumber || '';
                    const roomB = b[0].roomNumber || '';
                    return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: 'base' });
                });

                return {
                    propertyId,
                    title: data.title,
                    type: 'room-grouped' as const,
                    groups: sortedGroups
                };
            } else {
                return {
                    propertyId,
                    title: data.title,
                    type: 'individual' as const,
                    bookings: data.bookings
                };
            }
        }).sort((a, b) => a.title.localeCompare(b.title));
    }, [filteredBookings, activeTab]);

    // 🔄 REAL-TIME ROOM STATS: Keep room occupancy/capacity updated
    useEffect(() => {
        if (activeTab !== 'checked-in' || properties.length === 0) return;

        const unsubscribes = properties.map(prop =>
            propertyService.subscribeToRooms(prop.propertyId, (rooms) => {
                const newStats: Record<string, { capacity: number, bookedCount: number }> = {};
                rooms.forEach(room => {
                    const key = `${prop.propertyId}_${room.roomId}`;
                    newStats[key] = {
                        capacity: room.capacity,
                        bookedCount: room.bookedCount || 0
                    };
                });
                setRoomStats(prev => ({ ...prev, ...newStats }));
            })
        );

        return () => unsubscribes.forEach(unsub => unsub());
    }, [activeTab, properties]);

    const counts = useMemo(() => {
        return TABS.reduce((acc, tab) => {
            if (tab.id === 'cancelled') {
                acc[tab.id] = bookings.filter(isCancelledBooking).length;
            } else if (tab.id === 'checked-out') {
                acc[tab.id] = bookings.filter(isHistoryBooking).length;
            } else if (tab.id === 'pending') {
                acc[tab.id] = bookings.filter(isPendingBooking).length;
            } else if (tab.id === 'approved') {
                acc[tab.id] = bookings.filter(isApprovedBooking).length;
            } else if (tab.id === 'checked-in') {
                acc[tab.id] = bookings.filter(isActiveBooking).length;
            } else if (tab.id === 'rejected') {
                acc[tab.id] = bookings.filter(isRejectedBooking).length;
            }
            return acc;
        }, {} as Record<string, number>);
    }, [bookings]);

    // Handlers
    const handleAccept = async (id: string) => {
        try {
            const result = await bookingService.acceptBooking(id);
            toast.success('Booking accepted successfully!', {
                icon: '✅',
                style: {
                    borderRadius: '12px',
                    background: '#059669',
                    color: '#fff',
                    fontWeight: 'bold'
                },
            });
            if (result?.warning) {
                toast(result.warning, { icon: 'âš ï¸' });
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred');
        }
    };

    const handleReject = async (reason: string, details: string) => {
        if (!selectedBooking) return;
        setActionLoading(true);
        try {
            const result = await bookingService.rejectBooking(selectedBooking.bookingId, `${reason}: ${details}`);
            toast.success('Booking rejected successfully.');
            if (result.warning) {
                toast(result.warning, { icon: '⚠️' });
            }
            setIsRejectOpen(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'An error occurred';
            toast.error(message);
            throw error;
        } finally {
            setActionLoading(false);
        }
    };

    const handleCheckIn = async (id: string, propertyId: string, roomId: string) => {
        try {
            await bookingService.checkInBooking(id, propertyId, roomId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred');
        }
    };

    const handleCheckOut = async (id: string, propertyId: string, roomId: string) => {
        try {
            await bookingService.checkOutBooking(id, propertyId, roomId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred');
        }
    };

    const handleApproveVacate = async (id: string, roomId: string) => {
        setActionLoading(true);
        try {
            await bookingService.approveVacate(id, roomId);
            toast.success('Vacate approved successfully!', { icon: '✅' });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred');
        } finally {
            setActionLoading(false);
        }
    };

    const handleBroadcast = async (propertyId: string, title: string, message: string) => {
        setActionLoading(true);
        try {
            const count = await bookingService.sendPropertyNotification(propertyId, title, message);
            toast.success(`Sent notification to ${count} active residents.`);
        } catch {
            toast.error('Failed to send notifications');
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-24 md:pb-8">
            {/* Header Section */}
            <div className="bg-white border-b border-gray-100 sticky top-0 z-20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6">
                    <div className="flex justify-end">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    setShowVacancyManager((previous) => !previous);
                                    setIsBroadcastOpen(false);
                                }}
                                className={`flex-1 md:flex-none px-4 h-11 md:h-12 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${showVacancyManager
                                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-200'
                                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                                    }`}
                            >
                                <IoBookOutline /> Vacancy
                            </button>
                            <button
                                onClick={() => {
                                    setShowVacancyManager(false);
                                    setIsBroadcastOpen(true);
                                }}
                                className={`flex-1 md:flex-none px-4 h-11 md:h-12 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${isBroadcastOpen
                                    ? 'bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-200'
                                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                                    }`}
                            >
                                <IoNotificationsOutline size={18} /> Broadcast
                            </button>
                        </div>
                    </div>

                    {/* Search & Tabs Wrapper */}
                    <div className="mt-4 md:mt-6 flex items-center gap-3">
                        <div className="relative flex-none">
                            <button
                                onClick={() => setShowSearch(!showSearch)}
                                className={`w-11 h-11 flex items-center justify-center rounded-full transition-all ${showSearch ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                            >
                                <IoSearchOutline size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-x-auto pb-1 no-scrollbar">
                            <div className="flex items-center gap-1 min-w-max">
                                {TABS.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            setActiveTab(tab.id);
                                            if (tab.id === 'checked-in' && selectedPropertyId === 'all') {
                                                setIsPropertyPickerOpen(true);
                                            }
                                        }}
                                        className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex items-center gap-2 ${activeTab === tab.id
                                            ? 'bg-primary-50 text-primary-600'
                                            : 'text-gray-500 hover:bg-gray-100'
                                            }`}
                                    >
                                        {tab.label}
                                        {counts[tab.id] > 0 && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'
                                                }`}>
                                                {counts[tab.id]}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Search Input (Expands below) */}
                    <AnimatePresence>
                        {showSearch && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="pt-4 pb-2">
                                    <div className="relative group">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary-600 transition-colors">
                                            <IoSearchOutline size={18} />
                                        </div>
                                        <input
                                            type="text"
                                            name="ownerBookingSearch"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search by Booking ID, Room, or Guest..."
                                            className="w-full h-11 md:h-12 pl-12 pr-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-primary-100 focus:border-primary-500 focus:bg-white transition-all outline-none font-bold text-sm"
                                        />
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Property Filter Indicator/Button */}
                    {activeTab === 'checked-in' && (
                        <div className="mt-4 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                            <button
                                onClick={() => setIsPropertyPickerOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-xl hover:border-primary-500 transition-all group"
                            >
                                <IoFilterCircleOutline className="text-primary-600 group-hover:scale-110 transition-transform" size={20} />
                                <span className="text-sm font-black text-gray-900">
                                    {selectedPropertyId === 'all' ? 'All Properties' : properties.find(p => p.propertyId === selectedPropertyId)?.title}
                                </span>
                                <IoChevronDownOutline className="text-gray-400" size={14} />
                            </button>
                            {selectedPropertyId !== 'all' && (
                                <button
                                    onClick={() => setSelectedPropertyId('all')}
                                    className="text-[10px] font-bold text-gray-400 uppercase tracking-widest hover:text-red-500 transition-colors"
                                >
                                    Clear Filter
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
                {/* Vacancy Manager Section */}
                {showVacancyManager && (
                    <div className="mb-6 md:mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
                        <VacancyManager properties={properties} onUpdate={() => { }} />
                    </div>
                )}

                {/* Content Grid */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                        {[1, 2, 3, 4, 5, 6].map(i => <BookingCardSkeleton key={i} />)}
                    </div>
                ) : propertySections.length > 0 ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 xl:gap-8 items-start">
                        {propertySections.map((section) => (
                            <div key={section.propertyId} className="bg-gray-100/30 p-3 md:p-4 rounded-[24px] md:rounded-3xl border border-gray-200">
                                {/* Property Group Header */}
                                <div className="flex items-center gap-3 mb-4 md:mb-6">
                                    <div className="w-1.5 h-5 md:h-6 bg-primary-600 rounded-full"></div>
                                    <div>
                                        <h2 className="text-base md:text-lg font-extrabold text-gray-900 leading-tight">{section.title}</h2>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                                            {section.type === 'room-grouped'
                                                ? `${section.groups.length} Rooms Active`
                                                : `${section.bookings.length} ${activeTab === 'pending' ? 'Requests' : 'Entries'}`}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3 md:space-y-4">
                                    {section.type === 'room-grouped' ? (
                                        section.groups.map((group) => {
                                            const representative = group[0];
                                            const key = `${representative.propertyId}_${representative.roomId}`;
                                            return (
                                                <GroupedRoomCard
                                                    key={key}
                                                    roomNumber={representative.roomNumber}
                                                    propertyTitle={representative.propertyTitle || (representative as BookingWithDetails).propertyDetails?.title || 'Unknown Property'}
                                                    capacity={roomStats[key]?.capacity || group.length} // Fallback to group length
                                                    bookings={group}
                                                    isExpanded={expandedRoomIds.has(key)}
                                                    onToggle={() => {
                                                        setExpandedRoomIds(prev => {
                                                            const newSet = new Set(prev);
                                                            if (newSet.has(key)) {
                                                                newSet.delete(key);
                                                            } else {
                                                                newSet.add(key);
                                                            }
                                                            return newSet;
                                                        });
                                                    }}
                                                    onCheckOut={handleCheckOut}
                                                    onViewDetails={async (b: Booking) => {
                                                        try {
                                                            const detailed = await bookingService.getBookingWithDetails(b.bookingId);
                                                            setSelectedBooking(detailed);
                                                            setIsDetailsOpen(true);
                                                        } catch (error) {
                                                            console.error('Failed to load grouped booking details:', error);
                                                            toast.error('Unable to load booking details right now.');
                                                        }
                                                    }}
                                                />
                                            );
                                        })
                                    ) : (
                                        section.bookings.map(booking => (
                                            <BookingCard
                                                key={booking.bookingId}
                                                booking={booking}
                                                onAccept={handleAccept}
                                                onReject={() => {
                                                    setSelectedBooking(booking as BookingWithDetails);
                                                    setIsRejectOpen(true);
                                                }}
                                                onCheckIn={handleCheckIn}
                                                onCheckOut={handleCheckOut}
                                                onApproveVacate={handleApproveVacate}
                                                onViewDetails={async (b) => {
                                                    try {
                                                        const detailed = await bookingService.getBookingWithDetails(b.bookingId);
                                                        setSelectedBooking(detailed);
                                                        setIsDetailsOpen(true);
                                                    } catch (error) {
                                                        console.error('Failed to load booking details:', error);
                                                        toast.error('Unable to load booking details right now.');
                                                    }
                                                }}
                                            />
                                        ))
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-3xl border border-gray-100 p-12 text-center shadow-sm">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                            <IoAlertCircleOutline size={48} />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">No bookings found</h3>
                        <p className="text-gray-500 mt-2 max-w-sm mx-auto">
                            There are no bookings matching your current filter and search criteria.
                        </p>
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="mt-6 text-primary-600 font-bold hover:underline"
                            >
                                Clear search filter
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Modals */}
            <RejectModal
                isOpen={isRejectOpen}
                onClose={() => setIsRejectOpen(false)}
                onConfirm={handleReject}
                loading={actionLoading}
            />

            <BookingDetailsModal
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                booking={selectedBooking}
            />

            <BroadcastNotificationModal
                isOpen={isBroadcastOpen}
                onClose={() => setIsBroadcastOpen(false)}
                properties={properties}
                onSend={handleBroadcast}
                loading={actionLoading}
            />

            <PropertyPickerModal
                isOpen={isPropertyPickerOpen}
                onClose={() => setIsPropertyPickerOpen(false)}
                properties={properties}
                selectedPropertyId={selectedPropertyId}
                onSelect={setSelectedPropertyId}
            />
        </div >
    );
};

export default Bookings;
