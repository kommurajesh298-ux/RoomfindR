import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiBell, FiChevronRight, FiHome, FiMenu, FiSearch, FiUser } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { browserNotificationService } from '../../services/browser-notification.service';
import { NotificationService, type Notification } from '../../services/notification.service';
import { SearchService } from '../../services/search.service';
import type { SearchResult } from '../../services/search.service';

interface TopBarProps {
    onMenuClick?: () => void;
}

const resolveNotificationRoute = (notification: Notification) => {
    const data = notification.data || {};
    const explicitRoute = String(data.route || '').trim();
    if (explicitRoute.startsWith('/')) return explicitRoute;

    const type = String(notification.type || '').trim().toLowerCase();
    if (type.includes('refund')) return '/refunds';
    if (type.includes('settlement') || type.includes('payout') || type.includes('payment')) return '/settlements';
    if (type.includes('ticket') || type.includes('support')) return '/tickets';
    if (type.includes('booking')) return '/bookings';
    return '/dashboard';
};

const TopBar: React.FC<TopBarProps> = ({ onMenuClick }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { admin } = useAuth();
    const [searchQuery, setSearchQuery] = React.useState('');
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = React.useState(false);
    const [showResults, setShowResults] = React.useState(false);
    const [notifications, setNotifications] = React.useState<Notification[]>([]);
    const [showNotifications, setShowNotifications] = React.useState(false);
    const lastToastNotificationId = React.useRef<string>('');
    const hasHydratedNotifications = React.useRef(false);
    const unreadCount = notifications.filter((notification) => !notification.is_read).length;
    const breadcrumbLabels: Record<string, string> = {
        settlements: 'Advance',
    };

    React.useEffect(() => {
        const timer = window.setTimeout(async () => {
            if (searchQuery.length < 2) {
                setResults([]);
                setShowResults(false);
                return;
            }

            setIsSearching(true);
            const searchResults = await SearchService.globalSearch(searchQuery);
            setResults(searchResults);
            setIsSearching(false);
            setShowResults(true);
        }, 280);

        return () => window.clearTimeout(timer);
    }, [searchQuery]);

    React.useEffect(() => {
        if (admin?.uid) {
            void browserNotificationService.requestPermission();
        }
    }, [admin?.uid]);

    React.useEffect(() => {
        if (!admin?.uid) return;

        const unsubscribe = NotificationService.subscribeToNotifications(admin.uid, (nextNotifications) => {
            setNotifications(nextNotifications);
            const latest = nextNotifications[0];
            if (!latest) return;

            if (!hasHydratedNotifications.current) {
                hasHydratedNotifications.current = true;
                lastToastNotificationId.current = latest.id;
                return;
            }

            if (latest.id === lastToastNotificationId.current) return;

            lastToastNotificationId.current = latest.id;
            if (!latest.is_read) {
                toast(latest.message, { duration: 4200, position: 'top-right' });
            }
        });

        return () => {
            hasHydratedNotifications.current = false;
            lastToastNotificationId.current = '';
            unsubscribe();
        };
    }, [admin?.uid]);

    const breadcrumbs = location.pathname.split('/').filter(Boolean);

    const handleResultClick = (link: string) => {
        navigate(link);
        setShowResults(false);
        setSearchQuery('');
    };

    const handleMarkAsRead = async (id: string) => {
        await NotificationService.markAsRead(id);
        setNotifications((previous) => previous.map((notification) => notification.id === id ? { ...notification, is_read: true } : notification));
    };

    const handleMarkAllRead = async () => {
        if (!admin?.uid) return;
        await NotificationService.markAllAsRead(admin.uid);
        setNotifications((previous) => previous.map((notification) => ({ ...notification, is_read: true })));
        toast.success('All notifications marked as read');
    };

    return (
        <header className="sticky top-0 z-40 border-b border-[rgba(229,231,235,0.92)] bg-[rgba(255,255,255,0.9)] px-4 py-4 backdrop-blur-xl md:px-8">
            <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4 md:gap-6">
                    <button
                        onClick={onMenuClick}
                        className="rounded-2xl border border-[rgba(229,231,235,0.92)] bg-white p-2 text-[var(--rf-color-text-secondary)] md:hidden"
                    >
                        <FiMenu size={22} />
                    </button>

                    <div className="hidden items-center gap-2 text-sm text-[var(--rf-color-text-secondary)] md:flex">
                        <span className="font-medium">Admin</span>
                        <FiChevronRight className="text-[var(--rf-color-text-muted)]" />
                        {breadcrumbs.length === 0 ? (
                            <span className="font-semibold text-[var(--rf-color-text)]">Dashboard</span>
                        ) : (
                            breadcrumbs.map((crumb, index) => (
                                <React.Fragment key={crumb + index}>
                                    {index > 0 && <FiChevronRight className="text-[var(--rf-color-text-muted)]" />}
                                    <span className={index === breadcrumbs.length - 1 ? 'font-semibold text-[var(--rf-color-text)]' : ''}>
                                        {breadcrumbLabels[crumb] || (crumb.charAt(0).toUpperCase() + crumb.slice(1))}
                                    </span>
                                </React.Fragment>
                            ))
                        )}
                    </div>

                    <div className="relative hidden lg:block">
                        <div className="rf-input-shell rf-input-shell-search w-[320px]">
                            <FiSearch className="text-[var(--rf-color-text-muted)]" />
                            <input
                                id="admin-global-search"
                                name="globalSearch"
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
                                placeholder="Search users, properties, bookings"
                                className="rf-input"
                            />
                        </div>

                        {showResults && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setShowResults(false)} />
                                <div className="animate-fade-in-down absolute left-0 top-full z-20 mt-2 w-[380px] overflow-hidden rounded-3xl border border-[rgba(229,231,235,0.92)] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.14)]">
                                    <div className="max-h-[400px] overflow-y-auto p-2">
                                        {isSearching ? (
                                            <div className="p-4 text-sm text-[var(--rf-color-text-secondary)]">Searching...</div>
                                        ) : results.length > 0 ? (
                                            <div className="space-y-1">
                                                {results.map((result) => (
                                                    <button
                                                        key={result.id}
                                                        onClick={() => handleResultClick(result.link)}
                                                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[rgba(249,115,22,0.08)]"
                                                    >
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(59, 130, 246,0.12)] text-[var(--rf-color-primary-green-dark)]">
                                                            {result.type === 'navigation' ? <FiHome size={16} /> : <FiSearch size={16} />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-sm font-semibold text-[var(--rf-color-text)]">{result.title}</div>
                                                            <div className="truncate text-xs text-[var(--rf-color-text-secondary)]">{result.subtitle}</div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="p-8 text-center text-sm text-[var(--rf-color-text-secondary)]">
                                                No results found for "{searchQuery}"
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <button
                            onClick={() => setShowNotifications((previous) => !previous)}
                            className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(229,231,235,0.92)] bg-white text-[var(--rf-color-text-secondary)] transition-colors hover:bg-[rgba(249,115,22,0.08)] hover:text-[var(--rf-color-action-hover)]"
                        >
                            <FiBell size={20} />
                            {unreadCount > 0 && (
                                <span className="absolute right-2 top-2.5 flex min-w-[18px] items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--rf-color-action),var(--rf-color-action-hover))] px-1 text-[10px] font-bold text-white">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </span>
                            )}
                        </button>

                        {showNotifications && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setShowNotifications(false)} />
                                <div className="animate-fade-in-down absolute right-0 top-full z-20 mt-2 w-80 overflow-hidden rounded-3xl border border-[rgba(229,231,235,0.92)] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.14)] md:w-96">
                                    <div className="flex items-center justify-between border-b border-[rgba(229,231,235,0.92)] px-4 py-4">
                                        <h3 className="font-semibold text-[var(--rf-color-text)]">Notifications</h3>
                                        {unreadCount > 0 && (
                                            <button onClick={handleMarkAllRead} className="text-xs font-semibold text-[var(--rf-color-primary-green-dark)]">
                                                Mark all read
                                            </button>
                                        )}
                                    </div>
                                    <div className="max-h-[380px] overflow-y-auto">
                                        {notifications.length > 0 ? notifications.map((notification) => (
                                            <div
                                                key={notification.id}
                                                className={`cursor-pointer border-b border-[rgba(229,231,235,0.72)] px-4 py-4 transition-colors hover:bg-[rgba(249,115,22,0.06)] ${!notification.is_read ? 'bg-[rgba(59, 130, 246,0.08)]' : ''}`}
                                                onClick={() => {
                                                    if (!notification.is_read) void handleMarkAsRead(notification.id);
                                                    navigate(resolveNotificationRoute(notification));
                                                    setShowNotifications(false);
                                                }}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-semibold text-[var(--rf-color-text)]">{notification.title}</p>
                                                        <p className="mt-1 text-xs leading-5 text-[var(--rf-color-text-secondary)]">{notification.message}</p>
                                                    </div>
                                                    <span className="whitespace-nowrap text-[10px] text-[var(--rf-color-text-muted)]">
                                                        {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                                                    </span>
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="p-8 text-center text-sm text-[var(--rf-color-text-secondary)]">No notifications yet</div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="hidden h-8 w-px bg-[rgba(229,231,235,0.92)] md:block" />

                    <div className="flex items-center gap-3 rounded-full border border-[rgba(229,231,235,0.92)] bg-white px-2 py-1 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                        <div className="hidden text-right md:block">
                            <span className="block text-sm font-semibold text-[var(--rf-color-text)]">Admin</span>
                            <span className="block text-[11px] text-[var(--rf-color-text-secondary)]">Control center</span>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--rf-color-primary-green),var(--rf-color-primary-green-dark))] text-white">
                            <FiUser size={18} />
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default TopBar;


