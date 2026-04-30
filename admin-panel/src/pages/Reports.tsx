import React, { useState } from 'react';
import DateRangePicker from '../components/analytics/DateRangePicker';
import { AnalyticsService } from '../services/analytics.service';
import { subDays } from 'date-fns';
import { toast } from 'react-hot-toast';
import { FiFileText, FiDownload, FiDollarSign, FiUsers, FiBriefcase, FiCalendar } from 'react-icons/fi';

const reportTypes = [
    {
        id: 'revenue',
        title: 'Financial Report',
        description: 'Revenue breakdown by city, type, and daily trends.',
        icon: FiDollarSign,
        color: 'bg-blue-100 text-blue-600'
    },
    {
        id: 'bookings',
        title: 'Booking Summary',
        description: 'Comprehensive list of bookings, cancellations, and durations.',
        icon: FiCalendar,
        color: 'bg-orange-100 text-orange-600'
    },
    {
        id: 'users',
        title: 'User Growth',
        description: 'Daily user registration stats and churn rate estimates.',
        icon: FiUsers,
        color: 'bg-blue-100 text-blue-600'
    },
    {
        id: 'properties',
        title: 'Property Performance',
        description: 'Occupancy rates and verification status by location.',
        icon: FiBriefcase,
        color: 'bg-orange-100 text-orange-600'
    }
] as const;

type ReportId = typeof reportTypes[number]['id'];

const Reports: React.FC = () => {
    const [dateRange, setDateRange] = useState({
        start: subDays(new Date(), 30),
        end: new Date()
    });
    const [loading, setLoading] = useState(false);
    const [selectedReport, setSelectedReport] = useState<ReportId | null>(null);

    const generateReport = async () => {
        if (!selectedReport) {
            toast.error("Please select a report type");
            return;
        }

        setLoading(true);
        try {
            const success = await AnalyticsService.exportToCSV(
                selectedReport,
                dateRange.start,
                dateRange.end
            );

            if (!success) {
                toast("No data available for the selected range", { icon: 'âš ï¸' });
            } else {
                toast.success("Report generated successfully");
            }
        } catch (error) {
            console.error("Report generation failed", error);
            toast.error("Failed to generate report. Please check if data exists.");
        } finally {
            setLoading(false);
        }
    };

    const selectedReportData = reportTypes.find(r => r.id === selectedReport);

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--rf-color-text)] mb-1">Reports Management</h1>
                    <p className="text-[var(--rf-color-text-secondary)]">Generate and download system reports</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Configuration Panel */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <FiFileText /> Report Settings
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">Date Range</label>
                                <div className="w-full">
                                    <DateRangePicker
                                        startDate={dateRange.start}
                                        endDate={dateRange.end}
                                        onChange={(start, end) => setDateRange({ start, end })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">Selected Report</label>
                                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-medium text-slate-900">
                                    {selectedReportData ?
                                        selectedReportData.title
                                        : "Select a report type from the list"}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={generateReport}
                                disabled={loading || !selectedReport}
                                className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition-all ${loading || !selectedReport
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : 'bg-[var(--rf-color-action)] text-white hover:bg-[var(--rf-color-action-hover)] shadow-lg hover:shadow-xl'
                                    }`}
                            >
                                {loading ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <FiDownload size={18} /> Download CSV
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Report Types Grid */}
                <div className="lg:col-span-2">
                    <h3 className="font-bold text-slate-900 mb-4">Available Reports</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {reportTypes.map((report) => (
                            <button
                                type="button"
                                key={report.id}
                                onClick={() => setSelectedReport(report.id)}
                                className={`p-6 rounded-2xl border text-left transition-all relative overflow-hidden group ${selectedReport === report.id
                                    ? 'bg-orange-50 border-orange-500 ring-2 ring-orange-500/20 shadow-md'
                                    : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                                    }`}
                            >
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${report.color}`}>
                                    <report.icon size={24} />
                                </div>
                                <h4 className="font-bold text-slate-900 mb-1">{report.title}</h4>
                                <p className="text-sm text-slate-500">{report.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Reports;

