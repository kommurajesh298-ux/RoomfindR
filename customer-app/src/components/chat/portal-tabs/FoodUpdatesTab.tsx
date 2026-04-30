import { useState, useEffect } from 'react';
import { propertyService } from '../../../services/property.service';
import type { FoodMenuItem, Property } from '../../../types/property.types';
import { FaCoffee, FaSun, FaMoon } from 'react-icons/fa';

interface FoodUpdatesTabProps {
    property: Property;
}

const FoodUpdatesTab = ({ property }: FoodUpdatesTabProps) => {
    const [menu, setMenu] = useState<FoodMenuItem[]>(property.foodMenu || []);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = propertyService.subscribeToFoodMenu(property.propertyId, (data) => {
            if (data.length > 0) {
                setMenu(data);
            } else if (property.foodMenu && property.foodMenu.length > 0) {
                setMenu(property.foodMenu);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [property.propertyId, property.foodMenu]);

    const isToday = (day: string) => {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = days[new Date().getDay()];
        return day.toLowerCase() === today.toLowerCase();
    };

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between px-1">
                <h3 className="text-[20px] font-semibold text-[#111827]">Weekly Menu</h3>
                <span className="text-[11px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-full uppercase tracking-widest">Live</span>
            </div>

            {menu.length === 0 && !loading ? (
                <div className="bg-white rounded-[18px] p-10 text-center border border-dashed border-gray-200 shadow-sm">
                    <p className="text-[#6B7280] text-[14px]">No food menu posted yet for this property.</p>
                </div>
            ) : (
                menu.map((item) => (
                    <div
                        key={item.dayOfWeek}
                        className={`bg-white rounded-[18px] border ${isToday(item.dayOfWeek) ? 'border-orange-200' : 'border-gray-100'} shadow-sm overflow-hidden`}
                    >
                        <div className={`px-4 py-3 border-b flex justify-between items-center ${isToday(item.dayOfWeek) ? 'bg-orange-50 border-orange-100' : 'bg-gray-50 border-gray-100'}`}>
                            <span className={`text-[14px] font-bold ${isToday(item.dayOfWeek) ? 'text-orange-700' : 'text-gray-900'}`}>
                                {item.dayOfWeek}
                            </span>
                            {isToday(item.dayOfWeek) && <span className="text-[10px] font-black bg-orange-600 text-white px-2 py-1 rounded-full">TODAY</span>}
                        </div>
                        <div className="p-4 space-y-4">
                            {/* Meals aligned consistently with Info Card typography */}
                            <div className="flex items-center gap-4">
                                <div className="w-[40px] h-[40px] rounded-[12px] bg-yellow-50 flex items-center justify-center text-yellow-600 shrink-0">
                                    <FaCoffee size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest leading-none mb-1">Breakfast</p>
                                    <p className="text-[15px] font-semibold text-[#111827] leading-tight">{item.breakfast || 'Not specified'}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="w-[40px] h-[40px] rounded-[12px] bg-orange-50 flex items-center justify-center text-orange-600 shrink-0">
                                    <FaSun size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest leading-none mb-1">Lunch</p>
                                    <p className="text-[15px] font-semibold text-[#111827] leading-tight">{item.lunch || 'Not specified'}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="w-[40px] h-[40px] rounded-[12px] bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                                    <FaMoon size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest leading-none mb-1">Dinner</p>
                                    <p className="text-[15px] font-semibold text-[#111827] leading-tight">{item.dinner || 'Not specified'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ))
            )}

            {loading && (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-32 bg-gray-50 rounded-2xl animate-pulse"></div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FoodUpdatesTab;
