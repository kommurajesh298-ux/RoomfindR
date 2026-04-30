import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BookingDetailsModal from '../BookingDetailsModal';
import { bookingService } from '../../../services/booking.service';

jest.mock('../../../services/booking.service', () => ({
    bookingService: {
        subscribeToBookingPayments: jest.fn(() => () => undefined),
    }
}));

describe('BookingDetailsModal', () => {
    it('shows only verified monthly payments in the owner ledger and removes manual payment controls', () => {
        const booking = {
            bookingId: 'booking-1',
            propertyId: 'property-1',
            roomId: 'room-1',
            customerId: 'customer-1',
            customerName: 'Test Customer',
            customerPhone: '9999999999',
            customerEmail: 'customer@example.com',
            ownerId: 'owner-1',
            propertyTitle: 'Test Property',
            roomNumber: '101',
            startDate: '2026-03-01',
            endDate: '2026-05-01',
            durationMonths: 2,
            monthlyRent: 701,
            paymentStatus: 'paid',
            paymentType: 'advance',
            amountPaid: 503,
            advancePaid: 503,
            createdAt: '2026-03-01T00:00:00.000Z',
            status: 'approved',
            notifications: [],
            propertyDetails: {
                title: 'Test Property',
                address: { text: 'Hyderabad' }
            },
            payments: [
                {
                    id: 'advance-payment',
                    amount: 503,
                    payment_date: '2026-03-01T00:00:00.000Z',
                    created_at: '2026-03-01T00:00:00.000Z',
                    payment_type: 'advance',
                    status: 'completed',
                    notes: 'Advance deposit'
                },
                {
                    id: 'monthly-payment-verified',
                    amount: 907,
                    payment_date: '2026-04-01T00:00:00.000Z',
                    created_at: '2026-04-01T00:00:00.000Z',
                    payment_type: 'monthly',
                    status: 'completed',
                    notes: 'April Rent'
                },
                {
                    id: 'monthly-payment-pending',
                    amount: 809,
                    payment_date: '2026-05-01T00:00:00.000Z',
                    created_at: '2026-05-01T00:00:00.000Z',
                    payment_type: 'monthly',
                    status: 'pending',
                    notes: 'May Rent'
                }
            ]
        };

        render(
            <MemoryRouter>
                <BookingDetailsModal
                    isOpen
                    onClose={jest.fn()}
                    booking={booking as any}
                />
            </MemoryRouter>
        );

        expect(bookingService.subscribeToBookingPayments).toHaveBeenCalledWith('booking-1', expect.any(Function));
        expect(screen.queryByText('+ Record Payment')).not.toBeInTheDocument();
        expect(screen.getByText(/Only Cashfree-verified payments are included here/i)).toBeInTheDocument();
        expect(screen.queryByText('Advance deposit')).not.toBeInTheDocument();
        expect(screen.getByText('April Rent')).toBeInTheDocument();
        expect(screen.getByText('May Rent')).toBeInTheDocument();
        expect(screen.getByText('Verified')).toBeInTheDocument();
        expect(screen.getByText('pending')).toBeInTheDocument();
        expect(screen.getByText(/₹907/)).toBeInTheDocument();
        expect(screen.getByText(/₹809/)).toBeInTheDocument();
    });

    it('renders GST-aware invoice breakdown when structured tax fields are present', () => {
        const booking = {
            bookingId: 'booking-gst-1',
            propertyId: 'property-1',
            roomId: 'room-1',
            customerId: 'customer-1',
            customerName: 'Preethi',
            customerPhone: '9999999999',
            customerEmail: 'customer@example.com',
            ownerId: 'owner-1',
            propertyTitle: 'GST Property',
            roomNumber: '101',
            startDate: '2026-03-01',
            endDate: '2026-04-01',
            durationMonths: 1,
            monthlyRent: 500,
            paymentStatus: 'paid',
            paymentType: 'advance',
            amountPaid: 540,
            advancePaid: 500,
            amountDue: 500,
            roomGst: 0,
            roomGstRate: 0,
            platformFee: 33.9,
            platformGst: 6.1,
            platformGstRate: 0.18,
            totalAmount: 540,
            createdAt: '2026-03-01T00:00:00.000Z',
            status: 'rejected',
            notifications: [],
            propertyDetails: {
                title: 'GST Property',
                address: { text: 'Hyderabad' }
            },
            payments: []
        };

        render(
            <MemoryRouter>
                <BookingDetailsModal
                    isOpen
                    onClose={jest.fn()}
                    booking={booking as any}
                />
            </MemoryRouter>
        );

        expect(screen.getByText('Customer Total Payable')).toBeInTheDocument();
        expect(screen.getByText('Platform Fee')).toBeInTheDocument();
        expect(screen.getByText('GST on Platform Fee (18%)')).toBeInTheDocument();
        expect(screen.getByText('Owner Gross Share')).toBeInTheDocument();
        expect(screen.getAllByText(/₹540/).length).toBeGreaterThan(0);
    });
});
