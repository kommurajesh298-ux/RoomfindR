import { sanitizeAmountValue } from '../amountInput';

describe('amountInput utilities', () => {
    it('preserves exact whole-number rupee amounts', () => {
        expect(sanitizeAmountValue(500)).toBe(500);
        expect(sanitizeAmountValue('6000')).toBe(6000);
    });

    it('normalizes decimals without drifting the value', () => {
        expect(sanitizeAmountValue('500.00')).toBe(500);
        expect(sanitizeAmountValue('498.009')).toBe(498.01);
    });

    it('falls back safely for invalid values', () => {
        expect(sanitizeAmountValue('')).toBe(0);
        expect(sanitizeAmountValue(undefined)).toBe(0);
        expect(sanitizeAmountValue('not-a-number')).toBe(0);
    });
});
