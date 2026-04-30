import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase-config';
import { FiChevronDown, FiChevronRight, FiHome, FiUsers } from 'react-icons/fi';

interface Room {
    id: string;
    room_number: string;
    room_type: string;
    capacity: number;
    price: number;
    is_available: boolean;
}

interface PropertyWithRooms {
    id: string;
    title: string;
    city: string;
    rooms: Room[];
}

const PropertyRoomsTable: React.FC = () => {
    const [properties, setProperties] = useState<PropertyWithRooms[]>([]);
    const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchPropertiesWithRooms();
    }, []);

    const fetchPropertiesWithRooms = async () => {
        try {
            // Fetch all properties
            const { data: propertiesData, error: propError } = await supabase
                .from('properties')
                .select('id, title, city')
                .order('created_at', { ascending: false });

            if (propError) throw propError;

            // Fetch all rooms
            const { data: roomsData, error: roomsError } = await supabase
                .from('rooms')
                .select('*')
                .order('room_number');

            if (roomsError) throw roomsError;

            // Group rooms by property
            const propertiesMap = new Map<string, PropertyWithRooms>();

            propertiesData?.forEach(prop => {
                propertiesMap.set(prop.id, {
                    id: prop.id,
                    title: prop.title,
                    city: prop.city,
                    rooms: []
                });
            });

            roomsData?.forEach(room => {
                const property = propertiesMap.get(room.property_id);
                if (property) {
                    property.rooms.push(room);
                }
            });

            setProperties(Array.from(propertiesMap.values()));
        } catch (error) {
            console.error('Error fetching properties:', error);
        } finally {
            setLoading(false);
        }
    };

    const toggleProperty = (propertyId: string) => {
        const newExpanded = new Set(expandedProperties);
        if (newExpanded.has(propertyId)) {
            newExpanded.delete(propertyId);
        } else {
            newExpanded.add(propertyId);
        }
        setExpandedProperties(newExpanded);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900">Properties & Rooms Management</h2>
                <p className="text-sm text-gray-500 mt-1">View and manage rooms for each property</p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-12"></th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Property</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Location</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Total Rooms</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Property ID</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {properties.map((property) => {
                            const isExpanded = expandedProperties.has(property.id);
                            return (
                                <React.Fragment key={property.id}>
                                    {/* Property Row */}
                                    <tr
                                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                                        onClick={() => toggleProperty(property.id)}
                                    >
                                        <td className="px-6 py-4">
                                            {isExpanded ? (
                                                <FiChevronDown className="text-gray-500" size={18} />
                                            ) : (
                                                <FiChevronRight className="text-gray-500" size={18} />
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                                                    <FiHome className="text-blue-600" size={20} />
                                                </div>
                                                <span className="font-semibold text-gray-900">{property.title}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-gray-600">{property.city}</td>
                                        <td className="px-6 py-4">
                                            <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-semibold">
                                                {property.rooms.length} rooms
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <code className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1 rounded">
                                                {property.id.slice(0, 8)}...
                                            </code>
                                        </td>
                                    </tr>

                                    {/* Expanded Rooms */}
                                    {isExpanded && property.rooms.length > 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-0 bg-gray-50">
                                                <div className="p-4">
                                                    <table className="w-full">
                                                        <thead>
                                                            <tr className="border-b border-gray-200">
                                                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Room #</th>
                                                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Type</th>
                                                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Capacity</th>
                                                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Price</th>
                                                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Status</th>
                                                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Room ID</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-200">
                                                            {property.rooms.map((room) => (
                                                                <tr key={room.id} className="hover:bg-white transition-colors">
                                                                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{room.room_number}</td>
                                                                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{room.room_type}</td>
                                                                    <td className="px-4 py-3 text-sm text-gray-600">
                                                                        <div className="flex items-center gap-1">
                                                                            <FiUsers size={14} />
                                                                            {room.capacity}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">₹{room.price?.toLocaleString() || 'N/A'}</td>
                                                                    <td className="px-4 py-3">
                                                                        {room.is_available ? (
                                                                            <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-semibold">
                                                                                Available
                                                                            </span>
                                                                        ) : (
                                                                            <span className="px-2 py-1 bg-red-50 text-red-700 rounded-md text-xs font-semibold">
                                                                                Occupied
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-4 py-3">
                                                                        <code className="text-xs text-gray-400 font-mono">
                                                                            {room.id.slice(0, 8)}...
                                                                        </code>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                    )}

                                    {/* No Rooms Message */}
                                    {isExpanded && property.rooms.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-4 bg-gray-50">
                                                <p className="text-center text-sm text-gray-500 italic">No rooms added for this property</p>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {properties.length === 0 && (
                <div className="text-center py-12">
                    <FiHome size={48} className="mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500 font-medium">No properties found</p>
                </div>
            )}
        </div>
    );
};

export default PropertyRoomsTable;

