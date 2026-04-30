import { buildNotificationEventId } from '../../../../shared/notification-events';

describe('buildNotificationEventId', () => {
  it('normalizes whitespace, case, and separators into a deterministic id', () => {
    expect(buildNotificationEventId(' Owner Check-In ', 'BOOKING-1', 'Customer 1 ')).toBe(
      'owner-check-in:booking-1:customer-1',
    );
  });

  it('skips empty values without leaving empty separators', () => {
    expect(buildNotificationEventId('vacate', '', null, 'owner')).toBe('vacate:owner');
  });
});
