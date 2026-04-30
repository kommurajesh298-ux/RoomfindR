import { act, screen } from '@testing-library/react';
import { render } from '../../../test/test-utils';
import BookingStatusListener from '../BookingStatusListener';
import type { Booking } from '../../../types/booking.types';

jest.mock('../../RatingPopup', () => ({
    __esModule: true,
    default: ({
        title,
    }: {
        title: string;
    }) => <div data-testid="rating-popup">{title}</div>,
}));

jest.mock('../../../services/realtime-subscription', () => ({
    deferRealtimeSubscription: (factory: () => () => void) => factory(),
}));

jest.mock('../../../services/booking.service', () => ({
    bookingService: {
        subscribeToCustomerBookings: jest.fn(),
        hasUserRatedBooking: jest.fn(),
    },
}));

const { bookingService } = jest.requireMock('../../../services/booking.service') as {
    bookingService: {
        subscribeToCustomerBookings: jest.Mock;
        hasUserRatedBooking: jest.Mock;
    };
};

const buildBooking = (status: Booking['status']): Booking => ({
    bookingId: 'booking-1',
    propertyId: 'property-1',
    roomId: 'room-1',
    customerId: 'customer-1',
    customerName: 'Test Customer',
    customerPhone: '9999999999',
    customerEmail: 'customer@example.com',
    ownerId: 'owner-1',
    monthlyRent: 12000,
    propertyTitle: 'Sunrise PG',
    roomNumber: '101',
    startDate: '2026-04-01',
    endDate: '2026-05-01',
    durationMonths: 1,
    paymentStatus: 'paid',
    paymentType: 'advance',
    amountPaid: 12000,
    advancePaid: 12000,
    createdAt: '2026-04-01T00:00:00.000Z',
    status,
    notifications: [],
});

describe('BookingStatusListener', () => {
    let bookingsCallback: ((bookings: Booking[]) => void | Promise<void>) | null = null;

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        bookingsCallback = null;
        bookingService.hasUserRatedBooking.mockResolvedValue(false);
        bookingService.subscribeToCustomerBookings.mockImplementation((
            _customerId: string,
            callback: (bookings: Booking[]) => void | Promise<void>
        ) => {
            bookingsCallback = callback;
            return () => undefined;
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows the check-in rating popup when a booking transitions into checked-in', async () => {
        render(<BookingStatusListener />);

        await act(async () => {
            await bookingsCallback?.([buildBooking('approved')]);
        });

        expect(screen.queryByTestId('rating-popup')).not.toBeInTheDocument();

        await act(async () => {
            await bookingsCallback?.([buildBooking('checked-in')]);
        });

        expect(screen.getByTestId('rating-popup')).toHaveTextContent('Rate your Check-in Experience');
        expect(bookingService.hasUserRatedBooking).toHaveBeenCalledWith('booking-1', 'checkin');
    });

    it('shows the stay rating popup when a booking transitions into checked-out', async () => {
        render(<BookingStatusListener />);

        await act(async () => {
            await bookingsCallback?.([buildBooking('checked-in')]);
        });

        expect(screen.queryByTestId('rating-popup')).not.toBeInTheDocument();

        await act(async () => {
            await bookingsCallback?.([buildBooking('checked-out')]);
        });

        expect(screen.getByTestId('rating-popup')).toHaveTextContent('Rate your Stay Experience');
        expect(bookingService.hasUserRatedBooking).toHaveBeenCalledWith('booking-1', 'checkout');
    });
});
