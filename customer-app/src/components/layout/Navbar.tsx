import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useLayout } from '../../hooks/useLayout';
import { chatService } from '../../services/chat.service';
import { notificationService } from '../../services/notification.service';

interface NavbarProps {
    currentLocation?: string;
    onLocationClick?: () => void;
}

const formatFallbackName = (value?: string | null) => {
    const trimmed = value?.trim();
    if (!trimmed) return '';

    const normalized = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
    return normalized
        .split(/[._\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

const Navbar: React.FC<NavbarProps> = ({ currentLocation = 'Select Location', onLocationClick }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [unreadCount, setUnreadCount] = useState(0);
    const [unreadChatCount, setUnreadChatCount] = useState(0);
    const navbarRef = useRef<HTMLElement>(null);
    const navigate = useNavigate();
    const location = useLocation();
    const { currentUser: user, userData } = useAuth();
    const { setFilterPanelOpen, showNavbarSearch } = useLayout();

    const isHome = location.pathname === '/';
    const isExplore = location.pathname === '/explore';
    const isSearchRoute = isHome || isExplore;
    const showSearchOnMobile = isSearchRoute && showNavbarSearch;

    useEffect(() => {
        if (!user) return;

        const unsubscribeNotifs = notificationService.subscribeToUnread(user.id, (count) => {
            setUnreadCount(count);
        });
        const unsubscribeChats = chatService.subscribeToTotalUnread(user.id, (count) => {
            setUnreadChatCount(count);
        });

        return () => {
            unsubscribeNotifs();
            unsubscribeChats();
        };
    }, [user]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (!searchQuery) return;
            navigate(`/?search=${encodeURIComponent(searchQuery)}`);
        }, 320);

        return () => window.clearTimeout(timer);
    }, [navigate, searchQuery]);

    useEffect(() => {
        const updateNavbarHeight = () => {
            const nextHeight = navbarRef.current?.getBoundingClientRect().height;
            if (!nextHeight) return;

            document.documentElement.style.setProperty(
                '--rfm-navbar-mobile-height',
                `${Math.round(nextHeight)}px`
            );
        };

        const frame = window.requestAnimationFrame(updateNavbarHeight);

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateNavbarHeight);

            return () => {
                window.cancelAnimationFrame(frame);
                window.removeEventListener('resize', updateNavbarHeight);
            };
        }

        const observer = new ResizeObserver(() => updateNavbarHeight());
        if (navbarRef.current) {
            observer.observe(navbarRef.current);
        }

        window.addEventListener('resize', updateNavbarHeight);

        return () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener('resize', updateNavbarHeight);
        };
    }, [showSearchOnMobile]);

    const handleSearch = (event: React.FormEvent) => {
        event.preventDefault();
        if (!searchQuery.trim()) {
            navigate('/');
            return;
        }
        navigate(`/?search=${encodeURIComponent(searchQuery.trim())}`);
    };

    const desktopLinks = [
        { path: '/', label: 'Home' },
        { path: '/explore', label: 'Search' },
        { path: '/bookings', label: 'Bookings', badge: unreadCount },
        { path: '/chat', label: 'Chat', badge: unreadChatCount }
    ];

    const displayName =
        userData?.name?.trim()
        || user?.user_metadata?.name?.trim()
        || formatFallbackName(user?.email)
        || formatFallbackName(user?.phone)
        || 'Guest User';
    const avatarImage = userData?.profilePhotoUrl || user?.user_metadata?.avatar_url || '';
    const avatarInitial = displayName.charAt(0).toUpperCase() || 'U';

    return (
        <nav ref={navbarRef} className="rfm-navbar fixed left-0 top-0 z-[100] w-full">
            <div className="rfm-navbar-shell">
                <div className="mx-auto max-w-[1280px]">
                    <div className="hidden items-center gap-4 px-6 py-4 md:flex">
                        <Link to="/" className="hidden items-center lg:flex">
                            <img
                                src={`${import.meta.env.BASE_URL}assets/images/logos/logo-inline.png`}
                                alt="RoomFindR"
                                className="rfm-logo-image no-logo-badge h-12 w-auto max-w-[210px] object-contain"
                            />
                        </Link>

                        <button
                            onClick={onLocationClick}
                            aria-label={`Current location: ${currentLocation}`}
                            className="rfm-navbar-location flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-[var(--rf-color-text-secondary)] lg:border-[#D7E4FF] lg:bg-white lg:text-[#173B8F]"
                        >
                            <svg className="h-4 w-4 text-[#2B63D9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657 13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                            <span className="max-w-[120px] truncate">{currentLocation}</span>
                        </button>

                        <div className="flex-1">
                            <form onSubmit={handleSearch} className="rfm-navbar-search flex h-[52px] items-center rounded-[10px] px-4">
                                <svg className="h-5 w-5 text-[var(--rf-color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.75 18a7.25 7.25 0 1 1 0-14.5 7.25 7.25 0 0 1 0 14.5Z" />
                                </svg>
                                <input
                                    id="navbar-search"
                                    name="search"
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search for PGs, Hostels, Areas..."
                                    className="rfm-navbar-input h-full flex-1 border-none bg-transparent px-3 text-sm outline-none"
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    aria-label="Open filters"
                                    onClick={() => setFilterPanelOpen(true)}
                                    className="rfm-navbar-filter-btn flex h-10 w-10 items-center justify-center rounded-[10px]"
                                >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                    </svg>
                                </button>
                            </form>
                        </div>

                        <div className="rf-nav-surface hidden items-center gap-1 px-2 py-2 lg:flex lg:rounded-full lg:border lg:border-[#D7E4FF] lg:bg-white lg:shadow-[0_12px_30px_rgba(22,59,140,0.08)]">
                            {desktopLinks.map((link) => {
                                const active = link.path === '/'
                                    ? location.pathname === '/'
                                    : location.pathname === link.path || location.pathname.startsWith(`${link.path}/`);

                                return (
                                    <Link
                                        key={link.path}
                                        to={link.path}
                                        className={`relative rounded-full px-4 py-2 text-sm font-semibold transition-all ${active
                                            ? 'bg-[#EAF1FF] text-[#1F4FD1] shadow-[inset_0_0_0_1px_rgba(43,99,217,0.12)]'
                                            : 'text-[#183B8F] hover:bg-[#FFF1E5] hover:text-[#F47A20]'
                                            }`}
                                    >
                                        {link.label}
                                        {link.badge && link.badge > 0 ? (
                                            <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--rf-color-action),var(--rf-color-action-hover))] px-1 text-[10px] font-bold text-white">
                                                {link.badge > 9 ? '9+' : link.badge}
                                            </span>
                                        ) : null}
                                    </Link>
                                );
                            })}
                        </div>

                        {user ? (
                            <Link to="/profile" className="rfm-navbar-avatar flex h-10 w-10 items-center justify-center overflow-hidden rounded-full">
                                {avatarImage ? (
                                    <img src={avatarImage} alt="Me" className="h-full w-full rounded-full object-cover" />
                                ) : (
                                    <span className="rfm-navbar-avatar-initial">{avatarInitial}</span>
                                )}
                            </Link>
                        ) : (
                            <Link to="/login" className="rfm-navbar-login rounded-full px-5 py-2.5 text-sm font-semibold lg:border-[#FFB36E] lg:bg-[linear-gradient(135deg,#FF9A2F_0%,#F47A20_100%)] lg:text-white lg:shadow-[0_12px_24px_rgba(244,122,32,0.24)]">
                                Login
                            </Link>
                        )}
                    </div>

                    <div className="md:hidden">
                        <div className="rfm-navbar-mobile-head flex h-[76px] items-center gap-3 px-4">
                            <Link to="/" className="rfm-navbar-mobile-logo flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                                <img
                                    src={`${import.meta.env.BASE_URL}assets/images/logos/logo.png`}
                                    alt="RoomFindR"
                                    className="h-10 w-10 rounded-xl object-contain"
                                />
                            </Link>

                            <button
                                type="button"
                                onClick={onLocationClick}
                                className="rfm-navbar-mobile-meta flex min-w-0 flex-1 flex-col rounded-[20px] border border-white/18 bg-white/10 px-3 py-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-sm"
                                aria-label={`Current location: ${currentLocation}`}
                            >
                                <span className="rfm-navbar-mobile-name flex min-w-0 items-center gap-2 text-[17px] font-extrabold tracking-[-0.01em] text-white drop-shadow-[0_1px_6px_rgba(10,31,84,0.35)]">
                                    <svg className="h-4 w-4 shrink-0 text-[#D7E8FF]" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M3.4 11.3 18.6 5c.8-.3 1.6.5 1.3 1.3l-6.3 15.2c-.3.8-1.5.8-1.8 0l-2.2-5.5a1 1 0 0 0-.6-.6l-5.5-2.2c-.8-.3-.8-1.5-.1-1.7Z" />
                                    </svg>
                                    <span className="truncate">{displayName}</span>
                                    <svg className="h-4 w-4 shrink-0 text-[#D7E8FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                                    </svg>
                                </span>
                                <span className="rfm-navbar-mobile-city truncate text-[13px] font-semibold tracking-[0.01em] text-[#DDE7FF]">
                                    {currentLocation}
                                </span>
                            </button>

                            {user ? (
                                <Link to="/profile" className="rfm-navbar-mobile-avatar flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full">
                                    {avatarImage ? (
                                        <img src={avatarImage} alt="Me" className="h-full w-full rounded-full object-cover" />
                                    ) : (
                                        <span className="rfm-navbar-avatar-initial">{avatarInitial}</span>
                                    )}
                                </Link>
                            ) : (
                                <Link to="/login" className="rfm-navbar-mobile-login flex h-11 shrink-0 items-center justify-center rounded-full px-4 text-[12px] font-bold text-white">
                                    Login
                                </Link>
                            )}
                        </div>

                        <div
                            className={[
                                'overflow-hidden px-4 transition-[max-height,opacity,transform,padding] duration-300 ease-out',
                                showSearchOnMobile
                                    ? 'max-h-[60px] translate-y-0 pb-1 opacity-100'
                                    : 'pointer-events-none max-h-0 -translate-y-2 pb-0 opacity-0'
                            ].join(' ')}
                            aria-hidden={!showSearchOnMobile}
                        >
                            <form onSubmit={handleSearch} className="rfm-navbar-search rfm-navbar-search-mobile flex h-[46px] items-center rounded-[10px] px-3">
                                <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.7}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.75 18a7.25 7.25 0 1 1 0-14.5 7.25 7.25 0 0 1 0 14.5Z" />
                                </svg>
                                <input
                                    id="navbar-search-mobile"
                                    name="search"
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search for PGs, Hostels, Areas..."
                                    className="rfm-navbar-input h-full flex-1 border-none bg-transparent px-2 text-[13px] font-medium outline-none"
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    aria-label="Open filters"
                                    onClick={() => setFilterPanelOpen(true)}
                                    className="rfm-navbar-filter-btn flex h-[38px] w-[38px] items-center justify-center rounded-[10px]"
                                >
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                    </svg>
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;


