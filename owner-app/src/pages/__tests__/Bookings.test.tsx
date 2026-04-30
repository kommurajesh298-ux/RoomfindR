import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Bookings from '../Bookings';
import { bookingService } from '../../services/booking.service';
import { propertyService } from '../../services/property.service';
import { useAuth } from '../../hooks/useAuth';
import toast from 'react-hot-toast';
import type { Booking } from '../../types/booking.types';
import type { Property } from '../../types/property.types';

jest.mock('../../services/booking.service');
jest.mock('../../services/property.service');
jest.mock('../../hooks/useAuth');
jest.mock('react-hot-toast');

// Mock date-fns format to avoid date locale issues in tests
jest.mock('date-fns', () => {
    const actual = jest.requireActual('date-fns');
    return {
        ...actual,
        format: jest.fn(() => 'Mocked Date')
    };
});

describe('Owner Bookings Page', () => {
    const mockBooking = {
        bookingId: 'booking-1',
        customerId: 'cust-1',
        customerName: 'Test Customer',
        propertyId: 'prop-1',
        propertyTitle: 'Test Property',
        status: 'requested',
        paymentStatus: 'paid',
        advancePaid: 5000,
        totalAmount: 10000,
        startDate: '2024-05-01',
        endDate: '2024-05-05',
        durationMonths: 1,
        created_at: new Date().toISOString()
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('receives new booking notification in real-time', async () => {
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'owner-1' } });
        (bookingService.subscribeToOwnerBookings as jest.Mock).mockImplementation((_, callback) => {
            callback([mockBooking as unknown as Booking]);
            return () => { };
        });
        (propertyService.subscribeToOwnerProperties as jest.Mock).mockReturnValue(() => { });

        render(<MemoryRouter><Bookings /></MemoryRouter>);

        const customerName = await screen.findByText(/Test Customer/i);
        expect(customerName).toBeInTheDocument();
    });

    it('accepts booking and notifies customer', async () => {
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'owner-1' } });
        (bookingService.acceptBooking as jest.Mock).mockResolvedValue(undefined);
        (bookingService.subscribeToOwnerBookings as jest.Mock).mockImplementation((_, callback) => {
            callback([mockBooking as any]);
            return () => { };
        });
        (propertyService.subscribeToOwnerProperties as jest.Mock).mockReturnValue(() => { });

        render(<MemoryRouter><Bookings /></MemoryRouter>);

        const acceptBtn = await screen.findByText(/Accept/i);
        await act(async () => {
            fireEvent.click(acceptBtn);
        });

        await waitFor(() => {
            expect(bookingService.acceptBooking).toHaveBeenCalled();
            expect(toast.success).toHaveBeenCalled();
        });
    });

    it('marks booking as checked-in', async () => {
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'owner-1' } });
        (bookingService.checkInBooking as jest.Mock).mockResolvedValue(undefined);
        (bookingService.subscribeToOwnerBookings as jest.Mock).mockImplementation((_, callback) => {
            callback([{ ...mockBooking, status: 'accepted' } as unknown as Booking]);
            return () => { };
        });
        (propertyService.subscribeToOwnerProperties as jest.Mock).mockReturnValue(() => { });

        render(<MemoryRouter><Bookings /></MemoryRouter>);

        // Switch to Approved tab (labeled 'Approved' in UI)
        const approvedTab = await screen.findByText(/Approved/i);
        fireEvent.click(approvedTab);

        const checkInBtn = await screen.findByText(/Mark as Checked-In/i);
        await act(async () => {
            fireEvent.click(checkInBtn);
        });

        await waitFor(() => {
            expect(bookingService.checkInBooking).toHaveBeenCalled();
        });
    });

    it('sends broadcast notification to all property customers', async () => {
        window.alert = jest.fn();
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'owner-1' } });
        (bookingService.sendPropertyNotification as jest.Mock).mockResolvedValue(1);
        (bookingService.subscribeToOwnerBookings as jest.Mock).mockImplementation((_, callback) => {
            callback([]);
            return () => { };
        });
        (propertyService.subscribeToOwnerProperties as jest.Mock).mockImplementation((_, callback) => {
            callback([{ propertyId: 'prop-1', title: 'Test Property' } as unknown as Property]);
            return () => { };
        });

        render(<MemoryRouter><Bookings /></MemoryRouter>);

        const broadcastBtn = await screen.findByText(/Broadcast/i);
        await act(async () => {
            fireEvent.click(broadcastBtn);
        });

        const select = await screen.findByRole('combobox');
        fireEvent.change(select, { target: { value: 'prop-1' } });

        const titleInput = screen.getByPlaceholderText(/Maintainence Notice/i);
        fireEvent.change(titleInput, { target: { value: 'Test Title' } });

        const messageInput = screen.getByPlaceholderText(/Type your announcement here/i);
        fireEvent.change(messageInput, { target: { value: 'Test notice' } });

        const sendBtn = screen.getByRole('button', { name: /Broadcast Now/i });
        fireEvent.click(sendBtn);

        await waitFor(() => {
            expect(bookingService.sendPropertyNotification).toHaveBeenCalled();
        });
    });
});
