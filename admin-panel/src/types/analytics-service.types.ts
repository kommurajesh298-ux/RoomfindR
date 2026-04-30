// Type definitions for analytics service
export interface OverviewStats {
    totalUsers: number;
    totalOwners: number;
    totalProperties: number;
    totalBookings: number;
    activeBookings: number;
    revenueEstimate: number;
    commissionEstimate: number;
    advanceAmount: number;
    rentAmount: number;
    refundAmount: number;
}

export interface DailyMetric {
    date: string;
    count: number;
}

export interface RevenueByDayItem {
    date: string;
    revenue: number;
}

export interface ActivityLog {
    id: string;
    action: string;
    created_at: string;
    details: Record<string, unknown>;
    adminEmail?: string;
}
