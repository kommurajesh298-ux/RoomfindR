import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { chatService } from '../../services/chat.service';
import { notificationService } from '../../services/notification.service';

const BottomNav: React.FC = () => {
    const location = useLocation();
    const { currentUser } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);
    const [unreadChatCount, setUnreadChatCount] = useState(0);

    useEffect(() => {
        if (!currentUser) return;
        let isActive = true;

        const syncUnreadChats = async () => {
            const totalUnread = await chatService.getTotalUnreadCount(currentUser.id);
            if (isActive) {
                setUnreadChatCount(totalUnread);
            }
        };

        const unsubscribeNotifications = notificationService.subscribeToUnread(currentUser.id, (count) => {
            setUnreadCount(count);
        });

        const unsubscribeChats = chatService.subscribeToTotalUnread(currentUser.id, (count) => {
            setUnreadChatCount(count);
        });

        const refreshUnreadCount = () => {
            void syncUnreadChats();
        };

        void syncUnreadChats();
        const refreshTimer = window.setInterval(refreshUnreadCount, 3000);
        window.addEventListener('focus', refreshUnreadCount);
        document.addEventListener('visibilitychange', refreshUnreadCount);

        return () => {
            isActive = false;
            window.clearInterval(refreshTimer);
            window.removeEventListener('focus', refreshUnreadCount);
            document.removeEventListener('visibilitychange', refreshUnreadCount);
            unsubscribeNotifications();
            unsubscribeChats();
        };
    }, [currentUser, location.pathname]);

    const navItems = [
        { path: '/', label: 'Home', badge: 0, icon: (
            <svg className="rfm-bottom-svg h-[22px] w-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-9.5Z" />
            </svg>
        ) },
        { path: '/bookings', label: 'Bookings', badge: unreadCount, icon: (
            <svg className="rfm-bottom-svg h-[22px] w-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
            </svg>
        ) },
        { path: '/chat', label: 'PG Portal', badge: unreadChatCount, icon: (
            <svg className="rfm-bottom-svg h-[22px] w-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v16H4zM9 9h2v2H9zm4 0h2v2h-2zm-4 4h2v2H9zm4 0h2v2h-2z" />
            </svg>
        ) },
        { path: '/profile', label: 'Profile', badge: 0, icon: (
            <svg className="rfm-bottom-svg h-[22px] w-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4 20a8 8 0 1 1 16 0" />
            </svg>
        ) },
    ];

    const isActive = (path: string) => {
        if (path === '/') return location.pathname === '/';
        return location.pathname === path || location.pathname.startsWith(`${path}/`);
    };

    return (
        <nav className="rfm-bottom-nav sm:hidden fixed bottom-0 left-0 right-0 z-50 pb-safe">
            <div className="rfm-bottom-nav-grid grid grid-cols-4 items-center">
                {navItems.map((item) => (
                    <Link
                        key={item.path}
                        to={item.path}
                        className={`rfm-bottom-item group relative flex h-full flex-col items-center justify-center ${isActive(item.path) ? 'is-active' : ''}`}
                    >
                        <span className={`rfm-bottom-active-line ${isActive(item.path) ? 'opacity-100' : 'opacity-0'}`} />
                        <div className="rfm-bottom-icon relative flex items-center justify-center">
                            {item.icon}
                            {item.badge > 0 && (
                                <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--rf-color-action),var(--rf-color-action-hover))] px-1 text-[10px] font-bold text-white shadow-[var(--rf-shadow-action)]">
                                    {item.badge > 9 ? '9+' : item.badge}
                                </span>
                            )}
                        </div>
                        <span className="rfm-bottom-label">
                            {item.label}
                        </span>
                    </Link>
                ))}
            </div>
        </nav>
    );
};

export default BottomNav;
