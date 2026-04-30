import React, { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, type To } from 'react-router-dom';
import { IoChatbubbleOutline, IoLogOutOutline, IoNotificationsOutline, IoPersonCircleOutline, IoStarOutline } from 'react-icons/io5';
import { useAuth } from '../../hooks/useAuth';
import { useOwner } from '../../hooks/useOwner';

const navLinks: Array<{
    name: string;
    to: To;
    activeKey: 'dashboard' | 'properties' | 'rooms' | 'bookings' | 'payments' | 'ratings' | 'messages' | 'profile';
}> = [
    { name: 'Dashboard', to: '/dashboard', activeKey: 'dashboard' },
    { name: 'Properties', to: '/properties', activeKey: 'properties' },
    { name: 'Rooms', to: { pathname: '/properties', search: '?nav=rooms' }, activeKey: 'rooms' },
    { name: 'Bookings', to: '/bookings', activeKey: 'bookings' },
    { name: 'Payments', to: '/payments', activeKey: 'payments' },
    { name: 'Ratings', to: '/ratings', activeKey: 'ratings' },
    { name: 'Messages', to: '/messages', activeKey: 'messages' },
    { name: 'Profile', to: '/profile', activeKey: 'profile' },
];

const Navbar: React.FC = () => {
    const { currentUser, signOut } = useAuth();
    const { pendingBookingsCount, verificationStatus, bankVerified } = useOwner();
    const location = useLocation();
    const navigate = useNavigate();
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    useEffect(() => {
        const closeMenu = () => setIsProfileOpen(false);
        window.addEventListener('scroll', closeMenu, { passive: true });
        return () => window.removeEventListener('scroll', closeMenu);
    }, []);

    const activeNavKey = useMemo(() => {
        const navIntent = new URLSearchParams(location.search).get('nav');

        if (location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/')) {
            return 'dashboard';
        }

        if (location.pathname === '/properties' || location.pathname.startsWith('/properties/')) {
            return navIntent === 'rooms' ? 'rooms' : 'properties';
        }

        if (location.pathname === '/bookings' || location.pathname.startsWith('/bookings/')) {
            return 'bookings';
        }

        if (
            location.pathname === '/payments' ||
            location.pathname.startsWith('/payments/') ||
            location.pathname === '/settlements' ||
            location.pathname.startsWith('/settlements/')
        ) {
            return 'payments';
        }

        if (location.pathname === '/ratings' || location.pathname.startsWith('/ratings/')) {
            return 'ratings';
        }

        if (
            location.pathname === '/messages' ||
            location.pathname.startsWith('/messages/') ||
            location.pathname === '/chat' ||
            location.pathname.startsWith('/chat/')
        ) {
            return 'messages';
        }

        if (location.pathname === '/profile' || location.pathname.startsWith('/profile/')) {
            return 'profile';
        }

        return null;
    }, [location.pathname, location.search]);

    const topActionClassName = (active: boolean, visibilityClassName = '') =>
        [
            'owner-topbar-action flex h-11 w-11 items-center justify-center rounded-full border transition-all',
            active && 'owner-topbar-action--active',
            active
                ? 'border-[rgba(249,115,22,0.22)] bg-[rgba(249,115,22,0.12)] text-[var(--rf-color-action)] shadow-[0_10px_22px_rgba(249,115,22,0.16)]'
                : 'border-[rgba(229,231,235,0.92)] bg-white text-[var(--rf-color-text-secondary)] hover:text-[var(--rf-color-action-hover)] hover:border-[rgba(249,115,22,0.18)] hover:bg-[rgba(249,115,22,0.08)]',
            visibilityClassName,
        ].filter(Boolean).join(' ');

    if (!currentUser) return null;

    return (
        <nav className="owner-topbar sticky top-0 z-50 transition-all duration-300">
            <div className="owner-topbar-inner max-w-7xl mx-auto px-4 lg:px-6">
                <div className="flex h-16 items-center justify-between gap-4 md:h-20">
                    <Link to="/dashboard" className="owner-topbar-logo flex items-center gap-3">
                        <img
                            src={`${import.meta.env.BASE_URL}assets/images/logos/logo-inline.png`}
                            alt="RoomFindR"
                            className="owner-topbar-logo-img h-10 md:h-12 w-auto max-w-[196px] rounded-[18px] object-contain shadow-[0_10px_22px_rgba(37,99,235,0.18)]"
                        />
                        <span className="owner-topbar-badge hidden rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] sm:inline-flex">
                            Owner Portal
                        </span>
                    </Link>

                    <div className="hidden flex-1 items-center justify-center md:flex">
                        <div className="rf-nav-surface flex items-center gap-1 overflow-x-auto px-2 py-2 no-scrollbar">
                            {navLinks.map((link) => (
                                <NavLink
                                    key={link.activeKey}
                                    to={link.to}
                                    className={() => `rounded-full px-4 py-2 text-sm font-semibold transition-all ${activeNavKey === link.activeKey
                                        ? 'bg-[linear-gradient(135deg,var(--rf-color-action),var(--rf-color-action-hover))] text-white shadow-[0_10px_22px_rgba(249,115,22,0.28)]'
                                        : 'text-[var(--rf-color-text-secondary)] hover:bg-[rgba(249,115,22,0.08)] hover:text-[var(--rf-color-action-hover)]'
                                        }`}
                                >
                                    {link.name}
                                </NavLink>
                            ))}
                        </div>
                    </div>

                    <div className="owner-topbar-actions flex items-center gap-3">
                        <Link
                            to="/messages"
                            className={topActionClassName(activeNavKey === 'messages')}
                            title="Messages"
                        >
                            <IoChatbubbleOutline size={21} />
                        </Link>

                        <Link
                            to="/ratings"
                            className={topActionClassName(activeNavKey === 'ratings', 'md:hidden')}
                            title="Ratings"
                        >
                            <IoStarOutline size={21} />
                        </Link>

                        <Link
                            to="/bookings"
                            className="owner-topbar-action relative hidden h-11 w-11 items-center justify-center rounded-full text-[var(--rf-color-text-secondary)] transition-all hover:text-[var(--rf-color-primary-green-dark)] md:flex"
                            title="Booking requests"
                        >
                            <IoNotificationsOutline size={21} />
                            {pendingBookingsCount > 0 && (
                                <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[var(--rf-color-action)] ring-2 ring-white" />
                            )}
                        </Link>

                        <div className="relative z-50">
                            <button
                                onClick={() => setIsProfileOpen((previous) => !previous)}
                                onBlur={() => setTimeout(() => setIsProfileOpen(false), 160)}
                                className="owner-topbar-profile flex items-center gap-3 rounded-full pl-1 pr-1 py-1 transition-all md:pr-4"
                            >
                                <img
                                    src={currentUser?.photoURL || 'https://ui-avatars.com/api/?name=Owner&background=16A34A&color=ffffff'}
                                    alt="Profile"
                                    className="owner-topbar-avatar h-9 w-9 rounded-full object-cover ring-2 ring-white"
                                />
                                <div className="hidden text-left leading-none md:flex md:flex-col">
                                    <span className="max-w-[100px] truncate text-sm font-semibold text-[var(--rf-color-text)]">
                                        {currentUser.displayName?.split(' ')[0] || 'Owner'}
                                    </span>
                                    <span className={`mt-0.5 text-[10px] font-semibold ${bankVerified ? 'text-[var(--rf-color-primary-green-dark)]' : verificationStatus ? 'text-indigo-600' : 'text-[var(--rf-color-warning)]'}`}>
                                        {bankVerified ? 'Verified' : verificationStatus ? 'Approved' : 'Pending review'}
                                    </span>
                                </div>
                            </button>

                            {isProfileOpen && (
                                <div
                                    className="animate-fade-in-down absolute right-0 mt-3 w-60 overflow-hidden rounded-3xl border border-[rgba(229,231,235,0.92)] bg-white py-2 shadow-[0_24px_48px_rgba(15,23,42,0.14)]"
                                    onMouseDown={(event) => event.stopPropagation()}
                                >
                                    <div className="border-b border-[rgba(229,231,235,0.82)] px-4 py-3">
                                        <p className="truncate text-sm font-semibold text-[var(--rf-color-text)]">{currentUser?.displayName}</p>
                                        <p className="truncate text-xs text-[var(--rf-color-text-secondary)]">{currentUser?.email}</p>
                                    </div>
                                    <button
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            setIsProfileOpen(false);
                                            navigate('/profile');
                                        }}
                                        className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--rf-color-text-secondary)] transition-colors hover:bg-[rgba(59,130,246,0.08)] hover:text-[var(--rf-color-primary-green-dark)]"
                                    >
                                        <IoPersonCircleOutline size={18} />
                                        Profile Settings
                                    </button>
                                    <button
                                        onMouseDown={async (event) => {
                                            event.preventDefault();
                                            await signOut();
                                        }}
                                        className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--rf-color-error)] transition-colors hover:bg-[rgba(239,68,68,0.08)]"
                                    >
                                        <IoLogOutOutline size={18} />
                                        Sign Out
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
