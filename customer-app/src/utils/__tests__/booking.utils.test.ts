import { buildActualMonthlyPaymentHistory } from '../booking.utils';

describe('buildActualMonthlyPaymentHistory', () => {
    it('keeps only actual payment rows and excludes synthetic upcoming states', () => {
        const history = buildActualMonthlyPaymentHistory([
            {
                paymentId: 'pending-1',
                bookingId: 'booking-1',
                month: '2026-04',
                amount: 6000,
                paidAt: '2026-04-20T08:00:00.000Z',
                status: 'pending'
            },
            {
                paymentId: 'upcoming-1',
                bookingId: 'booking-1',
                month: '2026-03',
                amount: 6000,
                paidAt: '',
                status: 'upcoming'
            }
        ]);

        expect(history).toHaveLength(1);
        expect(history[0].paymentId).toBe('pending-1');
    });

    it('deduplicates a month to the strongest backend-confirmed state', () => {
        const history = buildActualMonthlyPaymentHistory([
            {
                paymentId: 'failed-1',
                bookingId: 'booking-1',
                month: '2026-04',
                amount: 6000,
                paidAt: '2026-04-20T08:00:00.000Z',
                status: 'failed'
            },
            {
                paymentId: 'paid-1',
                bookingId: 'booking-1',
                month: '2026-04',
                amount: 6000,
                paidAt: '2026-04-20T09:00:00.000Z',
                status: 'paid'
            }
        ]);

        expect(history).toHaveLength(1);
        expect(history[0].paymentId).toBe('paid-1');
        expect(history[0].status).toBe('paid');
    });

    it('prefers a newer failed attempt over an older pending row for the same month', () => {
        const history = buildActualMonthlyPaymentHistory([
            {
                paymentId: 'pending-1',
                bookingId: 'booking-1',
                month: '2026-04',
                amount: 6000,
                paidAt: '2026-04-20T08:00:00.000Z',
                status: 'pending'
            },
            {
                paymentId: 'failed-1',
                bookingId: 'booking-1',
                month: '2026-04',
                amount: 6000,
                paidAt: '2026-04-20T09:00:00.000Z',
                status: 'failed'
            }
        ]);

        expect(history).toHaveLength(1);
        expect(history[0].paymentId).toBe('failed-1');
        expect(history[0].status).toBe('failed');
    });

    it('keeps a newer pending retry attempt visible over an older failed row', () => {
        const history = buildActualMonthlyPaymentHistory([
            {
                paymentId: 'failed-1',
                bookingId: 'booking-1',
                month: '2026-04',
                amount: 6000,
                paidAt: '2026-04-20T08:00:00.000Z',
                status: 'failed'
            },
            {
                paymentId: 'pending-1',
                bookingId: 'booking-1',
                month: '2026-04',
                amount: 6000,
                paidAt: '2026-04-20T09:00:00.000Z',
                status: 'pending'
            }
        ]);

        expect(history).toHaveLength(1);
        expect(history[0].paymentId).toBe('pending-1');
        expect(history[0].status).toBe('pending');
    });
});
