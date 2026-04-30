import React, { useState, useEffect } from 'react';
import { IoHomeOutline, IoPeopleOutline, IoChevronDownOutline, IoChevronUpOutline } from 'react-icons/io5';
import type { Property, Room } from '../../types/property.types';
import { propertyService } from '../../services/property.service';
import { formatCurrency } from '../../utils/currency';

interface VacancyManagerProps {
    properties: Property[];
    onUpdate: () => void;
}

const VacancyManager: React.FC<VacancyManagerProps> = ({ properties, onUpdate }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [rooms, setRooms] = useState<Record<string, Room[]>>({});
    const [loading, setLoading] = useState<Record<string, boolean>>({});
    const [saveLoading, setSaveLoading] = useState<string | null>(null);

    useEffect(() => {
        if (expandedId && !rooms[expandedId]) {
            fetchRooms(expandedId);
        }
    }, [expandedId, rooms]);

    const fetchRooms = async (propertyId: string) => {
        setLoading(prev => ({ ...prev, [propertyId]: true }));
        try {
            const unsubscribe = propertyService.subscribeToRooms(propertyId, (fetchedRooms) => {
                setRooms(prev => ({ ...prev, [propertyId]: fetchedRooms }));
                setLoading(prev => ({ ...prev, [propertyId]: false }));
            });
            return unsubscribe;
        } catch (error: unknown) {
            console.error('Error fetching rooms:', error);
            setLoading(prev => ({ ...prev, [propertyId]: false }));
        }
    };

    const handleUpdateOccupancy = async (propertyId: string, roomId: string, newValue: number) => {
        setSaveLoading(roomId);
        try {
            await propertyService.updateRoomOccupancy(propertyId, roomId, newValue);
            onUpdate();
        } catch (error: unknown) {
            alert('Failed to update occupancy: ' + (error as Error).message);
        } finally {
            setSaveLoading(null);
        }
    };

    return (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 bg-gray-50/50">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <IoPeopleOutline className="text-primary-600" /> Vacancy & Occupancy Manager
                </h3>
                <p className="text-sm text-gray-500 mt-1 italic">
                    Manually adjust occupancy for walk-in customers or offline bookings.
                </p>
            </div>

            <div className="divide-y divide-gray-100">
                {properties.length === 0 && (
                    <div className="p-10 text-center text-gray-500">No properties found.</div>
                )}

                {properties.map(property => (
                    <div key={property.propertyId} className="flex flex-col">
                        <button
                            onClick={() => setExpandedId(expandedId === property.propertyId ? null : property.propertyId)}
                            className="flex items-center justify-between p-6 hover:bg-gray-50 transition-colors"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center">
                                    <IoHomeOutline size={24} />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-gray-900">{property.title}</div>
                                    <div className="text-sm text-gray-500 flex items-center gap-3">
                                        <span>{property.vacancies} Vacancies</span>
                                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                        <span>{property.city}</span>
                                    </div>
                                </div>
                            </div>
                            {expandedId === property.propertyId ? <IoChevronUpOutline /> : <IoChevronDownOutline />}
                        </button>

                        {expandedId === property.propertyId && (
                            <div className="px-6 pb-6 bg-white animate-in slide-in-from-top-2 duration-300">
                                {loading[property.propertyId] ? (
                                    <div className="flex justify-center p-8">
                                        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {rooms[property.propertyId]?.length === 0 && (
                                            <p className="col-span-full text-center text-gray-500 py-4">No rooms added to this property.</p>
                                        )}
                                        {rooms[property.propertyId]?.map(room => (
                                            <div key={room.roomId} className="p-4 rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-between gap-4">
                                                <div>
                                                    <div className="font-bold text-gray-900 leading-tight">Room {room.roomNumber}</div>
                                                    <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider font-semibold">
                                                        Cap: {room.capacity} | {formatCurrency(room.price)}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    <div className="flex flex-col items-center">
                                                        <div className="text-[9px] font-bold text-gray-400 uppercase leading-none mb-1">Occupied</div>
                                                        <div className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-lg px-2 py-1.5 h-9 shadow-sm">
                                                            <span className="font-bold text-xs text-gray-900">{room.bookedCount || 0}</span>
                                                            <span className="text-gray-300 text-[10px]">/</span>
                                                            <span className="text-gray-400 text-[10px] font-medium">{room.capacity}</span>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => handleUpdateOccupancy(property.propertyId, room.roomId, (room.bookedCount || 0) + 1)}
                                                            disabled={saveLoading === room.roomId || (room.bookedCount || 0) >= room.capacity}
                                                            className="h-9 px-3 bg-primary-600 text-white rounded-lg font-bold text-[11px] hover:bg-primary-700 transition-colors disabled:opacity-50"
                                                        >
                                                            Book
                                                        </button>

                                                        <button
                                                            onClick={() => handleUpdateOccupancy(property.propertyId, room.roomId, (room.bookedCount || 0) - 1)}
                                                            disabled={saveLoading === room.roomId || (room.bookedCount || 0) <= 0}
                                                            className="h-9 px-3 bg-white border border-gray-200 text-red-600 rounded-lg font-bold text-[11px] hover:bg-red-50 transition-colors disabled:opacity-50"
                                                        >
                                                            Vacate
                                                        </button>
                                                    </div>

                                                    <div className="flex flex-col items-end shrink-0 min-w-[50px]">
                                                        <div className="text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase">
                                                            {room.availableCount || 0} Left
                                                        </div>
                                                        {saveLoading === room.roomId && (
                                                            <div className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mt-1"></div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default VacancyManager;

