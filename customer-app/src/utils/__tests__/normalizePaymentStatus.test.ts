import { normalizeRentPaymentStatus } from '../normalizePaymentStatus';

describe('normalizeRentPaymentStatus', () => {
    it('treats successful gateway states as paid', () => {
        expect(normalizeRentPaymentStatus({ status: 'completed' })).toBe('paid');
        expect(normalizeRentPaymentStatus({ payment_status: 'authorized' })).toBe('paid');
    });

    it('treats cancelled and refunded states as failed', () => {
        expect(normalizeRentPaymentStatus({ status: 'cancelled' })).toBe('failed');
        expect(normalizeRentPaymentStatus({ payment_status: 'refunded' })).toBe('failed');
    });

    it('treats expired and terminated states as failed', () => {
        expect(normalizeRentPaymentStatus({ status: 'expired' })).toBe('failed');
        expect(normalizeRentPaymentStatus({ payment_status: 'terminated' })).toBe('failed');
        expect(normalizeRentPaymentStatus({ payment_status: 'rejected' })).toBe('failed');
    });

    it('keeps unknown or pending states pending', () => {
        expect(normalizeRentPaymentStatus({ status: 'pending' })).toBe('pending');
        expect(normalizeRentPaymentStatus({})).toBe('pending');
    });
});
