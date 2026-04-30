import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Settlements from '../Settlements';
import { bookingService } from '../../services/booking.service';
import { refundService } from '../../services/refund.service';
import { useAuth } from '../../hooks/useAuth';

jest.mock('../../services/booking.service');
jest.mock('../../services/refund.service');
jest.mock('../../hooks/useAuth');
jest.mock('date-fns', () => ({
    format: () => '01 Jan 2026, 12:00'
}));

describe('Settlements Page', () => {
    const mockSettlements = [
        {
            id: 'settle_123',
            payment_type: 'booking',
            week_start_date: '2026-01-01',
            week_end_date: '2026-01-07',
            total_amount: 15000,
            platform_fee: 750,
            net_payable: 14250,
            status: 'COMPLETED',
            provider_reference: 'utr_123456',
            created_at: '2026-01-08T10:00:00Z',
            processed_at: '2026-01-08T12:05:00Z'
        },
        {
            id: 'settle_456',
            payment_type: 'monthly',
            week_start_date: '2026-01-08',
            week_end_date: '2026-01-14',
            total_amount: 8000,
            platform_fee: 400,
            net_payable: 7600,
            status: 'PROCESSING',
            created_at: '2026-01-15T10:00:00Z'
        }
    ];

    const mockBookings = [
        {
            bookingId: 'book_123',
            propertyId: 'property_123',
            roomId: 'room_101',
            customerId: 'customer_123',
            customerName: 'Kommu Rajesh',
            customerPhone: '9999999999',
            customerEmail: 'rajesh@example.com',
            ownerId: 'user_123',
            propertyTitle: 'Pavan_pg_Boys',
            roomNumber: '101',
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            checkInDate: '2026-01-01',
            durationMonths: 12,
            monthlyRent: 6000,
            paymentStatus: 'paid',
            paymentType: 'monthly',
            amountPaid: 6000,
            advancePaid: 0,
            createdAt: '2026-01-01T09:00:00Z',
            status: 'checked-in',
            stayStatus: 'ongoing',
            notifications: []
        },
        {
            bookingId: 'book_456',
            propertyId: 'property_123',
            roomId: 'room_101',
            customerId: 'customer_456',
            customerName: 'Preethi',
            customerPhone: '8888888888',
            customerEmail: 'preethi@example.com',
            ownerId: 'user_123',
            propertyTitle: 'Pavan_pg_Boys',
            roomNumber: '101',
            startDate: '2026-02-01',
            endDate: '2026-12-31',
            checkInDate: '2026-02-01',
            durationMonths: 11,
            monthlyRent: 6000,
            paymentStatus: 'pending',
            paymentType: 'monthly',
            amountPaid: 0,
            advancePaid: 0,
            createdAt: '2026-02-01T09:00:00Z',
            status: 'approved',
            stayStatus: 'ongoing',
            notifications: []
        }
    ];

    const mockPayments = [
        {
            id: 'payment_123',
            booking_id: 'book_123',
            amount: 6000,
            payment_date: '2026-01-10T08:00:00Z',
            created_at: '2026-01-10T08:00:00Z',
            payment_type: 'monthly',
            status: 'completed',
            payment_status: 'paid',
            provider_order_id: 'order_123',
            provider_payment_id: 'txn_123'
        }
    ];

    const mockRefunds = [
        {
            id: 'refund_123',
            paymentId: 'pay_123',
            bookingId: 'book_123',
            refundAmount: 500,
            reason: 'Booking rejected',
            status: 'PROCESSING',
            createdAt: '2026-01-08T13:00:00Z',
            customerName: 'Kommu Rajesh',
            propertyTitle: 'Pavan_pg_Boys'
        },
        {
            id: 'refund_456',
            paymentId: 'pay_456',
            bookingId: 'book_456',
            refundAmount: 1200,
            reason: 'Owner cancellation',
            status: 'SUCCESS',
            providerRefundId: 'rf_456',
            createdAt: '2026-01-10T09:00:00Z',
            processedAt: '2026-01-10T10:30:00Z',
            customerName: 'Test Customer',
            propertyTitle: 'Sunrise Homes'
        }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'user_123' } });
        (bookingService.getSettlements as jest.Mock).mockResolvedValue(mockSettlements);
        (bookingService.getOwnerBookings as jest.Mock).mockResolvedValue(mockBookings);
        (bookingService.getOwnerBookingPayments as jest.Mock).mockResolvedValue(mockPayments);
        (bookingService.subscribeToSettlements as jest.Mock).mockImplementation(() => jest.fn());
        (bookingService.subscribeToOwnerBookings as jest.Mock).mockImplementation(() => jest.fn());
        (bookingService.subscribeToOwnerBookingPayments as jest.Mock).mockImplementation(() => jest.fn());
        (refundService.getOwnerRefunds as jest.Mock).mockResolvedValue(mockRefunds);
        (refundService.subscribeToOwnerRefunds as jest.Mock).mockImplementation(() => jest.fn());
    });

    it('renders summary cards and popup launcher cards', async () => {
        render(<Settlements />);

        await waitFor(() => {
            expect(screen.getByText('Payment History Center')).toBeInTheDocument();
            expect(screen.queryByText('Rent, settlements, and refunds now open in separate popup ledgers so each list stays clean and easier to review.')).not.toBeInTheDocument();
            expect(screen.getByText('Settlement Total')).toBeInTheDocument();
            expect(screen.getByText('Advance Total')).toBeInTheDocument();
            expect(screen.getByText('Rent Total')).toBeInTheDocument();
            expect(screen.getByText('Refund Total')).toBeInTheDocument();
            expect(screen.getByText('Pending Settlements')).toBeInTheDocument();
            expect(screen.getByText('1 completed settlement records')).toBeInTheDocument();
            expect(screen.getByText('1 completed advance settlements')).toBeInTheDocument();
            expect(screen.getByText('1/2 current residents paid this month')).toBeInTheDocument();
            expect(screen.getByText('2 refund records')).toBeInTheDocument();
            expect(screen.getByText('INR 7,600 waiting to settle')).toBeInTheDocument();
            expect(screen.getByText('1 active rooms · 2 current residents')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /rent history/i })).toBeInTheDocument();
            expect(screen.getByText('Advance History')).toBeInTheDocument();
            expect(screen.getAllByText('Refund History').length).toBeGreaterThan(0);
        });
    });

    it('opens the rent popup and shows room-wise resident rows', async () => {
        render(<Settlements />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /rent history/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /rent history/i }));

        expect(await screen.findByText('Rent Ledger')).toBeInTheDocument();
        expect(screen.queryByText('Room-wise list of current residents and their monthly rent payment status.')).not.toBeInTheDocument();
        expect(screen.queryByText('Paid status reflects verified monthly rent payments for the current month. Each room shows its current residents separately.')).not.toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Today' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Week' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Month' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Year' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Settlement' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
        expect(screen.getByText('Pavan_pg_Boys')).toBeInTheDocument();
        expect(screen.getByText('Room 101')).toBeInTheDocument();
        expect(screen.getByText('Kommu Rajesh')).toBeInTheDocument();
        expect(screen.getByText('Preethi')).toBeInTheDocument();
        expect(screen.getAllByText('Paid').length).toBeGreaterThan(1);
        expect(screen.getByText('Unpaid')).toBeInTheDocument();
        expect(screen.getByText('txn_123')).toBeInTheDocument();
        expect(screen.getAllByText('Pending').length).toBeGreaterThan(1);
        expect(screen.queryByText(/Booking ID:/i)).not.toBeInTheDocument();
    });

    it('opens the settlement popup and keeps settlement rows separate from rent', async () => {
        render(<Settlements />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /advance history/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /advance history/i }));

        expect(await screen.findByText('Advance Ledger')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Rent' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
        expect(screen.getByText('Advance')).toBeInTheDocument();
        expect(screen.queryByText('Rent')).not.toBeInTheDocument();
        expect(screen.getAllByText('Transfer').length).toBe(1);
        expect(screen.getByText('utr_123456')).toBeInTheDocument();
        expect(screen.queryByText('Processing')).not.toBeInTheDocument();
        expect(screen.getByText('settle_123')).toBeInTheDocument();
        expect(screen.getAllByText('INR 14,250').length).toBeGreaterThan(1);
        expect(screen.queryByText('INR 7,600')).not.toBeInTheDocument();
    });

    it('opens the refund popup and shows refund rows with payment details', async () => {
        render(<Settlements />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /refund history/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /refund history/i }));

        expect(await screen.findByText('Refund Ledger')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Rent' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Settlement' })).not.toBeInTheDocument();
        expect(screen.getAllByText('Kommu Rajesh').length).toBeGreaterThan(1);
        expect(screen.getAllByText('Test Customer').length).toBeGreaterThan(1);
        expect(screen.getByText('INR 500')).toBeInTheDocument();
        expect(screen.getByText('INR 1,200')).toBeInTheDocument();
        expect(screen.getByText('pay_123')).toBeInTheDocument();
        expect(screen.getByText('rf_456')).toBeInTheDocument();
        expect(screen.getByText('Refunded')).toBeInTheDocument();
        expect(screen.getByText('Processing')).toBeInTheDocument();
    });

    it('handles combined empty state', async () => {
        (bookingService.getSettlements as jest.Mock).mockResolvedValue([]);
        (bookingService.getOwnerBookings as jest.Mock).mockResolvedValue([]);
        (bookingService.getOwnerBookingPayments as jest.Mock).mockResolvedValue([]);
        (refundService.getOwnerRefunds as jest.Mock).mockResolvedValue([]);

        render(<Settlements />);

        await waitFor(() => {
            expect(screen.getByText('No Payment History Yet')).toBeInTheDocument();
        });
    });
});
