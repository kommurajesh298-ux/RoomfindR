import React from 'react';
import { NavLink } from 'react-router-dom';
import { IoBusinessOutline, IoCalendarOutline, IoCardOutline, IoHomeOutline } from 'react-icons/io5';
import { useOwner } from '../../hooks/useOwner';

const BottomNav: React.FC = () => {
    const { pendingBookingsCount } = useOwner();

    const navItems = [
        { path: '/dashboard', label: 'Dashboard', icon: IoHomeOutline },
        { path: '/properties', label: 'Properties', icon: IoBusinessOutline },
        { path: '/bookings', label: 'Bookings', icon: IoCalendarOutline, badge: pendingBookingsCount },
        { path: '/settlements', label: 'Payments', icon: IoCardOutline },
    ];

    return (
        <div className="owner-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-50 pb-safe">
            <div className="owner-bottom-nav-grid grid grid-cols-4 items-center">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => `owner-bottom-item group relative flex h-full flex-col items-center justify-center ${isActive ? 'is-active' : ''}`}
                    >
                        {({ isActive }) => (
                            <>
                                <span className={`owner-bottom-active-line ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                                <div className="owner-bottom-icon relative flex items-center justify-center transition-all">
                                    <item.icon size={22} />
                                    {item.badge && item.badge > 0 ? (
                                        <span className="absolute -right-1 -top-1 block min-w-[18px] rounded-full bg-[linear-gradient(135deg,var(--rf-color-action),var(--rf-color-action-hover))] px-1 text-center text-[10px] font-bold leading-[18px] text-white">
                                            {item.badge > 9 ? '9+' : item.badge}
                                        </span>
                                    ) : null}
                                </div>
                                <span className="owner-bottom-label">{item.label}</span>
                            </>
                        )}
                    </NavLink>
                ))}
            </div>
        </div>
    );
};

export default BottomNav;


