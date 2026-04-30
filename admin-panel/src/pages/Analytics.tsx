import React, { useState, useEffect, useCallback } from 'react';
import DateRangePicker from '../components/analytics/DateRangePicker';
import MetricCard from '../components/analytics/MetricCard';
import ChartContainer from '../components/analytics/ChartContainer';
import { AnalyticsService } from '../services/analytics.service';
import type {
    UserGrowthMetrics,
    BookingMetrics,
    RevenueMetrics,
    PropertyMetrics,
    DailyMetric,
    RevenueMetric
} from '../types/analytics.types';
import { subDays } from 'date-fns';
import { toast } from 'react-hot-toast';
import { FiDownload, FiUserPlus, FiUsers, FiDollarSign, FiFilter } from 'react-icons/fi';
import { IntersectionRender } from '../components/common/IntersectionRender';
import {
    LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts';

type AnalyticsTab = 'growth' | 'bookings' | 'revenue' | 'properties';

const Analytics: React.FC = () => {
    const [activeTab, setActiveTab] = useState<AnalyticsTab>('growth');
    const [loading, setLoading] = useState(false);
    const [dateRange, setDateRange] = useState({
        start: subDays(new Date(), 30),
        end: new Date()
    });
    const [filters, setFilters] = useState({
        city: '',
        propertyType: '',
        ownerId: ''
    });

    // Data States
    const [growthMetrics, setGrowthMetrics] = useState<UserGrowthMetrics | null>(null);
    const [dailyUsers, setDailyUsers] = useState<DailyMetric[]>([]);
    const [bookingMetrics, setBookingMetrics] = useState<BookingMetrics | null>(null);
    const [dailyBookings, setDailyBookings] = useState<DailyMetric[]>([]);
    const [revenueMetrics, setRevenueMetrics] = useState<(RevenueMetrics & { bookingCount?: number }) | null>(null);
    const [revenueTrend, setRevenueTrend] = useState<RevenueMetric[]>([]);
    const [propertyMetrics, setPropertyMetrics] = useState<PropertyMetrics | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            switch (activeTab) {
                case 'growth': {
                    const growth = await AnalyticsService.getUserGrowthMetrics();
                    const daily = await AnalyticsService.getDailyActiveUsers(dateRange.start, dateRange.end);
                    const growthWithData = { newCustomers: 0, newOwners: 0, churnRate: 0, ...growth };
                    setGrowthMetrics(growthWithData);
                    setDailyUsers(daily);
                    break;
                }
                case 'bookings': {
                    const bookings = await AnalyticsService.getBookingMetrics();
                    const dailyBooking = await AnalyticsService.getBookingsPerDay();
                    const metricsWithData = {
                        totalBookings: bookings.total,
                        acceptanceRate: ((bookings.confirmed / bookings.total) * 100) || 0,
                        cancellationRate: ((bookings.cancelled / bookings.total) * 100) || 0,
                        averageDuration: 3 // Placeholder
                    };
                    setBookingMetrics(metricsWithData);
                    setDailyBookings(dailyBooking);
                    break;
                }
                case 'revenue': {
                    const rev = await AnalyticsService.getRevenueMetrics();
                    const trend = await AnalyticsService.getRevenueByDay(dateRange.start, dateRange.end);
                    const revenueWithData = {
                        totalRevenue: rev.total,
                        bookingCount: rev.count,
                        revenueByCity: [],
                        revenueByType: []
                    };
                    setRevenueMetrics(revenueWithData);
                    // Map revenue to amount for RevenueMetric type
                    setRevenueTrend(trend.map(t => ({ date: t.date, amount: t.revenue })));
                    break;
                }
                case 'properties': {
                    const props = await AnalyticsService.getPropertyMetrics();
                    const metricsData = {
                        totalProperties: props.length,
                        verifiedProperties: 0,
                        averageOccupancy: props.reduce((acc: number, p: { occupancyRate?: number }) => acc + (p.occupancyRate || 0), 0) / props.length || 0,
                        propertiesByCity: []
                    };
                    setPropertyMetrics(metricsData);
                    break;
                }
            }
        } catch (error) {
            console.error(error);
            toast.error("Failed to fetch analytics data");
        } finally {
            setLoading(false);
        }
    }, [activeTab, dateRange]);

    useEffect(() => {
        const timeout = setTimeout(fetchData, 500); // Debounce
        return () => clearTimeout(timeout);
    }, [activeTab, dateRange, fetchData]);

    const handleExport = () => {
        AnalyticsService.exportToCSV(activeTab as 'properties' | 'bookings' | 'users' | 'revenue', dateRange.start, dateRange.end);
        toast.success(`Exporting ${activeTab} data...`);
    };

    const COLORS = ['#F97316', '#3B82F6', '#F59E0B', '#EF4444', '#2563EB'];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--rf-color-text)] mb-1">System Analytics</h1>
                    <p className="text-[var(--rf-color-text-secondary)]">Growth metrics and revenue insights</p>
                </div>

                <div className="flex items-center gap-3">
                    <DateRangePicker
                        startDate={dateRange.start}
                        endDate={dateRange.end}
                        onChange={(start, end) => setDateRange({ start, end })}
                    />
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 bg-[var(--rf-color-action)] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[var(--rf-color-action-hover)] transition-colors"
                    >
                        <FiDownload /> Export
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-3 text-slate-700 font-semibold">
                    <FiFilter /> Filters
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input
                        name="analyticsCityFilter"
                        placeholder="Filter by City"
                        value={filters.city}
                        onChange={e => setFilters({ ...filters, city: e.target.value })}
                        className="border border-slate-300 rounded-lg p-2 text-sm focus:border-[var(--rf-color-action)] outline-none"
                    />
                    <input
                        name="analyticsPropertyTypeFilter"
                        placeholder="Filter by Property Type"
                        value={filters.propertyType}
                        onChange={e => setFilters({ ...filters, propertyType: e.target.value })}
                        className="border border-slate-300 rounded-lg p-2 text-sm focus:border-[var(--rf-color-action)] outline-none"
                    />
                    <input
                        name="analyticsOwnerIdFilter"
                        placeholder="Filter by Owner ID"
                        value={filters.ownerId}
                        onChange={e => setFilters({ ...filters, ownerId: e.target.value })}
                        className="border border-slate-300 rounded-lg p-2 text-sm focus:border-[var(--rf-color-action)] outline-none"
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200 overflow-x-auto">
                <div className="flex gap-8 min-w-max">
                    {(['growth', 'bookings', 'revenue', 'properties'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`pb-4 text-sm font-semibold capitalize transition-all border-b-2 ${activeTab === tab
                                ? 'border-[var(--rf-color-action)] text-[var(--rf-color-action)]'
                                : 'border-transparent text-slate-400 hover:text-slate-600'
                                }`}
                        >
                            {tab === 'growth' ? 'User Growth' : tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            {activeTab === 'growth' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <MetricCard title="New Customers" value={growthMetrics?.newCustomers || 0} icon={FiUserPlus} color="blue" />
                        <MetricCard title="New Owners" value={growthMetrics?.newOwners || 0} icon={FiUsers} color="blue" />
                        <MetricCard
                            title="Churn Rate"
                            value={`${growthMetrics?.churnRate || 0}%`}
                            subtitle="vs last month"
                            trend={{ value: 0.5, direction: 'down' }}
                        />
                    </div>
                    <IntersectionRender height={350} className="w-full">
                        <ChartContainer title="User Registrations Trend" loading={loading}>
                            <ResponsiveContainer width="100%" height={350} className="min-h-[300px] w-full" minWidth={0} minHeight={0}>
                                <LineChart data={dailyUsers}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="date" />
                                    <YAxis />
                                    <Tooltip />
                                    <Line type="monotone" dataKey="count" stroke="#F97316" strokeWidth={3} />
                                </LineChart>
                            </ResponsiveContainer>
                        </ChartContainer>
                    </IntersectionRender>

                    {/* Detailed Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 font-semibold">Daily Registrations</div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr><th className="p-3">Date</th><th className="p-3">New Users</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {dailyUsers.slice(0, 10).map((day, i) => (
                                    <tr key={i}><td className="p-3">{day.date}</td><td className="p-3">{day.count}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'bookings' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <MetricCard title="Total Bookings" value={bookingMetrics?.totalBookings || 0} />
                        <MetricCard title="Acceptance Rate" value={`${bookingMetrics?.acceptanceRate.toFixed(1) || 0}%`} />
                        <MetricCard title="Cancellation Rate" value={`${bookingMetrics?.cancellationRate.toFixed(1) || 0}%`} />
                        <MetricCard title="Avg Duration" value={`${bookingMetrics?.averageDuration.toFixed(1) || 0} mths`} />
                    </div>
                    <IntersectionRender height={350} className="w-full">
                        <ChartContainer title="Daily Bookings Activity" loading={loading}>
                            <ResponsiveContainer width="100%" height={350} className="min-h-[300px] w-full" minWidth={0} minHeight={0}>
                                <BarChart data={dailyBookings}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="date" />
                                    <YAxis />
                                    <Tooltip cursor={{ fill: '#F8FAFC' }} />
                                    <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartContainer>
                    </IntersectionRender>

                    {/* Detailed Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 font-semibold">Recent Booking Volume</div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr><th className="p-3">Date</th><th className="p-3">Bookings</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {dailyBookings.slice(0, 10).map((day, i) => (
                                    <tr key={i}><td className="p-3">{day.date}</td><td className="p-3">{day.count}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'revenue' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <MetricCard title="Total Revenue" value={`₹${(revenueMetrics?.totalRevenue || 0).toLocaleString()}`} icon={FiDollarSign} color="emerald" />
                        <MetricCard
                            title="Avg Booking Value"
                            value={`₹${revenueMetrics?.bookingCount ? Math.round(revenueMetrics.totalRevenue / revenueMetrics.bookingCount).toLocaleString() : 0}`}
                            subtitle={`Based on ${revenueMetrics?.bookingCount || 0} paid bookings`}
                        />
                        <MetricCard title="Revenue Growth" value="12.5%" trend={{ value: 12.5, direction: 'up' }} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <ChartContainer title="Revenue Activity" loading={loading}>
                            <ResponsiveContainer width="100%" height={300} className="min-h-[300px] w-full" minWidth={0} minHeight={0}>
                                <AreaChart data={revenueTrend}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="date" />
                                    <YAxis />
                                    <Tooltip formatter={(val) => `₹${Number(val).toLocaleString()}`} />
                                    <Area type="monotone" dataKey="amount" stroke="#10B981" fill="#D1FAE5" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </ChartContainer>

                        <ChartContainer title="Revenue by City" loading={loading}>
                            <ResponsiveContainer width="100%" height={300} className="min-h-[300px] w-full" minWidth={0} minHeight={0}>
                                <PieChart>
                                    <Pie
                                        data={revenueMetrics?.revenueByCity || []}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        paddingAngle={5}
                                        dataKey="amount"
                                        nameKey="city"
                                        fill="#8884d8"
                                    >
                                        {(revenueMetrics?.revenueByCity || []).map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(val) => `₹${Number(val).toLocaleString()}`} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </ChartContainer>
                    </div>

                    {/* Detailed Breakdown Tables */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100 font-semibold">City Breakdown</div>
                            <div className="max-h-60 overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                                        <tr><th className="p-3">City</th><th className="p-3">Revenue</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {revenueMetrics?.revenueByCity.map((item, i) => (
                                            <tr key={i}><td className="p-3">{item.city}</td><td className="p-3">₹{item.amount.toLocaleString()}</td></tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100 font-semibold">Type Breakdown</div>
                            <div className="max-h-60 overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                                        <tr><th className="p-3">Type</th><th className="p-3">Revenue</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {revenueMetrics?.revenueByType.map((item, i) => (
                                            <tr key={i}><td className="p-3">{item.type}</td><td className="p-3">₹{item.amount.toLocaleString()}</td></tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'properties' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <MetricCard title="Total Properties" value={propertyMetrics?.totalProperties || 0} />
                        <MetricCard title="Verified %" value={`${propertyMetrics?.verifiedProperties.toFixed(1) || 0}%`} />
                        <MetricCard title="Avg Occupancy" value={`${propertyMetrics?.averageOccupancy.toFixed(1) || 0}%`} />
                    </div>
                    <ChartContainer title="Properties by City" loading={loading}>
                        <ResponsiveContainer width="100%" height={400} className="min-h-[300px] w-full" minWidth={0} minHeight={0}>
                            <BarChart data={propertyMetrics?.propertiesByCity || []} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                <XAxis type="number" />
                                <YAxis dataKey="city" type="category" width={100} />
                                <Tooltip />
                                <Bar dataKey="count" fill="#F97316" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartContainer>

                    {/* Detailed Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 font-semibold">Geographic Distribution</div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr><th className="p-3">City</th><th className="p-3">Count</th><th className="p-3">Percentage</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {propertyMetrics?.propertiesByCity.map((item, i) => (
                                    <tr key={i}>
                                        <td className="p-3">{item.city}</td>
                                        <td className="p-3">{item.count}</td>
                                        <td className="p-3">
                                            {propertyMetrics.totalProperties > 0
                                                ? ((item.count / propertyMetrics.totalProperties) * 100).toFixed(1)
                                                : 0}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Analytics;

