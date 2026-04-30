import React, { useState, useEffect } from 'react';
import KPICard from '../components/dashboard/KPICard';
import ActivityItem from '../components/dashboard/ActivityItem';
import { AnalyticsService } from '../services/analytics.service';
// Removed legacy firebase imports
import type { OverviewStats, DailyMetric, RevenueMetric } from '../types/analytics.types';
import {
    FiUsers,
    FiHome,
    FiCalendar,
    FiCheckCircle,
    FiDollarSign,
    FiActivity,
    FiCreditCard,
    FiRotateCcw
} from 'react-icons/fi';
import {
    LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts';
import { subDays } from 'date-fns';
import { IntersectionRender } from '../components/common/IntersectionRender';

const Dashboard: React.FC = () => {
    const formatInr = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
    const formatTooltipValue = (value: unknown, suffix = '') => {
        const normalized = Array.isArray(value) ? value[0] : value;
        return `${Number(normalized || 0).toLocaleString('en-IN')}${suffix}`;
    };
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<OverviewStats | null>(null);
    const [dailyUsers, setDailyUsers] = useState<DailyMetric[]>([]);
    const [dailyBookings, setDailyBookings] = useState<DailyMetric[]>([]);
    const [revenueTrend, setRevenueTrend] = useState<RevenueMetric[]>([]);
    const [occupancyRate, setOccupancyRate] = useState<number>(0);
    const [recentActivity, setRecentActivity] = useState<Record<string, unknown>[]>([]);

    useEffect(() => {
        let isMounted = true;

        const endDate = new Date();
        const startDate = subDays(endDate, 30);

        // 1. Subscribe to Real-time Charts Data
        const unsubscribeUsersChart = AnalyticsService.subscribeToDailyUsers(startDate, endDate, (data) => {
            if (isMounted) setDailyUsers(data);
        });

        const unsubscribeBookingsChart = AnalyticsService.subscribeToDailyBookings(startDate, endDate, (data) => {
            if (isMounted) setDailyBookings(data);
        });

        const unsubscribeRevenueTrend = AnalyticsService.subscribeToRevenueTrend(startDate, endDate, (data) => {
            if (isMounted) setRevenueTrend(data);
        });

        const unsubscribeOccupancy = AnalyticsService.subscribeToOccupancyRate((rate) => {
            if (isMounted) {
                setOccupancyRate(rate);
                setLoading(false);
            }
        });

        // 2. Subscribe to Real-time Stats
        const unsubscribeStats = AnalyticsService.subscribeToOverviewStats((newStats) => {
            if (isMounted) {
                setStats(newStats);
            }
        });

        // 3. Subscribe to Real-time Activity
        const unsubscribeActivity = AnalyticsService.subscribeToRecentActivity(10, (activities) => {
            if (isMounted) {
                setRecentActivity(activities as unknown as Record<string, unknown>[]);
            }
        });

        return () => {
            isMounted = false;
            if (typeof unsubscribeUsersChart === 'function') unsubscribeUsersChart();
            if (typeof unsubscribeBookingsChart === 'function') unsubscribeBookingsChart();
            if (typeof unsubscribeRevenueTrend === 'function') unsubscribeRevenueTrend();
            if (typeof unsubscribeOccupancy === 'function') unsubscribeOccupancy();
            if (typeof unsubscribeStats === 'function') unsubscribeStats();
            if (typeof unsubscribeActivity === 'function') unsubscribeActivity();
        };
    }, []);

    return (
        <div className="space-y-6 will-change-scroll">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-[var(--rf-color-text)]">Admin Dashboard</h1>
                <p className="text-[var(--rf-color-text-secondary)]">Platform overview and real-time metrics</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 xl:gap-5 mb-6">
                <KPICard
                    title="Total Users"
                    value={stats?.totalUsers || 0}
                    icon={FiUsers}
                    color="orange"
                    loading={loading}
                />
                <KPICard
                    title="Total Properties"
                    value={stats?.totalProperties || 0}
                    icon={FiHome}
                    color="blue"
                    loading={loading}
                />
                <KPICard
                    title="Total Bookings"
                    value={stats?.totalBookings || 0}
                    icon={FiCalendar}
                    color="orange"
                    loading={loading}
                />
                <KPICard
                    title="Active Bookings"
                    value={stats?.activeBookings || 0}
                    icon={FiCheckCircle}
                    color="orange"
                    loading={loading}
                />
                <KPICard
                    title="Revenue Estimate"
                    value={formatInr(stats?.revenueEstimate || 0)}
                    icon={FiDollarSign}
                    color="emerald"
                    loading={loading}
                />
                <KPICard
                    title="Advance Amount"
                    value={formatInr(stats?.advanceAmount || 0)}
                    icon={FiCreditCard}
                    color="blue"
                    loading={loading}
                />
                <KPICard
                    title="Rent Amount"
                    value={formatInr(stats?.rentAmount || 0)}
                    icon={FiCalendar}
                    color="orange"
                    loading={loading}
                />
                <KPICard
                    title="Refund Amount"
                    value={formatInr(stats?.refundAmount || 0)}
                    icon={FiRotateCcw}
                    color="purple"
                    loading={loading}
                />
                <KPICard
                    title="Commission Estimate"
                    value={formatInr(stats?.commissionEstimate || 0)}
                    icon={FiDollarSign}
                    color="orange"
                    loading={loading}
                />
            </div>

            {/* Graphs Section */}
            {!loading && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Daily Active Users */}
                    <IntersectionRender height={384} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm will-change-transform">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">User Growth (Last 30 Days)</h3>
                        <div className="h-80 w-full min-h-[300px]">
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={dailyUsers}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Line type="monotone" dataKey="count" stroke="#F97316" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </IntersectionRender>

                    {/* Bookings per Day */}
                    <IntersectionRender height={384} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm will-change-transform">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Bookings per Day</h3>
                        <div className="h-80 w-full min-h-[300px]">
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={dailyBookings}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: '#F1F5F9' }} />
                                    <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </IntersectionRender>

                    {/* Revenue Trend */}
                    <IntersectionRender height={384} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm will-change-transform">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Revenue Trend</h3>
                        <div className="h-80 w-full min-h-[300px]">
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={revenueTrend}>
                                    <defs>
                                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                                    <Tooltip formatter={(value: unknown) => `₹${formatTooltipValue(value)}`} />
                                    <Area type="monotone" dataKey="amount" stroke="#10B981" fillOpacity={1} fill="url(#colorRevenue)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </IntersectionRender>

                    {/* Occupancy Rate */}
                    <IntersectionRender height={384} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm will-change-transform">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Occupancy Rate</h3>
                        <div className="h-80 w-full min-h-[300px]">
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie
                                        data={[
                                            { name: 'Occupied', value: occupancyRate },
                                            { name: 'Available', value: 100 - occupancyRate }
                                        ]}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        fill="#8884d8"
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        <Cell key="occupied" fill="#3B82F6" />
                                        <Cell key="available" fill="#E2E8F0" />
                                    </Pie>
                                    <Tooltip formatter={(val: unknown) => `${Number(Array.isArray(val) ? val[0] : val || 0).toFixed(1)}%`} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </IntersectionRender>
                </div>
            )}

            {/* Recent Activity Feed */}
            <IntersectionRender height={400} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Recent Activity</h3>
                <div className="space-y-4">
                    {recentActivity.length > 0 ? (
                        recentActivity.map(activity => (
                            <ActivityItem
                                key={activity.id as string}
                                action={activity.action as string}
                                actor={(activity.adminEmail as string) || 'System'}
                                timestamp={activity.created_at as string}
                                details={(activity.details as Record<string, unknown>) || {}}
                                icon={FiActivity}
                                type={
                                    (activity.action as string).includes('refund') ? 'refund' :
                                        (activity.action as string).includes('setting') ? 'settings' : 'booking'
                                }
                            />
                        ))
                    ) : (
                        <p className="text-slate-500 text-center py-8">No recent activity</p>
                    )}
                </div>
            </IntersectionRender>
        </div>
    );
};

export default Dashboard;

