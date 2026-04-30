import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    FiActivity,
    FiCalendar,
    FiChevronLeft,
    FiChevronRight,
    FiCreditCard,
    FiFlag,
    FiHome,
    FiLayers,
    FiLogOut,
    FiMessageSquare,
    FiRotateCcw,
    FiSettings,
    FiTag,
    FiUsers,
    FiX,
    FiDollarSign,
} from 'react-icons/fi';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeReports } from '../../hooks/useRealtimeReports';

interface SidebarProps {
    collapsed: boolean;
    toggleCollapsed: () => void;
    mobileOpen: boolean;
    setMobileOpen: (open: boolean) => void;
    pendingOwnersCount: number;
}

const Sidebar: React.FC<SidebarProps> = ({
    collapsed,
    toggleCollapsed,
    mobileOpen,
    setMobileOpen,
    pendingOwnersCount
}) => {
    const { signOut, admin } = useAuth();
    const { reportCount } = useRealtimeReports();

    const navSections = [
        {
            label: 'Core',
            items: [
                { name: 'Dashboard', icon: FiHome, path: '/dashboard' },
                { name: 'Owners', icon: FiUsers, path: '/owners', badge: pendingOwnersCount },
                { name: 'Customers', icon: FiUsers, path: '/customers' },
                { name: 'Properties', icon: FiLayers, path: '/properties' },
                { name: 'Rooms', icon: FiLayers, path: '/property-rooms' },
            ]
        },
        {
            label: 'Approvals',
            items: [
                { name: 'Bookings', icon: FiCalendar, path: '/bookings' },
            ]
        },
        {
            label: 'Payments',
            items: [
                { name: 'Rent', icon: FiCreditCard, path: '/rent' },
                { name: 'Advance', icon: FiDollarSign, path: '/settlements' },
                { name: 'Refunds', icon: FiRotateCcw, path: '/refunds' },
            ]
        },
        {
            label: 'Reports',
            items: [
                { name: 'Reports', icon: FiFlag, path: '/reports', badge: reportCount },
                { name: 'Analytics', icon: FiActivity, path: '/analytics' },
                { name: 'Offers', icon: FiTag, path: '/offers' },
                { name: 'Support', icon: FiMessageSquare, path: '/tickets' },
                { name: 'Settings', icon: FiSettings, path: '/settings' },
            ]
        }
    ];

    const sidebarClasses = `
        fixed top-0 left-0 z-50 flex h-screen flex-col overflow-hidden border-r border-[rgba(229,231,235,0.92)]
        bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.9))]
        backdrop-blur-xl transition-all duration-300
        ${mobileOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0'}
        ${collapsed ? 'md:w-24' : 'md:w-72'}
    `;

    const renderNavItem = (
        item: { name: string; icon: React.ComponentType<{ size?: number; className?: string }>; path: string; badge?: number },
    ) => (
        <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
                [
                    'group relative flex items-center overflow-hidden rounded-2xl border px-3.5 py-3 transition-all duration-300',
                    collapsed && !mobileOpen ? 'justify-center px-0' : 'gap-3.5',
                    isActive
                        ? 'border-[rgba(59, 130, 246,0.18)] bg-[rgba(59, 130, 246,0.12)] text-[var(--rf-color-primary-green-dark)]'
                        : 'border-transparent text-[var(--rf-color-text-secondary)] hover:-translate-y-0.5 hover:border-[rgba(249,115,22,0.14)] hover:bg-[rgba(249,115,22,0.08)] hover:text-[var(--rf-color-action-hover)]'
                ].join(' ')
            }
        >
            {({ isActive }) => (
                <>
                    <span
                        className={[
                            'absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[linear-gradient(180deg,var(--rf-color-action),var(--rf-color-primary-green))] transition-all duration-300',
                            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-55'
                        ].join(' ')}
                    />
                    <span
                        className={[
                            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-all duration-300',
                            isActive
                                ? 'border-[rgba(59, 130, 246,0.16)] bg-white text-[var(--rf-color-primary-green-dark)]'
                                : 'border-[rgba(229,231,235,0.92)] bg-white text-[var(--rf-color-text-muted)] group-hover:border-[rgba(249,115,22,0.16)] group-hover:text-[var(--rf-color-action-hover)]'
                        ].join(' ')}
                    >
                        <item.icon size={20} />
                    </span>

                    {(!collapsed || mobileOpen) && (
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-semibold tracking-[0.01em]">{item.name}</p>
                        </div>
                    )}

                    {item.badge !== undefined && item.badge > 0 && (
                        <span
                            className={[
                                'absolute flex min-w-[24px] items-center justify-center rounded-full text-[11px] font-bold text-white',
                                collapsed && !mobileOpen
                                    ? 'right-1.5 top-1.5 h-5 px-1.5'
                                    : 'right-3 h-6 px-2'
                            ].join(' ')}
                            style={{ background: 'linear-gradient(135deg, var(--rf-color-action), var(--rf-color-action-hover))' }}
                        >
                            {item.badge}
                        </span>
                    )}

                    {collapsed && !mobileOpen && (
                        <div className="invisible absolute left-full z-50 ml-4 whitespace-nowrap rounded-xl border border-[rgba(229,231,235,0.92)] bg-white px-3 py-2 text-xs font-medium text-[var(--rf-color-text)] opacity-0 shadow-2xl transition-all group-hover:visible group-hover:opacity-100">
                            {item.name}
                        </div>
                    )}
                </>
            )}
        </NavLink>
    );

    return (
        <aside className={sidebarClasses}>
            <div className={`relative flex items-center justify-between px-5 py-3.5 transition-all duration-300 ${collapsed ? 'md:px-4' : 'md:px-5'}`}>
                <div className={`flex w-full items-center ${collapsed && !mobileOpen ? 'justify-center' : ''} overflow-hidden`}>
                    {(!collapsed || mobileOpen) ? (
                        <div className="relative w-full overflow-hidden rounded-[26px] border border-[rgba(226,232,240,0.95)] bg-[linear-gradient(155deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] px-3 py-2.5 shadow-[0_20px_36px_rgba(15,23,42,0.08)]">
                            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.10),transparent_34%)]" />
                            <div className="relative flex min-w-0 items-center gap-2.5">
                                <div className="flex h-[38px] shrink-0 items-center">
                                    <img
                                        src="/assets/images/logos/logo-inline.png"
                                        alt="RoomFindR"
                                        className="h-full w-auto max-w-[112px] rounded-[18px] object-contain no-logo-badge drop-shadow-[0_8px_16px_rgba(37,99,235,0.12)]"
                                    />
                                </div>
                                <div className="min-w-0 flex items-center gap-2 whitespace-nowrap">
                                    <span className="inline-flex rounded-full border border-[rgba(59,130,246,0.14)] bg-[rgba(59,130,246,0.08)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--rf-color-primary-green-dark)]">
                                        Admin
                                    </span>
                                    <span className="truncate text-[12px] font-medium text-[var(--rf-color-text-secondary)]">
                                        Operations console
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[22px] border border-[rgba(148,163,184,0.24)] bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] shadow-[0_18px_30px_rgba(15,23,42,0.10)] ring-1 ring-[rgba(255,255,255,0.9)]">
                            <span className="pointer-events-none absolute inset-[4px] rounded-[17px] border border-[rgba(37,99,235,0.08)] bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_58%)]" />
                            <img
                                src="/assets/images/logos/logo.png"
                                alt="RoomFindR"
                                className="relative z-10 h-[50px] w-[50px] rounded-[18px] object-contain drop-shadow-[0_10px_18px_rgba(37,99,235,0.18)]"
                            />
                        </div>
                    )}
                </div>

                <button
                    onClick={() => setMobileOpen(false)}
                    className="ml-3 rounded-xl border border-[rgba(229,231,235,0.92)] bg-white p-2 text-[var(--rf-color-text-secondary)] transition-colors hover:bg-[rgba(249,115,22,0.08)] hover:text-[var(--rf-color-action-hover)] md:hidden"
                >
                    <FiX size={24} />
                </button>
            </div>

            <nav className="relative flex-1 overflow-y-auto px-4 pb-6 no-scrollbar">
                <div className="space-y-5">
                    {navSections.map((section) => (
                        <div key={section.label} className="space-y-2">
                            {(!collapsed || mobileOpen) && (
                                <div className="px-2 pt-1">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--rf-color-text-muted)]">
                                        {section.label}
                                    </p>
                                </div>
                            )}
                            <div className="space-y-2">
                                {section.items.map(renderNavItem)}
                            </div>
                        </div>
                    ))}
                </div>
            </nav>

            <div className="relative mt-auto border-t border-[rgba(229,231,235,0.92)] px-4 py-4">
                {(!collapsed || mobileOpen) && (
                    <div className="mb-3 rounded-3xl border border-[rgba(229,231,235,0.92)] bg-white p-3.5 shadow-[0_18px_36px_rgba(15,23,42,0.08)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--rf-color-text-muted)]">Signed In</p>
                        <div className="mt-3 flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--rf-color-primary-green),var(--rf-color-primary-green-dark))] text-sm font-bold text-white">
                                {String(admin?.email || 'A').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[var(--rf-color-text)]">{admin?.displayName || 'Administrator'}</p>
                                <p className="truncate text-xs text-[var(--rf-color-text-secondary)]">{admin?.email}</p>
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={signOut}
                    className={[
                        'group relative flex w-full items-center rounded-2xl border px-3.5 py-3 text-[var(--rf-color-text-secondary)] transition-all duration-300',
                        collapsed && !mobileOpen ? 'justify-center px-0' : 'gap-3.5',
                        'border-[rgba(229,231,235,0.92)] bg-white hover:-translate-y-0.5 hover:border-[rgba(239,68,68,0.18)] hover:bg-[rgba(239,68,68,0.08)] hover:text-[var(--rf-color-error)]'
                    ].join(' ')}
                >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[rgba(229,231,235,0.92)] bg-white transition-colors group-hover:border-[rgba(239,68,68,0.18)] group-hover:bg-[rgba(239,68,68,0.08)]">
                        <FiLogOut size={20} className="shrink-0" />
                    </span>
                    {(!collapsed || mobileOpen) && (
                        <div className="text-left">
                            <p className="text-[15px] font-semibold">Sign Out</p>
                        </div>
                    )}
                </button>
            </div>

            <button
                onClick={toggleCollapsed}
                className="absolute -right-4 top-8 hidden h-9 w-9 items-center justify-center rounded-full border border-[rgba(229,231,235,0.92)] bg-white text-[var(--rf-color-text)] shadow-[0_18px_36px_rgba(15,23,42,0.08)] transition-all hover:scale-105 md:flex"
            >
                {collapsed ? <FiChevronRight size={14} /> : <FiChevronLeft size={14} />}
            </button>
        </aside>
    );
};

export default Sidebar;


