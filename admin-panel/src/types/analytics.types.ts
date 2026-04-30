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
    date: string; // YYYY-MM-DD format
    count: number;
}

export interface RevenueMetric {
    date: string;
    amount: number;
}

export interface UserGrowthMetrics {
    newCustomers: number;
    newOwners: number;
    churnRate: number;
}

export interface BookingMetrics {
    totalBookings: number;
    acceptanceRate: number;
    cancellationRate: number;
    averageDuration: number;
}

export interface RevenueMetrics {
    totalRevenue: number;
    revenueByCity: { city: string; amount: number }[];
    revenueByType: { type: string; amount: number }[];
    bookingCount: number;
}

export interface PropertyMetrics {
    totalProperties: number;
    verifiedProperties: number;
    averageOccupancy: number;
    propertiesByCity: { city: string; count: number }[];
}
