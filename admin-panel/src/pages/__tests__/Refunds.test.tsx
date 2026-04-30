import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Refunds from '../Refunds';
import { paymentService } from '../../services/payment.service';

jest.mock('../../services/payment.service', () => ({
    paymentService: {
        subscribeToRefunds: jest.fn(),
        syncRefund: jest.fn(),
        processRefund: jest.fn(),
        rejectRefund: jest.fn()
    }
}));

jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn()
}));

describe('Refunds Page', () => {
    const mockRefunds = [
        {
            id: 'ref_pending',
            booking_id: 'book_pending',
            payment_id: 'pay_pending',
            refund_amount: 500,
            commission_amount: 0,
            amount: 500,
            status: 'PENDING',
            raw_status: 'PENDING',
            created_at: '2026-01-02T10:00:00Z',
            bookings: {
                customer_name: 'Jane Smith',
                properties: { title: 'Luxury Villa' }
            },
            payments: { amount: 500 }
        },
        {
            id: 'ref_success',
            booking_id: 'book_success',
            payment_id: 'pay_success',
            refund_amount: 1000,
            commission_amount: 0,
            amount: 1000,
            status: 'SUCCESS',
            raw_status: 'SUCCESS',
            created_at: '2026-01-01T10:00:00Z',
            bookings: {
                customer_name: 'John Doe',
                properties: { title: 'Cozy Room' }
            },
            payments: { amount: 1000 }
        },
        {
            id: 'ref_onhold',
            booking_id: 'book_onhold',
            payment_id: 'pay_onhold',
            refund_amount: 540,
            commission_amount: 40,
            amount: 540,
            status: 'ONHOLD',
            raw_status: 'ONHOLD',
            created_at: '2026-01-03T10:00:00Z',
            bookings: {
                customer_name: 'Preethi',
                amount_paid: 540,
                advance_paid: 500,
                amount_due: 500,
                payment_type: 'advance',
                platform_fee: 33.9,
                platform_gst: 6.1,
                platform_gst_rate: 0.18,
                total_amount: 540,
                properties: { title: 'Pavan_PG Boys' }
            },
            payments: { amount: 540 }
        }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (paymentService.subscribeToRefunds as jest.Mock).mockImplementation((callback) => {
            callback(mockRefunds);
            return jest.fn();
        });
        (paymentService.syncRefund as jest.Mock).mockResolvedValue(null);
        (paymentService.processRefund as jest.Mock).mockResolvedValue({ success: true });
        (paymentService.rejectRefund as jest.Mock).mockResolvedValue({ success: true });
    });

    it('renders refund list correctly', async () => {
        render(<Refunds />);

        await waitFor(() => {
            expect(screen.getByText('Refund Monitoring')).toBeInTheDocument();
            expect(screen.getByText('John Doe')).toBeInTheDocument();
            expect(screen.getByText('Jane Smith')).toBeInTheDocument();
            expect(screen.getAllByText('PENDING APPROVAL').length).toBeGreaterThan(0);
        });
    });

    it('filters refunds by status', async () => {
        render(<Refunds />);

        fireEvent.click(screen.getByRole('button', { name: 'SUCCESS' }));

        await waitFor(() => {
            expect(screen.getByText('John Doe')).toBeInTheDocument();
            expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
        });
    });

    it('keeps pending approval separate from processing', async () => {
        render(<Refunds />);

        await waitFor(() => {
            expect(screen.getByText('Gateway processing only')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'PENDING APPROVAL' }));

        await waitFor(() => {
            expect(screen.getByText('Jane Smith')).toBeInTheDocument();
            expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
        });
    });

    it('shows on-hold refunds separately from processing', async () => {
        render(<Refunds />);

        await waitFor(() => {
            expect(screen.getByText('On Hold')).toBeInTheDocument();
            expect(screen.getAllByText('ON HOLD').length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getByRole('button', { name: 'ON HOLD' }));

        await waitFor(() => {
            expect(screen.getByText('Preethi')).toBeInTheDocument();
            expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
            expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
        });
    });

    it('shows GST-aware paid and owner-share values for structured refund rows', async () => {
        render(<Refunds />);

        await waitFor(() => {
            expect(screen.getByText('Paid INR 540')).toBeInTheDocument();
            expect(screen.getByText('Owner share INR 500')).toBeInTheDocument();
        });
    });

    it('opens the review modal and approves a refund', async () => {
        render(<Refunds />);

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

        expect(screen.getByText('Approve booking refund')).toBeInTheDocument();
        expect(screen.getAllByText('Jane Smith').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Approve Refund' }));

        await waitFor(() => {
            expect(paymentService.processRefund).toHaveBeenCalledWith(expect.objectContaining({
                refundId: 'ref_pending',
                paymentId: 'pay_pending',
                bookingId: 'book_pending',
                refundAmount: 500,
                commissionAmount: 0
            }));
        });
    });

    it('rejects a pending refund request from the modal', async () => {
        render(<Refunds />);

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reject Refund' }));

        await waitFor(() => {
            expect(paymentService.rejectRefund).toHaveBeenCalledWith(expect.objectContaining({
                refundId: 'ref_pending',
                paymentId: 'pay_pending',
                bookingId: 'book_pending'
            }));
        });
    });
});
