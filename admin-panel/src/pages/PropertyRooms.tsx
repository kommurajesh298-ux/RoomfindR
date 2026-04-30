import React from 'react';
import PropertyRoomsTable from '../components/properties/PropertyRoomsTable';

const PropertyRooms: React.FC = () => {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Property & Rooms Management</h1>
                <p className="text-slate-600">Manage all properties and their rooms in one view</p>
            </div>

            <PropertyRoomsTable />
        </div>
    );
};

export default PropertyRooms;
