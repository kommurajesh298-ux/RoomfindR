import { format } from 'date-fns';
import { resolveDisplayRentDueDate } from '../rent-cycle';

describe('resolveDisplayRentDueDate', () => {
    it('prefers the current rent-cycle due date when available', () => {
        const resolved = resolveDisplayRentDueDate({
            startDate: '2026-04-13',
            currentCycleStartDate: '2026-04-13',
            cycleNextDueDate: '2026-05-13',
            legacyNextPaymentDate: '2026-08-11',
            cycleDurationDays: 30,
            status: 'checked-in'
        });

        expect(resolved ? format(resolved, 'yyyy-MM-dd') : null).toBe('2026-05-13');
    });

    it('ignores a stale legacy next payment date that spills far past the active cycle', () => {
        const resolved = resolveDisplayRentDueDate({
            startDate: '2026-04-13',
            legacyNextPaymentDate: '2026-08-11',
            cycleDurationDays: 30,
            status: 'checked-in'
        });

        expect(resolved ? format(resolved, 'yyyy-MM-dd') : null).toBe('2026-05-13');
    });

    it('returns null for a vacated booking so old rent countdowns do not survive checkout', () => {
        const resolved = resolveDisplayRentDueDate({
            startDate: '2026-04-13',
            legacyNextPaymentDate: '2026-08-11',
            vacateDate: '2026-04-20',
            status: 'checked-out'
        });

        expect(resolved).toBeNull();
    });
});
