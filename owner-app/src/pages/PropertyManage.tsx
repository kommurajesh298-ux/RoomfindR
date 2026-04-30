import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { propertyService } from '../services/property.service';
import { bookingService } from '../services/booking.service';
import type { Property, Room, FoodMenuItem, PropertyType } from '../types/property.types';
import { motion, AnimatePresence } from 'framer-motion';
import { FiHome, FiCoffee, FiLayout, FiArrowLeft, FiPlus, FiEdit2, FiTrash2, FiMapPin, FiWifi, FiCheck, FiShield, FiWind, FiTv, FiMonitor, FiX, FiTag, FiRefreshCw } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { ImageUploader } from '../components/properties/ImageUploader';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { formatCurrency, RUPEE_SYMBOL } from '../utils/currency';
import {
    preventNumberInputStepperKeys,
    preventNumberInputWheelChange,
    sanitizeAmountValue
} from '../utils/amountInput';

export const PropertyManage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    const [activeTab, setActiveTab] = useState<'overview' | 'menu' | 'rooms' | 'offers'>('overview');
    const [property, setProperty] = useState<Property | null>(null);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);

    // Load Property & Subscriptions
    useEffect(() => {
        if (!id || !currentUser) return;

        const unsubscribeProperty = propertyService.subscribeToProperty(id, (doc) => {
            if (doc) {
                setProperty(doc);
                setLoading(false);
            } else {
                toast.error("Property not found");
                navigate('/properties');
            }
        });

        // Subscribe to Rooms
        const unsubscribeRooms = propertyService.subscribeToRooms(id, (fetchedRooms) => {
            setRooms(fetchedRooms);
        });

        return () => {
            unsubscribeProperty();
            unsubscribeRooms();
        };
    }, [id, currentUser, navigate]);

    // Auto-sync vacancies once on load to ensure data consistency
    useEffect(() => {
        if (id) {
            propertyService.syncPropertyVacancies(id).then(() => {
                // Auto-synced vacancies
            });
        }
    }, [id]);

    const handleSync = async () => {
        if (!id) return;
        const toastId = toast.loading('Syncing vacancies...');
        try {
            const count = await propertyService.syncPropertyVacancies(id);
            toast.success(`Synced! Total vacancies: ${count}`, { id: toastId });
        } catch {
            toast.error('Sync failed', { id: toastId });
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center min-h-screen bg-[#f8f9fb]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black"></div>
        </div>
    );

    if (!property) return <div className="text-center py-20">Property not found</div>;

    const tabs = [
        {
            id: 'overview',
            label: 'Overview',
            icon: FiHome,
            mobileAccent: 'text-violet-600',
            mobileGlow: 'bg-violet-50 border-violet-100',
        },
        {
            id: 'rooms',
            label: 'Rooms',
            icon: FiLayout,
            mobileAccent: 'text-sky-600',
            mobileGlow: 'bg-sky-50 border-sky-100',
        },
        {
            id: 'menu',
            label: 'Food Menu',
            icon: FiCoffee,
            mobileAccent: 'text-amber-600',
            mobileGlow: 'bg-amber-50 border-amber-100',
        },
        {
            id: 'offers',
            label: 'Offers',
            icon: FiTag,
            mobileAccent: 'text-rose-600',
            mobileGlow: 'bg-rose-50 border-rose-100',
        },
    ];

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.12),_transparent_28%),linear-gradient(180deg,_#f8faff_0%,_#f5f7fc_42%,_#f8fafc_100%)] pb-24">
            {/* 1. Sticky Header */}
            <div className="sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-slate-200/70 shadow-[0_12px_30px_rgba(15,23,42,0.04)] transition-all">
                <div className="max-w-7xl mx-auto px-4 md:px-8 min-h-[64px] md:min-h-[72px] py-2 md:py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex items-center gap-3 md:gap-4 min-w-0">
                        <button
                            onClick={() => navigate('/properties')}
                            className="p-2.5 rounded-2xl bg-white border border-slate-200/70 shadow-sm hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 text-slate-700 transition-all shrink-0"
                        >
                            <FiArrowLeft size={20} />
                        </button>
                        <div className="min-w-0">
                            <h1 className="text-base sm:text-lg md:text-2xl font-black text-[#1a1c2e] leading-tight truncate">
                                {property.title}
                            </h1>
                            <div className="flex items-center gap-1.5 text-[10px] md:text-sm text-slate-400 font-medium truncate leading-tight">
                                <FiMapPin size={12} className="shrink-0" />
                                <span className="truncate">{property.address.text || property.city}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                        <div className="hidden min-[450px]:flex items-center gap-2 mr-1">
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${property.published
                                ? 'bg-blue-50 text-blue-700 border-blue-100'
                                : 'bg-amber-50 text-amber-700 border-amber-100'
                                }`}>
                                {property.published ? 'Live' : 'Draft'}
                            </span>
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${property.verified
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                                }`}>
                                {property.verified ? 'Verified' : 'Pending'}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSync}
                                className="flex items-center justify-center h-10 w-10 md:h-11 md:w-auto md:px-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-all group"
                                title="Sync Data"
                            >
                                <FiRefreshCw className="text-lg group-active:rotate-180 transition-transform duration-500" />
                                <span className="hidden md:inline ml-2 text-[10px] font-black uppercase tracking-widest">Sync</span>
                            </button>

                            {!property.published && (
                                <button
                                    onClick={async () => {
                                        try {
                                            await propertyService.publishProperty(property.propertyId);
                                            setProperty(prev => prev ? { ...prev, published: true, verified: true } : null);
                                            toast.success("Listing is live.");
                                        } catch (err) {
                                            console.error(err);
                                            toast.error("Failed to publish.");
                                        }
                                    }}
                                    className="flex items-center justify-center h-10 md:h-11 px-3.5 md:px-5 rounded-2xl bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white shadow-[0_16px_34px_rgba(79,70,229,0.28)] transition-all hover:shadow-[0_18px_40px_rgba(79,70,229,0.34)] active:scale-95"
                                >
                                    <FiCheck className="md:mr-2" size={18} />
                                    <span className="hidden md:inline text-[10px] font-black uppercase tracking-widest">Publish</span>
                                    <span className="md:hidden text-[10px] font-black uppercase tracking-widest ml-1">Live</span>
                                </button>
                            )}

                            <button
                                onClick={() => navigate(`/properties/edit/${id}`)}
                                className="flex items-center justify-center h-10 w-10 md:h-11 md:w-auto md:px-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-all group"
                                title="Edit Listing"
                            >
                                <FiEdit2 size={18} />
                                <span className="hidden md:inline ml-2 text-[10px] font-black uppercase tracking-widest">Edit</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. Animated Tabs */}
            <div className="max-w-7xl mx-auto px-4 md:px-8">
                <div className="overflow-x-auto no-scrollbar">
                <div className="grid min-w-full grid-cols-4 gap-1 rounded-[22px] border border-slate-200/80 bg-white/92 p-1 shadow-[0_16px_34px_rgba(15,23,42,0.06)] backdrop-blur md:inline-flex md:gap-2 md:rounded-[28px] md:p-2">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as 'overview' | 'menu' | 'rooms' | 'offers')}
                                className={`
                                        group relative min-w-0 flex-1 px-1 py-2 md:min-w-[116px] md:px-3.5 md:py-3 text-[10px] md:text-[11px] font-black uppercase tracking-[0.08em] md:tracking-[0.16em] transition-all flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 whitespace-normal text-center rounded-[16px] md:rounded-[20px]
                                        ${isActive
                                        ? 'text-white bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] shadow-[0_16px_34px_rgba(79,70,229,0.28)]'
                                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/90 hover:shadow-sm'}
                                    `}
                            >
                                <span className={`flex h-7 w-7 md:h-9 md:w-9 items-center justify-center rounded-xl md:rounded-2xl border transition-all ${isActive ? 'border-white/20 bg-white/15 text-white shadow-inner' : `${tab.mobileGlow} ${tab.mobileAccent} group-hover:border-indigo-100 group-hover:bg-indigo-50 group-hover:text-indigo-600`}`}>
                                    <Icon size={14} className={`transition-all ${isActive ? 'scale-110' : ''}`} />
                                </span>
                                <span className="leading-[1.08] md:leading-none normal-case md:uppercase">
                                    {tab.label}
                                </span>
                                {isActive && (
                                    <motion.div
                                        layoutId="activeTabBadge"
                                        className="absolute inset-0 -z-10 rounded-[16px] md:rounded-[20px]"
                                        initial={false}
                                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
                {activeTab === 'offers' && (
                    <OffersTab property={property} />
                )}

                {activeTab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
                        {/* Left Column: Property Summary */}
                        <div className="lg:col-span-2 space-y-8">
                            <div className="bg-white p-5 sm:p-6 md:p-8 rounded-[28px] md:rounded-[32px] border border-slate-200/80 shadow-[0_22px_50px_rgba(15,23,42,0.06)] relative overflow-hidden">
                                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(135deg,rgba(99,102,241,0.16),rgba(14,165,233,0.08)_55%,transparent)]" />
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 md:mb-8">
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-xl md:text-2xl mb-1">Property Summary</h3>
                                        <p className="text-slate-500">Manage your property details and pricing</p>
                                    </div>
                                    <button
                                        onClick={() => navigate(`/properties/edit/${id}`)}
                                        className="w-full sm:w-auto text-slate-900 text-xs md:text-sm font-bold hover:bg-indigo-50 hover:text-indigo-700 px-4 py-2.5 rounded-full border border-slate-200 transition-all"
                                    >
                                        Edit Details
                                    </button>
                                </div>

                                <div className="space-y-8">
                                    {/* Description */}
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">Description</p>
                                        <p className="text-slate-700 leading-relaxed text-base md:text-lg">
                                            {property.description || "No description provided."}
                                        </p>
                                    </div>

                                    {/* Pricing Block */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 p-5 md:p-6 bg-[linear-gradient(180deg,#f8faff_0%,#f3f6fd_100%)] rounded-[24px] border border-slate-200/70 shadow-inner">
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Monthly Rent</p>
                                            <p className="text-2xl md:text-3xl font-black text-slate-900">{formatCurrency(property.pricePerMonth)}</p>
                                        </div>
                                        <div className="pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-slate-200/60 md:pl-6">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Advance / Deposit</p>
                                            <p className="text-2xl md:text-3xl font-black text-slate-900">{formatCurrency(property.advanceAmount)}</p>
                                        </div>
                                    </div>

                                    {/* Amenities */}
                                    {property.features && (
                                        <div>
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 block">Amenities</p>
                                            <div className="flex flex-wrap gap-2.5 md:gap-3">
                                                {Object.entries(property.features)
                                                    .filter(([, value]) => value)
                                                    .map(([key]) => {
                                                        const getIcon = (k: string) => {
                                                            const map: Record<string, React.ElementType> = { wifi: FiWifi, ac: FiWind, security: FiShield, cctv: FiMonitor, tv: FiTv };
                                                            return map[k.toLowerCase()] || FiCheck;
                                                        };
                                                        const Icon = getIcon(key);
                                                        return (
                                                            <span key={key} className="flex items-center gap-2 px-3.5 md:px-4 py-2 bg-white border border-slate-200/80 text-slate-700 text-[11px] md:text-sm rounded-full capitalize font-black shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md cursor-default">
                                                                <Icon className="text-indigo-500" />
                                                                {key.replace(/([A-Z])/g, ' $1').trim()}
                                                            </span>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Gallery */}
                        <div className="lg:col-span-1">
                            <div className="bg-white p-5 md:p-6 rounded-[28px] md:rounded-[32px] border border-slate-200/80 shadow-[0_20px_44px_rgba(15,23,42,0.06)] md:sticky md:top-32">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-slate-900 text-lg md:text-xl">Gallery</h3>
                                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                                        {property.images?.length || 0} Images
                                    </span>
                                </div>

                                <ImageUploader
                                    propertyId={property.propertyId}
                                    images={property.images}
                                    onImagesChange={() => { /* Read Only in Overview */ }}
                                    readOnly={true}
                                    maxImages={1}
                                />

                                <button
                                    onClick={() => navigate(`/properties/edit/${property.propertyId}`)}
                                    className="w-full mt-4 py-3.5 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white font-bold rounded-2xl transition-all shadow-[0_14px_30px_rgba(79,70,229,0.2)] hover:shadow-[0_18px_40px_rgba(79,70,229,0.28)]"
                                >
                                    Manage Photos
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                {
                    activeTab === 'rooms' && (
                        <RoomsManager propertyId={property.propertyId} rooms={rooms} />
                    )
                }

                {
                    activeTab === 'menu' && (
                        <MenuManager
                            property={property}
                            onUpdate={async (menu) => {
                                await propertyService.updateFoodMenu(property.propertyId, menu);
                                // Broadcast notification to all residents
                                try {
                                    await bookingService.sendPropertyNotification(
                                        property.propertyId,
                                        "Food Menu Updated",
                                        "The weekly food menu has been updated. Check it out now!"
                                    );
                                } catch (e) {
                                    console.error("Failed to send food update notification", e);
                                }
                            }}
                        />
                    )
                }
            </div >
        </div >
    );
};

// Sub-components
const RoomsManager = ({ propertyId, rooms }: { propertyId: string, rooms: Room[] }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRoom, setEditingRoom] = useState<Room | null>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);

    const handleSaveRoom = async (roomData: Room) => {
        try {
            if (editingRoom) {
                await propertyService.updateRoom(propertyId, editingRoom.roomId, roomData);
                toast.success("Room updated");
            } else {
                await propertyService.addRoom(propertyId, roomData);
                toast.success("Room added");
            }
            setIsModalOpen(false);
            setEditingRoom(null);
        } catch {
            toast.error("Failed to save room");
        }
    };

    const handleDelete = async () => {
        if (!deleteId) return;
        try {
            await propertyService.deleteRoom(propertyId, deleteId);
            toast.success("Room deleted");
            setDeleteId(null);
        } catch {
            toast.error("Failed to delete room");
        }
    };

    return (
        <div className="space-y-6 md:space-y-8">
            <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_20px_44px_rgba(15,23,42,0.05)] md:p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl md:text-2xl font-black text-[#1a1c2e]">Property Rooms</h2>
                    <p className="text-sm text-slate-500 font-medium">Manage units and availability</p>
                </div>
                <button
                    onClick={() => { setEditingRoom(null); setIsModalOpen(true); }}
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-3 md:px-6 md:py-3.5 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white rounded-2xl shadow-[0_14px_30px_rgba(79,70,229,0.24)] hover:shadow-[0_18px_38px_rgba(79,70,229,0.3)] text-sm font-black transition-all active:scale-95"
                >
                    <FiPlus strokeWidth={3} /> Add New Room
                </button>
            </div>
            </div>

            <div className="grid grid-cols-2 max-[360px]:grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {rooms.map(room => (
                    <div key={room.roomId} className="bg-white border border-slate-200/80 rounded-[26px] overflow-hidden shadow-[0_16px_36px_rgba(15,23,42,0.05)] hover:shadow-[0_22px_44px_rgba(79,70,229,0.12)] hover:border-indigo-200 transition-all duration-300 group flex flex-col hover:-translate-y-1">
                        {/* Image Cover */}
                        <div className="relative h-36 sm:h-44 md:h-56 w-full bg-slate-100 overflow-hidden">
                            {room.images && room.images.length > 0 ? (
                                <img src={room.images[0]} alt={`Room ${room.roomNumber}`} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-300">
                                    <FiLayout size={40} />
                                </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/45 via-slate-900/15 to-transparent" />
                            <div className="absolute top-3 left-3 md:top-4 md:left-4 bg-white/92 backdrop-blur-md px-2.5 sm:px-3 md:px-4 py-1 sm:py-1.5 md:py-2 rounded-2xl shadow-sm font-black text-[9px] sm:text-[10px] uppercase tracking-widest text-slate-900 border border-white">
                                {room.roomNumber}
                            </div>
                            <div className="absolute top-3 right-3 md:top-4 md:right-4 flex gap-2">
                                <button onClick={() => { setEditingRoom(room); setIsModalOpen(true); }} className="p-2.5 bg-white/90 backdrop-blur-md rounded-2xl shadow-lg text-slate-700 hover:text-indigo-600 hover:bg-indigo-50 transition-all active:scale-90 border border-white">
                                    <FiEdit2 size={16} />
                                </button>
                                <button onClick={() => setDeleteId(room.roomId)} className="p-2.5 bg-white/90 backdrop-blur-md rounded-2xl shadow-lg text-red-500 hover:bg-red-50 transition-all active:scale-90 border border-white">
                                    <FiTrash2 size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-3.5 sm:p-4 md:p-5 flex-1 flex flex-col bg-[linear-gradient(180deg,#ffffff_0%,#fafbff_100%)]">
                            <div className="flex justify-between items-start mb-4">
                                <span className="px-2.5 sm:px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest border border-indigo-100">
                                    {room.type}
                                </span>
                                <div className="text-right">
                                    <p className="text-sm sm:text-base md:text-lg font-bold text-slate-900">{formatCurrency(room.price || 0)}</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">/ Month</p>
                                </div>
                            </div>

                            <div className="space-y-4 mt-auto">
                                {/* Occupancy Bar */}
                                <div>
                                    <div className="flex justify-between items-end mb-1.5">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Occupancy</span>
                                        <span className="text-xs font-bold text-slate-900">{room.bookedCount || 0} / {room.capacity}</span>
                                    </div>
                                    <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-[linear-gradient(90deg,#4f46e5_0%,#06b6d4_100%)] rounded-full transition-all duration-500"
                                            style={{ width: `${Math.min(((room.bookedCount || 0) / room.capacity) * 100, 100)}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Availability & Actions */}
                                <div className="flex justify-between items-center pt-3 sm:pt-4 md:pt-5 border-t border-slate-100">
                                    <div>
                                        <span className={`block text-[10px] font-black uppercase tracking-widest ${room.availableCount > 0 ? 'text-blue-600' : 'text-rose-500'}`}>
                                            {room.availableCount > 0 ? 'Available' : 'Sold Out'}
                                        </span>
                                        <span className={`text-xs sm:text-sm font-black ${room.availableCount > 0 ? 'text-blue-700' : 'text-rose-600'}`}>
                                            {room.availableCount} Beds
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => propertyService.updateRoomOccupancy(propertyId, room.roomId, (room.bookedCount || 0) + 1)}
                                            disabled={(room.bookedCount || 0) >= room.capacity}
                                            className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 flex items-center justify-center bg-slate-50 hover:bg-indigo-600 hover:text-white rounded-2xl text-base sm:text-lg transition-all disabled:opacity-50 disabled:hover:bg-slate-50"
                                            title="Add Occupant"
                                        >
                                            +
                                        </button>
                                        <button
                                            onClick={() => propertyService.updateRoomOccupancy(propertyId, room.roomId, (room.bookedCount || 0) - 1)}
                                            disabled={(room.bookedCount || 0) <= 0}
                                            className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 flex items-center justify-center bg-slate-50 hover:bg-rose-600 hover:text-white rounded-2xl text-base sm:text-lg transition-all disabled:opacity-50 disabled:hover:bg-slate-50"
                                            title="Remove Occupant"
                                        >
                                            -
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {rooms.length === 0 && (
                <div className="text-center py-12 bg-white rounded-[28px] border-2 border-dashed border-slate-200 shadow-sm">
                    <p className="text-slate-500 font-medium">No rooms added yet. Click "Add Room" to manage your inventory.</p>
                </div>
            )}

            <AnimatePresence>
                {isModalOpen && (
                    <RoomModal
                        onClose={() => setIsModalOpen(false)}
                        onSave={handleSaveRoom}
                        initialData={editingRoom}
                        propertyId={propertyId}
                    />
                )}
            </AnimatePresence>

            <ConfirmationModal
                isOpen={!!deleteId}
                onClose={() => setDeleteId(null)}
                onConfirm={handleDelete}
                title="Delete Room?"
                message="Are you sure you want to delete this room? This action cannot be undone."
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
};

const RoomModal = ({ onClose, onSave, initialData, propertyId }: {
    onClose: () => void,
    onSave: (room: Room) => Promise<void>,
    initialData: Room | null,
    propertyId: string
}) => {
    const [formData, setFormData] = useState<Room>(initialData || {
        roomId: crypto.randomUUID(),
        roomNumber: '',
        type: 'Shared',
        price: 0,
        capacity: 2,
        bookedCount: 0,
        availableCount: 2,
        status: 'available',
        amenities: [],
        images: []
    });

    const [loading, setLoading] = useState(false);

    const handleChange = <K extends keyof Room>(field: K, value: Room[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };
    const amountInputProps = useMemo(() => ({
        min: 0,
        step: '0.01',
        inputMode: 'decimal' as const,
        onWheel: preventNumberInputWheelChange,
        onKeyDown: preventNumberInputStepperKeys
    }), []);

    const handleSave = async () => {
        if (!formData.roomNumber) {
            toast.error('Please enter a room number');
            return;
        }
        if (formData.images.length === 0) {
            toast.error('Please upload 1 image for this room');
            return;
        }
        if (formData.images.length > 1) {
            toast.error('Only 1 image is allowed for this room');
            return;
        }
        setLoading(true);
        try {
            await onSave(formData);
        } finally {
            setLoading(false);
        }
    };

    // Prevent body scroll

    // Prevent body scroll
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = 'unset'; };
    }, []);


    const inputClasses = "w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-black/5 transition-all outline-none text-sm font-medium";
    const labelClasses = "block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1";

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white w-full max-w-[520px] max-h-[90vh] rounded-[24px] shadow-2xl overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-white">
                    <div>
                        <h3 className="font-bold text-slate-900 text-xl">{initialData ? 'Edit Room' : 'Add New Room'}</h3>
                        <p className="text-xs text-slate-500 font-medium">Configure room details and availability</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                    >
                        <FiX size={20} />
                    </button>
                </div>

                {/* Form Content - Scrollable area */}
                <div className="p-6 space-y-6 overflow-y-auto flex-1 no-scrollbar">
                    {/* Hide scrollbar with CSS class instead of dangerouslySetInnerHTML */}
                    <style>{`.no-scrollbar::-webkit-scrollbar { display: none; }`}</style>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-1">
                            <label htmlFor="roomNumber" className={labelClasses}>Room Number</label>
                            <input
                                type="text"
                                id="roomNumber"
                                name="roomNumber"
                                autoComplete="off"
                                className={inputClasses}
                                placeholder="e.g. 101 or A-1"
                                value={formData.roomNumber}
                                onChange={e => handleChange('roomNumber', e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <label htmlFor="roomType" className={labelClasses}>Room Type</label>
                            <select
                                id="roomType"
                                name="type"
                                autoComplete="off"
                                className={inputClasses}
                                value={formData.type}
                                onChange={e => handleChange('type', e.target.value as PropertyType)}
                            >
                                <option value="Single">Single Room</option>
                                <option value="Double">Double Sharing</option>
                                <option value="Triple">Triple Sharing</option>
                                <option value="Shared">Shared Dorm</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div className="space-y-1">
                            <label htmlFor="price" className={labelClasses}>{`Monthly Price (${RUPEE_SYMBOL})`}</label>
                            <input
                                type="number"
                                {...amountInputProps}
                                id="price"
                                name="price"
                                autoComplete="off"
                                className={inputClasses}
                                placeholder="0"
                                value={formData.price}
                                onFocus={(e) => e.target.select()}
                                onChange={e => handleChange('price', sanitizeAmountValue(e.target.value))}
                            />
                        </div>
                        <div className="space-y-1">
                            <label htmlFor="capacity" className={labelClasses}>Max Capacity</label>
                            <input
                                type="number"
                                id="capacity"
                                name="capacity"
                                autoComplete="off"
                                className={inputClasses}
                                placeholder="1"
                                value={formData.capacity}
                                onFocus={(e) => e.target.select()}
                                onChange={e => handleChange('capacity', Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-1">
                            <label htmlFor="bookedCount" className={labelClasses}>Occupied (Booked)</label>
                            <input
                                type="number"
                                id="bookedCount"
                                name="bookedCount"
                                autoComplete="off"
                                className={inputClasses}
                                placeholder="0"
                                value={formData.bookedCount}
                                onFocus={(e) => e.target.select()}
                                onChange={e => handleChange('bookedCount', Number(e.target.value))}
                                max={formData.capacity}
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <p className={labelClasses}>Room Gallery</p>
                            <span className={`text-[10px] font-bold ${formData.images.length === 1 ? 'text-blue-500' : 'text-orange-500'} uppercase`}>
                                {formData.images.length === 1 ? '✓ 1/1 image ready' : 'Upload 1 image'}
                            </span>
                        </div>
                        <div className={`p-4 bg-indigo-50/60 border-2 border-dashed rounded-2xl transition-all group hover:bg-white ${formData.images.length === 4 ? 'border-blue-200' : 'border-indigo-100 hover:border-blue-200'}`}>
                            <ImageUploader
                                propertyId={propertyId}
                                images={formData.images}
                                onImagesChange={(imgs) => handleChange('images', imgs)}
                                onUpload={(files) => propertyService.uploadRoomImages(propertyId, formData.roomId, files)}
                                hideLabel={true}
                                maxImages={1}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-5 bg-slate-50 border-t border-slate-100 flex flex-col md:flex-row justify-end gap-3 z-10">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 text-slate-500 font-bold text-sm hover:text-slate-900 transition-colors order-2 md:order-1"
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-8 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2 order-1 md:order-2 active:scale-[0.98]"
                    >
                        {loading ? (
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        ) : (
                            'Save Room'
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

const MenuManager = ({ property, onUpdate }: { property: Property, onUpdate: (menu: FoodMenuItem[]) => Promise<void> }) => {
    const DAYS = useMemo(() => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], []);
    const [menu, setMenu] = useState<FoodMenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setLoading(true);
        const unsubscribe = propertyService.subscribeToFoodMenu(property.propertyId, (data) => {
            // Build full 7-day menu in order
            const fullMenu = DAYS.map(day => {
                const item = data.find(m => m.dayOfWeek === day);
                return item || { dayOfWeek: day, breakfast: '', lunch: '', dinner: '' };
            });

            setMenu(fullMenu);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [property.propertyId, DAYS]);

    const handleChange = (index: number, field: keyof FoodMenuItem, value: string) => {
        const newMenu = [...menu];
        if (!newMenu[index]) {
            // Should not happen if initialized correctly, but safety first
            newMenu[index] = { dayOfWeek: DAYS[index], breakfast: '', lunch: '', dinner: '' };
        }
        newMenu[index] = { ...newMenu[index], [field]: value };
        setMenu(newMenu);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onUpdate(menu);
            toast.success("Menu updated successfully");
        } catch (error) {
            toast.error("Failed to update menu");
            console.error(error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white rounded-[28px] border border-slate-200/80 shadow-[0_20px_44px_rgba(15,23,42,0.05)] overflow-hidden">
            <div className="p-5 md:p-6 border-b border-slate-100 flex flex-col gap-4 md:flex-row md:justify-between md:items-center bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)]">
                <div>
                    <h3 className="font-bold text-slate-900 text-lg">Weekly Food Menu</h3>
                    <p className="text-sm text-slate-500">Plan your meals for the week</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving || loading}
                    className="w-full md:w-auto px-6 py-3 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white font-bold rounded-2xl hover:shadow-[0_18px_38px_rgba(79,70,229,0.26)] disabled:opacity-50 transition-all"
                >
                    {saving ? 'Saving...' : 'Save Menu'}
                </button>
            </div>

            {loading ? (
                <div className="p-20 text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                    <p className="text-slate-500 font-medium">Loading food menu...</p>
                </div>
            ) : (
                <>
                <div className="space-y-4 p-4 md:hidden">
                    {DAYS.map((day, index) => (
                        <div key={day} className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] p-4 shadow-sm">
                            <div className="mb-4 flex items-center justify-between">
                                <h4 className="text-sm font-black uppercase tracking-[0.18em] text-slate-700">{day}</h4>
                                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">Menu</span>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <label htmlFor={`breakfast-${index}`} className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Breakfast</label>
                                    <input
                                        type="text"
                                        id={`breakfast-${index}`}
                                        name={`breakfast-${index}`}
                                        autoComplete="off"
                                        aria-label={`Breakfast menu for ${day}`}
                                        placeholder="e.g. Dosa"
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/10"
                                        value={menu.find(m => m.dayOfWeek === day)?.breakfast || ''}
                                        onChange={(e) => handleChange(index, 'breakfast', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label htmlFor={`lunch-${index}`} className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Lunch</label>
                                    <input
                                        type="text"
                                        id={`lunch-${index}`}
                                        name={`lunch-${index}`}
                                        autoComplete="off"
                                        aria-label={`Lunch menu for ${day}`}
                                        placeholder="e.g. Rice"
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/10"
                                        value={menu.find(m => m.dayOfWeek === day)?.lunch || ''}
                                        onChange={(e) => handleChange(index, 'lunch', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label htmlFor={`dinner-${index}`} className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Dinner</label>
                                    <input
                                        type="text"
                                        id={`dinner-${index}`}
                                        name={`dinner-${index}`}
                                        autoComplete="off"
                                        aria-label={`Dinner menu for ${day}`}
                                        placeholder="e.g. Roti"
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/10"
                                        value={menu.find(m => m.dayOfWeek === day)?.dinner || ''}
                                        onChange={(e) => handleChange(index, 'dinner', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50/70">
                            <tr>
                                <th className="px-6 py-4 font-black tracking-widest w-32">Day</th>
                                <th className="px-6 py-4 font-black tracking-widest min-w-[150px]">Breakfast</th>
                                <th className="px-6 py-4 font-black tracking-widest min-w-[150px]">Lunch</th>
                                <th className="px-6 py-4 font-black tracking-widest min-w-[150px]">Dinner</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {DAYS.map((day, index) => (
                                <tr key={day} className="hover:bg-indigo-50/40 transition-colors">
                                    <td className="px-6 py-4 font-bold text-slate-900 border-r border-slate-50 bg-slate-50/60">{day}</td>
                                    <td className="px-2 py-1">
                                        <input
                                            type="text"
                                            id={`breakfast-${index}`}
                                            name={`breakfast-${index}`}
                                            autoComplete="off"
                                            aria-label={`Breakfast menu for ${day}`}
                                            placeholder="e.g. Dosa"
                                            className="w-full p-2.5 bg-transparent border-none focus:ring-0 focus:bg-white rounded-lg font-medium text-slate-700 placeholder:text-slate-300 transition-all"
                                            value={menu.find(m => m.dayOfWeek === day)?.breakfast || ''}
                                            onChange={(e) => handleChange(index, 'breakfast', e.target.value)}
                                        />
                                    </td>
                                    <td className="px-2 py-1">
                                        <input
                                            type="text"
                                            id={`lunch-${index}`}
                                            name={`lunch-${index}`}
                                            autoComplete="off"
                                            aria-label={`Lunch menu for ${day}`}
                                            placeholder="e.g. Rice"
                                            className="w-full p-2.5 bg-transparent border-none focus:ring-0 focus:bg-white rounded-lg font-medium text-slate-700 placeholder:text-slate-300 transition-all"
                                            value={menu.find(m => m.dayOfWeek === day)?.lunch || ''}
                                            onChange={(e) => handleChange(index, 'lunch', e.target.value)}
                                        />
                                    </td>
                                    <td className="px-2 py-1">
                                        <input
                                            type="text"
                                            id={`dinner-${index}`}
                                            name={`dinner-${index}`}
                                            autoComplete="off"
                                            aria-label={`Dinner menu for ${day}`}
                                            placeholder="e.g. Roti"
                                            className="w-full p-2.5 bg-transparent border-none focus:ring-0 focus:bg-white rounded-lg font-medium text-slate-700 placeholder:text-slate-300 transition-all"
                                            value={menu.find(m => m.dayOfWeek === day)?.dinner || ''}
                                            onChange={(e) => handleChange(index, 'dinner', e.target.value)}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
            )}
        </div>
    );
};

function OffersTab({ property }: { property: Property }) {
    const [couponCode, setCouponCode] = useState(property.autoOffer?.code || '');
    const [discountType, setDiscountType] = useState<'percentage' | 'flat'>(property.autoOffer?.type || 'flat');
    const [discountValue, setDiscountValue] = useState(property.autoOffer?.value || 0);
    const [saving, setSaving] = useState(false);
    const amountInputProps = useMemo(() => ({
        min: 0,
        step: '0.01',
        inputMode: 'decimal' as const,
        onWheel: preventNumberInputWheelChange,
        onKeyDown: preventNumberInputStepperKeys
    }), []);

    const handleSaveOffer = async () => {
        if (!couponCode) {
            toast.error("Please enter a coupon code");
            return;
        }
        if (discountValue <= 0) {
            toast.error("Discount value must be greater than 0");
            return;
        }

        setSaving(true);
        try {
            await propertyService.savePropertyOffer(property.propertyId, {
                offerId: 'auto_' + property.propertyId,
                code: couponCode.toUpperCase(),
                type: discountType,
                value: discountValue,
                active: true,
                appliesTo: ['all'],
                maxDiscount: discountType === 'percentage' ? 500 : discountValue,
                minBookingAmount: 1,
                expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days default
                usedCount: 0,
                usageLimit: 1000000
            });
            toast.success("Offer saved and synced!");
        } catch (error) {
            console.error("Save offer error:", error);
            toast.error("Failed to save offer");
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteOffer = async () => {
        if (!property.autoOffer) return;

        if (!window.confirm("Are you sure you want to delete this offer? It will be removed immediately for all customers.")) return;

        setSaving(true);
        try {
            await propertyService.deletePropertyOffer(property.propertyId);
            setCouponCode('');
            setDiscountType('flat');
            setDiscountValue(0);
            toast.success("Offer deleted successfully!");
        } catch (error) {
            console.error("Delete offer error:", error);
            toast.error("Failed to delete offer");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white p-5 sm:p-6 md:p-10 rounded-[28px] md:rounded-[32px] border border-slate-200/80 shadow-[0_22px_50px_rgba(15,23,42,0.06)] animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(99,102,241,0.12),transparent)]" />
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-10 pb-4 md:pb-6 border-b border-slate-100 relative">
                <div>
                    <h3 className="font-extrabold text-slate-900 text-2xl md:text-3xl mb-2 tracking-tight">Promotional Offers</h3>
                    <p className="text-slate-500 font-medium">Create a special discount for your property</p>
                </div>
                <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:justify-end md:ml-auto">
                    {property.autoOffer && (
                        <button
                            onClick={handleDeleteOffer}
                            disabled={saving}
                            className="w-full md:w-auto md:min-w-[140px] h-11 px-5 bg-rose-50 text-rose-600 font-bold rounded-2xl hover:bg-rose-100 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 text-sm whitespace-nowrap border border-rose-100"
                        >
                            <FiTrash2 size={18} />
                            Remove
                        </button>
                    )}
                    <button
                        onClick={handleSaveOffer}
                        disabled={saving}
                        className="w-full md:w-auto md:min-w-[190px] h-11 px-6 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white font-bold rounded-2xl transition-all shadow-[0_16px_34px_rgba(79,70,229,0.26)] hover:shadow-[0_18px_40px_rgba(79,70,229,0.32)] active:scale-95 disabled:opacity-50 text-sm whitespace-nowrap"
                    >
                        {saving ? 'Saving...' : 'Save Offer Settings'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                <div className="space-y-6 md:space-y-8">
                    <div className="space-y-3">
                        <label htmlFor="offer-coupon-code" className="text-sm font-bold text-slate-700 ml-1">Coupon Code</label>
                        <input
                            id="offer-coupon-code"
                            name="couponCode"
                            type="text"
                            autoComplete="off"
                            placeholder="e.g. SAVE500"
                            className="w-full p-3.5 md:p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 focus:bg-white transition-all font-bold text-base md:text-lg placeholder:text-slate-300"
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        />
                        <p className="text-xs text-slate-400 font-medium ml-1">This code will be visible to all customers on your property page</p>
                    </div>

                    <div className="space-y-4">
                        <p className="text-sm font-bold text-slate-700 ml-1">Discount Type</p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDiscountType('flat')}
                                className={`flex-1 py-3 md:py-4 px-4 md:px-6 rounded-2xl border-2 font-bold text-sm transition-all ${discountType === 'flat' ? 'border-indigo-600 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'}`}
                            >
                                {`Flat ${RUPEE_SYMBOL}`}
                            </button>
                            <button
                                onClick={() => setDiscountType('percentage')}
                                className={`flex-1 py-3 md:py-4 px-4 md:px-6 rounded-2xl border-2 font-bold text-sm transition-all ${discountType === 'percentage' ? 'border-indigo-600 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'}`}
                            >
                                Percentage %
                            </button>
                        </div>
                    </div>
                </div>

                <div className="space-y-6 md:space-y-8">
                    <div className="space-y-3">
                        <label htmlFor="offer-discount-value" className="text-sm font-bold text-slate-700 ml-1">Discount Value</label>
                        <div className="relative group">
                            <span className="absolute left-5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xl group-focus-within:text-indigo-700 transition-colors">
                                {discountType === 'flat' ? RUPEE_SYMBOL : '%'}
                            </span>
                            <input
                                id="offer-discount-value"
                                name="discountValue"
                                type="number"
                                autoComplete="off"
                                {...amountInputProps}
                                placeholder="0"
                                className="w-full pl-12 pr-6 py-3.5 md:py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 focus:bg-white transition-all font-bold text-lg md:text-xl"
                                value={discountValue}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => setDiscountValue(sanitizeAmountValue(e.target.value))}
                            />
                        </div>
                    </div>

                    <div className="p-5 md:p-6 bg-[linear-gradient(180deg,rgba(238,242,255,0.9),rgba(224,231,255,0.7))] rounded-[24px] border border-indigo-100 shadow-inner">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20 shrink-0">
                                <FiTag size={20} />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-bold text-indigo-900 text-base md:text-lg mb-3">Pricing Preview</h4>
                                <div className="space-y-2 bg-white/50 p-3 rounded-xl border border-indigo-100/50">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500 font-medium">Monthly Rent:</span>
                                        <span className="font-bold text-slate-900">{formatCurrency(property.pricePerMonth)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm text-blue-600 font-bold">
                                        <span>Discount ({couponCode || 'CODE'}):</span>
                                        <span>- {discountType === 'flat' ? RUPEE_SYMBOL : ''}{discountValue}{discountType === 'percentage' ? '%' : ''}</span>
                                    </div>
                                    <div className="pt-2 border-t border-indigo-100 flex justify-between">
                                        <span className="text-slate-900 font-bold">Final Rent:</span>
                                        <span className="text-lg font-black text-slate-900">
                                            {formatCurrency(discountType === 'flat'
                                                ? property.pricePerMonth - discountValue
                                                : property.pricePerMonth * (1 - discountValue / 100))}
                                        </span>
                                    </div>
                                </div>
                                <p className="mt-3 text-indigo-700/70 text-xs font-medium leading-relaxed">
                                    Customers will see this breakdown when applying the code at checkout.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Full Payment Discount Section */}
            <hr className="my-8 md:my-12 border-slate-100" />

            <div className="mb-8">
                <h3 className="font-extrabold text-slate-900 text-xl md:text-2xl mb-2 tracking-tight">Full Payment Special Offer</h3>
                <p className="text-slate-500 font-medium">Reward customers who pay upfront for 3+ months</p>
            </div>

            <FullPaymentDiscountSettings property={property} />
        </div>
    );
}

function FullPaymentDiscountSettings({ property }: { property: Property }) {
    const [isActive, setIsActive] = useState(property.fullPaymentDiscount?.active || false);
    const [amount, setAmount] = useState(property.fullPaymentDiscount?.amount || 0);
    const [type, setType] = useState<'percentage' | 'flat'>(property.fullPaymentDiscount?.type || 'flat');
    const [saving, setSaving] = useState(false);
    const amountInputProps = useMemo(() => ({
        min: 0,
        step: '0.01',
        inputMode: 'decimal' as const,
        onWheel: preventNumberInputWheelChange,
        onKeyDown: preventNumberInputStepperKeys
    }), []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await propertyService.updateProperty(property.propertyId, {
                fullPaymentDiscount: {
                    active: isActive,
                    amount: amount,
                    type: type,
                    minMonths: 3
                }
            });
            toast.success("Full payment discount updated!");
        } catch (error) {
            console.error(error);
            toast.error("Failed to update discount");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8 items-start">
            <div className="lg:col-span-1 space-y-6">
                <div
                    onClick={() => setIsActive(!isActive)}
                    className={`p-5 md:p-6 rounded-[24px] md:rounded-[28px] border-2 cursor-pointer transition-all shadow-sm ${isActive ? 'border-blue-500 bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] shadow-[0_18px_40px_rgba(59,130,246,0.14)]' : 'border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] hover:border-slate-300'}`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-blue-600' : 'text-slate-400'}`}>Status</span>
                        <div className={`w-10 h-5 rounded-full relative transition-colors ${isActive ? 'bg-blue-500' : 'bg-slate-300'}`}>
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isActive ? 'left-6' : 'left-1'}`} />
                        </div>
                    </div>
                    <h4 className="font-black text-slate-900 text-lg">{isActive ? 'Offer is LIVE' : 'Offer is Disabled'}</h4>
                    <p className="text-xs text-slate-500 font-medium mt-1">Users will see this discount at checkout for 3+ month stays.</p>
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full py-3.5 md:py-4 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white font-bold rounded-2xl hover:shadow-[0_18px_40px_rgba(79,70,229,0.28)] disabled:opacity-50 shadow-[0_14px_30px_rgba(79,70,229,0.2)] transition-all active:scale-[0.98] text-sm"
                >
                    {saving ? 'Saving...' : 'Update Full Payment Offer'}
                </button>
            </div>

            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 bg-[linear-gradient(180deg,#f8faff_0%,#f1f5ff_100%)] p-5 md:p-8 rounded-[28px] md:rounded-[32px] border border-slate-200/80 shadow-inner">
                <div className="space-y-3">
                    <label htmlFor="full-payment-discount-amount" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Discount Amount</label>
                    <div className="relative">
                        <span className="absolute left-5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xl">{type === 'flat' ? RUPEE_SYMBOL : '%'}</span>
                        <input
                            id="full-payment-discount-amount"
                            name="fullPaymentDiscountAmount"
                            type="number"
                            autoComplete="off"
                            {...amountInputProps}
                            value={amount}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setAmount(sanitizeAmountValue(e.target.value))}
                            className="w-full pl-12 pr-6 py-3.5 md:py-4 bg-white border border-slate-200 rounded-2xl focus:border-indigo-600 outline-none font-bold text-lg md:text-xl transition-all"
                        />
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Discount Type</p>
                    <div className="flex gap-3 h-full">
                        <button
                            onClick={() => setType('flat')}
                            className={`flex-1 py-2.5 md:py-3 rounded-2xl border-2 font-black text-sm transition-all ${type === 'flat' ? 'border-indigo-600 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white' : 'border-slate-200 bg-white text-slate-400 hover:border-indigo-200 hover:text-indigo-700'}`}
                        >
                            Flat
                        </button>
                        <button
                            onClick={() => setType('percentage')}
                            className={`flex-1 py-2.5 md:py-3 rounded-2xl border-2 font-black text-sm transition-all ${type === 'percentage' ? 'border-indigo-600 bg-[linear-gradient(135deg,#4f46e5_0%,#7c3aed_100%)] text-white' : 'border-slate-200 bg-white text-slate-400 hover:border-indigo-200 hover:text-indigo-700'}`}
                        >
                            Percent
                        </button>
                    </div>
                </div>

                <div className="col-span-full pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-2xl flex items-center justify-center text-indigo-600 shadow-sm border border-slate-100 shrink-0">
                        <FiTag size={20} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-900">Minimum 3 Month Stay Required</p>
                        <p className="text-xs text-slate-500 font-medium">The system will automatically apply <span className="text-slate-900 font-extrabold">{type === 'flat' ? RUPEE_SYMBOL : ''}{amount}{type === 'percentage' ? '%' : ''} off</span> when a user chooses 'Pay Full Amount' for 3 months or more.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PropertyManage;










