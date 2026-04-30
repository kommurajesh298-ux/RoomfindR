import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useOwner } from '../hooks/useOwner';
import { IoBusinessOutline, IoPeopleOutline, IoCalendarOutline, IoCashOutline, IoAddCircleOutline, IoCheckmarkDoneCircleOutline, IoDownloadOutline } from 'react-icons/io5';
import { useNavigate } from 'react-router-dom';
import { StatsCard } from '../components/dashboard/StatsCard';
import { bookingService } from '../services/booking.service';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import PendingApprovalPanel from '../components/common/PendingApprovalPanel';
import { toast } from 'react-hot-toast';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { analyticsService } from '../services/analytics.service';
import { notificationService } from '../services/notification.service';
import { supabase } from '../services/supabase-config';
import type { Booking } from '../types/booking.types';
import type { ChartData, DashboardReportMetrics, OccupancyTrend } from '../services/analytics.service';
import { IntersectionRender } from '../components/common/IntersectionRender';
import { formatCurrency } from '../utils/currency';

const Dashboard: React.FC = () => {
    const { userData, ownerData, currentUser } = useAuth();
    const { verificationStatus, bankVerified } = useOwner();
    const navigate = useNavigate();
    const isPendingApprovalOwner =
        !!currentUser &&
        !verificationStatus &&
        (userData?.role === 'owner' || !!ownerData);
    const [stats, setStats] = useState({
        totalProperties: 0,
        totalRooms: 0,
        activeVacancies: 0,
        pendingBookings: 0,
        newBookingsThisMonth: 0,
        monthlyRevenue: 0
    });
    const [loading, setLoading] = useState(true);
    const [showAcceptModal, setShowAcceptModal] = useState(false);
    const [pendingBookings, setPendingBookings] = useState<Booking[]>([]);

    // Chart States
    const [bookingsChartData, setBookingsChartData] = useState<ChartData[]>([]);
    const [occupancyTrend, setOccupancyTrend] = useState<OccupancyTrend[]>([]);
    const [dashboardReport, setDashboardReport] = useState<DashboardReportMetrics>({
        totalProperties: 0,
        totalRooms: 0,
        occupiedSlots: 0,
        activeVacancies: 0,
        currentOccupancyRate: 0,
        averageOccupancyRate: 0,
        monthlyRevenue: 0,
        previousMonthRevenue: 0,
        revenueChangeRate: 0,
        newBookingsThisMonth: 0,
        occupancyTrend: [],
    });

    // Recent Activity (Notifications)
    interface Activity {
        id: string;
        type: 'booking' | 'system' | 'info';
        ts: string;
        title: string;
        body?: string;
    }
    const [activities, setActivities] = useState<Activity[]>([]);

    useEffect(() => {
        if (!currentUser || isPendingApprovalOwner) return;

        // 1. Pending Bookings Listener
        const unsubscribeBookings = bookingService.subscribeToPendingBookings(currentUser.uid, (bookings) => {
            setPendingBookings(bookings);
            setStats(prev => ({
                ...prev,
                pendingBookings: bookings.length
            }));
        });

        // 2. Live dashboard report metrics
        const unsubscribeDashboardReport = analyticsService.subscribeToDashboardReport(currentUser.uid, (report) => {
            setDashboardReport(report);
            setOccupancyTrend(report.occupancyTrend);
            setStats(prev => ({
                ...prev,
                totalProperties: report.totalProperties,
                totalRooms: report.totalRooms,
                activeVacancies: report.activeVacancies,
                monthlyRevenue: report.monthlyRevenue,
                newBookingsThisMonth: report.newBookingsThisMonth,
            }));
            setLoading(false);
        });

        // 3. Bookings Overview Chart
        const unsubscribeBookingsChart = analyticsService.subscribeToBookingsChart(currentUser.uid, (data) => {
            setBookingsChartData(data);
        });

        // 4. Recent Activity
        const unsubscribeNotifications = notificationService.subscribeToNotifications(currentUser.uid, (notifs) => {
            const mappedActivities = notifs.map(n => ({
                id: n.id,
                type: (n.type as Activity['type']) || 'info',
                ts: n.created_at, // Map created_at to ts
                title: n.title,
                body: n.message   // Map message to body
            }));
            setActivities(mappedActivities.slice(0, 5));
        });

        return () => {
            unsubscribeBookings();
            unsubscribeDashboardReport();
            unsubscribeBookingsChart();
            unsubscribeNotifications();
        };
    }, [currentUser, isPendingApprovalOwner]);

    const handleAcceptAllBookings = async () => {
        if (pendingBookings.length === 0) return;

        try {
            setLoading(true);
            const success = await bookingService.acceptAllBookings(pendingBookings.map(b => b.bookingId));
            if (success) {
                toast.success(`Accepted ${pendingBookings.length} bookings`);
                setStats(prev => ({ ...prev, pendingBookings: 0 }));
                setPendingBookings([]);
            } else {
                toast.error("Failed to accept some bookings");
            }
            setShowAcceptModal(false);
            setLoading(false);
        } catch (error) {
            console.error(error);
            toast.error("An error occurred");
            setLoading(false);
        }
    };

    const handleDownloadReport = async () => {
        if (!currentUser) return;
        const toastId = toast.loading('Generating report...');
        try {
            const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

            // 1. Fetch Bookings
            const { data: bookings, error } = await supabase
                .from('bookings')
                .select(`
                    id,
                    created_at,
                    customer_name,
                    monthly_rent,
                    status,
                    start_date,
                    properties (title),
                    rooms (room_number),
                    payments (status, payment_type, payment_date)
                `)
                .eq('owner_id', currentUser.id)
                .gte('created_at', startOfMonth.toISOString());


            if (error) {
                console.error('Supabase query error:', error);
                throw new Error(error.message);
            }

            if (!bookings || bookings.length === 0) {
                toast.error('No bookings found for this month', { id: toastId });
                return;
            }

            const { data: settlements } = await supabase
                .from('settlements')
                .select('status, week_start_date, week_end_date')
                .eq('owner_id', currentUser.id)
                .gte('week_start_date', startOfMonth.toISOString().split('T')[0]);

            const hasCompletedSettlement = (settlements || []).some((s) => s.status === 'COMPLETED');

            // 2. Generate CSV
            const headers = ['Booking ID', 'Date', 'Guest Name', 'Property', 'Room', 'Check-in', 'Status', 'Monthly Rent (INR)', 'Payment Status', 'Settlement Status'];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rows = bookings.map((b: any) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const payment = b.payments?.find((p: any) =>
                    p.status === 'completed' &&
                    (p.payment_type === 'monthly' || p.payment_type === 'advance') &&
                    new Date(p.payment_date as string).getMonth() === new Date().getMonth() &&
                    new Date(p.payment_date as string).getFullYear() === new Date().getFullYear()
                );

                const isPaid = !!payment;
                const isSettled = hasCompletedSettlement;

                return [
                    b.id,
                    new Date(b.created_at).toLocaleDateString(),
                    b.customer_name || 'N/A',
                    b.properties?.title || 'Unknown Property',
                    b.rooms?.room_number || 'N/A',
                    new Date(b.start_date).toLocaleDateString(),
                    b.status,
                    b.monthly_rent,
                    isPaid ? 'Paid' : 'Pending',
                    isSettled ? 'Settled' : 'Processing'
                ];
            });

            const csvContent = [
                headers.join(','),
                ...rows.map((row: (string | number)[]) => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            ].join('\n');

            // 3. Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `Monthly_Report_${new Date().toLocaleString('default', { month: 'short' })}_${new Date().getFullYear()}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast.success('Report downloaded!', { id: toastId });
        } catch (error: unknown) {
            console.error('Report generation failed:', error);
            toast.error(`Report failed: ${(error as Error).message || 'Unknown error'}`, { id: toastId });
        }
    };
    if (isPendingApprovalOwner) {
        return <PendingApprovalPanel />;
    }

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(220,252,231,0.45),_transparent_28%),linear-gradient(180deg,#ffffff_0%,#f9fafb_100%)] pb-20 md:pb-8 will-change-scroll">
            <div className="container mx-auto px-4 py-6 space-y-6">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-gray-100">
                    <div className="space-y-1">
                        <h1 className="text-3xl md:text-5xl font-black text-[var(--rf-color-text)] tracking-tight font-display">Dashboard</h1>
                        <div className="flex items-center gap-2 text-gray-400">
                            <span className="text-sm md:text-lg font-medium">Welcome back, <span className="font-black text-[#1a1c2e]">{userData?.name?.split(' ')[0] || 'Partner'}</span></span>
                            {verificationStatus && (
                                <span className={`ml-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${bankVerified ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-indigo-50 text-indigo-700 border border-indigo-100'}`}>
                                    <IoCheckmarkDoneCircleOutline /> {bankVerified ? 'Verified' : 'Approved'}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:flex sm:items-center gap-3">
                        {stats.pendingBookings > 0 && (
                            <button
                                onClick={() => setShowAcceptModal(true)}
                                className="flex items-center justify-center gap-2 h-14 md:h-12 px-6 bg-amber-50 text-amber-700 border border-amber-200 rounded-2xl text-sm font-black hover:bg-amber-100 transition-all active:scale-95"
                            >
                                <IoCheckmarkDoneCircleOutline size={20} />
                                <span>Accept All ({stats.pendingBookings})</span>
                            </button>
                        )}

                        <button
                            onClick={() => navigate('/properties/add')}
                            className="flex items-center justify-center gap-2 h-14 md:h-12 px-8 bg-[var(--rf-color-action)] text-white rounded-2xl text-sm font-black shadow-xl shadow-orange-200 hover:bg-[var(--rf-color-action-hover)] transition-all active:scale-95"
                        >
                            <IoAddCircleOutline size={22} />
                            <span>List Property</span>
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
                    <StatsCard
                        label="Properties"
                        value={stats.totalProperties}
                        icon={IoBusinessOutline}
                        color="orange"
                        loading={loading}
                    />
                    <StatsCard
                        label="Vacancies"
                        value={stats.activeVacancies}
                        icon={IoPeopleOutline}
                        color="blue"
                        loading={loading}
                    />
                    <StatsCard
                        label="Pending"
                        value={stats.pendingBookings}
                        icon={IoCalendarOutline}
                        color="bg-gradient-to-br from-amber-400 to-amber-500"
                        loading={loading}
                    />
                    <StatsCard
                        label="Revenue"
                        value={formatCurrency(stats.monthlyRevenue)}
                        icon={IoCashOutline}
                        color="orange"
                        loading={loading}
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Analyics Charts - Spans 2 cols */}
                    <div className="lg:col-span-2 space-y-6">
                        <IntersectionRender height={330} className="bg-white p-5 md:p-6 rounded-[24px] shadow-sm border border-gray-100 hover:shadow-md transition-all">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-base md:text-lg font-black text-[#1a1c2e] uppercase tracking-wider">Bookings Overview</h3>
                                <select id="owner-bookings-overview-range" name="bookingsOverviewRange" className="text-[10px] font-black uppercase tracking-widest border-none bg-gray-50 rounded-lg py-1.5 px-3 text-gray-400 outline-none cursor-pointer hover:bg-gray-100">
                                    <option>This Month</option>
                                    <option>Last Month</option>
                                </select>
                            </div>
                            <div className="h-[250px] w-full relative">
                                <ResponsiveContainer width="100%" height={250}>
                                    <LineChart data={bookingsChartData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 700 }} dy={10} hide={window.innerWidth < 640} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 700 }} hide={window.innerWidth < 640} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                                            itemStyle={{ color: '#F97316', fontWeight: 900, fontSize: '12px' }}
                                        />
                                        <Line type="monotone" dataKey="bookings" stroke="#F97316" strokeWidth={4} dot={{ r: 4, fill: '#F97316', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </IntersectionRender>

                        <IntersectionRender height={250} className="bg-white p-5 md:p-6 rounded-[24px] shadow-sm border border-gray-100 hover:shadow-md transition-all">
                            <h3 className="text-base md:text-lg font-black text-[#1a1c2e] uppercase tracking-wider mb-6">Occupancy Trend</h3>
                            <div className="h-[180px] w-full relative">
                                <ResponsiveContainer width="100%" height={180}>
                                    <AreaChart data={occupancyTrend}>
                                        <defs>
                                            <linearGradient id="colorOccupancy" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.22} />
                                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 700 }} dy={10} hide={window.innerWidth < 640} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 700 }} hide={window.innerWidth < 640} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                                        />
                                        <Area type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorOccupancy)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </IntersectionRender>
                    </div>

                    {/* Notifications Feed - Spans 1 col */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 p-5 md:p-6 hover:shadow-md transition-all">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-base md:text-lg font-black text-[#1a1c2e] uppercase tracking-wider">Monthly Report</h3>
                                <div className="flex items-center gap-2">
                                    <div className="text-[10px] bg-orange-50 text-orange-700 px-2.5 py-1.5 rounded-xl font-black uppercase tracking-widest border border-orange-100">{new Date().toLocaleString('default', { month: 'short' })}</div>
                                    <button
                                        onClick={handleDownloadReport}
                                        className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 hover:text-orange-600 transition-all active:scale-95 border border-transparent hover:border-orange-100"
                                        title="Download CSV"
                                    >
                                        <IoDownloadOutline size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <div className="space-y-1">
                                        <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Monthly Earnings</p>
                                        <p className="text-3xl font-black text-[#1a1c2e] font-display">{formatCurrency(stats.monthlyRevenue)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-xs font-black tracking-tighter ${dashboardReport.revenueChangeRate > 0 ? 'text-orange-500' : dashboardReport.revenueChangeRate < 0 ? 'text-rose-500' : 'text-gray-400'}`}>
                                            {dashboardReport.revenueChangeRate > 0 ? '+' : ''}{dashboardReport.revenueChangeRate.toFixed(1)}%
                                        </p>
                                        <p className="text-[10px] text-gray-400 font-medium">vs last month</p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between text-[11px] font-black uppercase tracking-widest">
                                        <span className="text-gray-400">Occupancy</span>
                                        <span className="text-blue-600">{dashboardReport.currentOccupancyRate}%</span>
                                    </div>
                                    <div className="w-full bg-gray-50 h-3 rounded-full overflow-hidden border border-gray-100 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                                        <div
                                            className="bg-blue-500 h-full rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(59, 130, 246,0.25)]"
                                            style={{ width: `${dashboardReport.currentOccupancyRate}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-[10px] text-gray-400 font-black uppercase tracking-widest">
                                        <span>{dashboardReport.occupiedSlots} Booked</span>
                                        <span>{dashboardReport.activeVacancies} Empty</span>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-gray-100 grid grid-cols-2 gap-4">
                                    <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-100 group hover:border-orange-100 transition-colors">
                                        <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-1.5 opacity-60">Avg Occ.</p>
                                        <p className="text-xl font-black text-[#1a1c2e]">{dashboardReport.averageOccupancyRate}%</p>
                                    </div>
                                    <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-100 group hover:border-blue-100 transition-colors">
                                        <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-1.5 opacity-60">New</p>
                                        <p className="text-xl font-black text-[#1a1c2e]">{stats.newBookingsThisMonth}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 p-5 md:p-6 h-full hover:shadow-md transition-all">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-base md:text-lg font-black text-[#1a1c2e] uppercase tracking-wider">Recent Activity</h3>
                                <button className="text-[10px] font-black text-orange-700 hover:text-orange-800 bg-orange-50 px-3 py-1.5 rounded-xl transition-all uppercase tracking-widest border border-orange-100">View All</button>
                            </div>
                            <div className="space-y-4 text-sm">
                                {loading ? (
                                    <div className="animate-pulse space-y-4">
                                        {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-gray-50 rounded-2xl"></div>)}
                                    </div>
                                ) : activities.length > 0 ? (
                                    activities.map((note) => (
                                        <div
                                            key={note.id}
                                            className="bg-gray-50/40 p-4 rounded-2xl hover:bg-white hover:shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all border border-transparent hover:border-orange-100 cursor-pointer group"
                                            onClick={() => {
                                                if (note.type === 'booking') {
                                                    if (note.body?.includes('vacate')) {
                                                        navigate('/bookings?tab=pending');
                                                    } else {
                                                        navigate('/bookings');
                                                    }
                                                } else if ((note.type as string) === 'property') {
                                                    navigate('/properties');
                                                }
                                            }}
                                        >
                                            <div className="flex items-start gap-4">
                                                <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${note.type === 'booking' ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.45)]' :
                                                    note.type === 'system' ? 'bg-blue-300' : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                                                    }`}></div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-start gap-2 mb-1">
                                                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border ${note.type === 'booking' ? 'bg-orange-50 text-orange-700 border-orange-100' :
                                                            note.type === 'system' ? 'bg-gray-50 text-gray-500 border-gray-100' : 'bg-amber-50 text-amber-600 border-amber-100'
                                                            }`}>
                                                            {note.type || 'info'}
                                                        </span>
                                                        <span className="text-[10px] text-gray-400 font-bold whitespace-nowrap">{formatDistanceToNow(parseISO(note.ts), { addSuffix: true })}</span>
                                                    </div>
                                                    <h4 className="text-sm font-black text-[#1a1c2e] leading-snug truncate">{note.title || note.body}</h4>
                                                    {note.body && note.title && <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{note.body}</p>}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-10 opacity-40">
                                        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center text-gray-300">
                                            <IoCalendarOutline size={28} />
                                        </div>
                                        <p className="text-[10px] font-black uppercase tracking-widest">No Recent Activity</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmationModal
                isOpen={showAcceptModal}
                onClose={() => setShowAcceptModal(false)}
                onConfirm={handleAcceptAllBookings}
                title="Accept All Bookings?"
                message={
                    <div className="space-y-2">
                        <p>Are you sure you want to accept all {pendingBookings.length} pending bookings?</p>
                        <ul className="text-sm text-gray-600 bg-gray-50 p-2 rounded max-h-40 overflow-y-auto">
                            {pendingBookings.map((b) => (
                                <li key={b.bookingId} className="border-b last:border-0 py-1">
                                    <span className="font-semibold">{b.customerName || 'Customer'}</span> - {b.propertyTitle || 'Property'} <br />
                                    <span className="text-xs">({new Date(b.startDate).toLocaleDateString()})</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                }
                confirmText="Accept All"
                variant="info"
            />
        </div>
    );
};

export default Dashboard;

