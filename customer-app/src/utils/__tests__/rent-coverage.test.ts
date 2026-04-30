import { format } from 'date-fns';
import { resolveRentCoverageSummary } from '../rent-coverage';

describe('resolveRentCoverageSummary', () => {
  it('keeps monthly bookings on a single-cycle due date after one verified rent payment', () => {
    const summary = resolveRentCoverageSummary({
      status: 'checked-in',
      stayStatus: 'ongoing',
      paymentType: 'monthly',
      paymentStatus: 'paid',
      currentCycleStartDate: '2026-04-13',
      checkInDate: '2026-04-13',
      startDate: '2026-04-13',
      cycleDurationDays: 30,
      payments: [
        {
          paymentId: 'pay-1',
          bookingId: 'booking-1',
          month: '2026-04',
          amount: 5000,
          paidAt: '2026-04-14T10:00:00.000Z',
          status: 'paid',
        },
      ],
      today: new Date('2026-04-15T00:00:00.000Z'),
    });

    expect(summary.isPrepaidFullStay).toBe(false);
    expect(summary.isCurrentCycleSettled).toBe(true);
    expect(summary.effectiveNextDueDate ? format(summary.effectiveNextDueDate, 'yyyy-MM-dd') : null).toBe('2026-05-13');
    expect(summary.dueDaysRemaining).toBe(28);
  });

  it('covers the selected duration for a full-payment booking', () => {
    const summary = resolveRentCoverageSummary({
      status: 'checked-in',
      stayStatus: 'ongoing',
      paymentType: 'full',
      paymentStatus: 'completed',
      durationMonths: 3,
      checkInDate: '2026-04-13',
      startDate: '2026-04-13',
      cycleDurationDays: 30,
      today: new Date('2026-04-15T00:00:00.000Z'),
    });

    expect(summary.isPrepaidFullStay).toBe(true);
    expect(summary.coveredThroughMonth).toBe('2026-06');
    expect(summary.effectiveNextDueDate ? format(summary.effectiveNextDueDate, 'yyyy-MM-dd') : null).toBe('2026-07-13');
    expect(summary.dueDaysRemaining).toBe(89);
  });

  it('closes rent dates for vacated bookings', () => {
    const summary = resolveRentCoverageSummary({
      status: 'checked-out',
      stayStatus: 'vacated',
      vacateDate: '2026-04-15',
      today: new Date('2026-04-15T00:00:00.000Z'),
    });

    expect(summary.effectiveCycleStartDate).toBeNull();
    expect(summary.effectiveNextDueDate).toBeNull();
    expect(summary.dueDaysRemaining).toBeNull();
  });
});
