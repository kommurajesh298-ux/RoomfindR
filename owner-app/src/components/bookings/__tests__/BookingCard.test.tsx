import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import BookingCard from '../BookingCard';
import { refundService } from '../../../services/refund.service';
import type { Booking } from '../../../types/booking.types';

jest.mock('../../../services/refund.service', () => ({
    refundService: {
        subscribeToRefund: jest.fn()
    }
}));

jest.mock('react-hot-toast', () => ({
    error: jest.fn()
}));

const baseBooking: Booking = {
    bookingId: 'booking-1',
    propertyId: 'property-1',
    roomId: 'room-1',
    customerId: 'customer-1',
    customerName: 'Rajesh',
    customerPhone: '9999999999',
    customerEmail: 'rajesh@example.com',
    ownerId: 'owner-1',
    propertyTitle: 'Pavan_pg_Boys',
    roomNumber: '1',
    startDate: '2026-03-21',
    endDate: '2026-04-21',
    durationMonths: 1,
    monthlyRent: 6000,
    paymentStatus: 'paid',
    paymentType: 'advance',
    amountPaid: 500,
    advancePaid: 500,
    createdAt: '2026-03-21T10:00:00Z',
    status: 'rejected',
    notifications: []
};

describe('Owner BookingCard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('shows realtime refund processing badge for rejected paid bookings', async () => {
        (refundService.subscribeToRefund as jest.Mock).mockImplementation((_bookingId, callback) => {
            callback({
                id: 'refund-1',
                paymentId: 'payment-1',
                bookingId: 'booking-1',
                refundAmount: 500,
                status: 'PROCESSING',
                createdAt: '2026-03-21T10:05:00Z'
            });
            return jest.fn();
        });

        render(
            <BookingCard
                booking={baseBooking}
                onAccept={jest.fn()}
                onReject={jest.fn()}
                onCheckIn={jest.fn()}
                onCheckOut={jest.fn()}
                onApproveVacate={jest.fn()}
                onViewDetails={jest.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Refund Processing')).toBeInTheDocument();
        });
    });

    it('shows refund review badge for pending approval refunds', async () => {
        (refundService.subscribeToRefund as jest.Mock).mockImplementation((_bookingId, callback) => {
            callback({
                id: 'refund-2',
                paymentId: 'payment-2',
                bookingId: 'booking-1',
                refundAmount: 500,
                status: 'PENDING',
                createdAt: '2026-03-21T10:05:00Z'
            });
            return jest.fn();
        });

        render(
            <BookingCard
                booking={baseBooking}
                onAccept={jest.fn()}
                onReject={jest.fn()}
                onCheckIn={jest.fn()}
                onCheckOut={jest.fn()}
                onApproveVacate={jest.fn()}
                onViewDetails={jest.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Refund Review')).toBeInTheDocument();
        });
    });

    it('shows refund on hold badge when the gateway has paused the refund', async () => {
        (refundService.subscribeToRefund as jest.Mock).mockImplementation((_bookingId, callback) => {
            callback({
                id: 'refund-3',
                paymentId: 'payment-3',
                bookingId: 'booking-1',
                refundAmount: 500,
                status: 'ONHOLD',
                createdAt: '2026-03-21T10:05:00Z'
            });
            return jest.fn();
        });

        render(
            <BookingCard
                booking={baseBooking}
                onAccept={jest.fn()}
                onReject={jest.fn()}
                onCheckIn={jest.fn()}
                onCheckOut={jest.fn()}
                onApproveVacate={jest.fn()}
                onViewDetails={jest.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Refund On Hold')).toBeInTheDocument();
        });
    });
});
