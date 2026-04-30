import { getBookingInvoiceSummary } from '../invoice';
import type { BookingWithDetails } from '../../types/booking.types';

const buildBooking = (overrides: Partial<BookingWithDetails> = {}): BookingWithDetails => ({
  bookingId: '05a3f089-c1be-49c9-9d41-2d41b5541a9d',
  propertyId: 'property-1',
  roomId: 'room-1',
  customerId: 'customer-1',
  customerName: 'Preethi',
  customerPhone: '+919999999999',
  customerEmail: 'preethi@example.com',
  ownerId: 'owner-1',
  monthlyRent: 6000,
  propertyTitle: 'Pavan_PG Boys',
  roomNumber: '101',
  startDate: '2026-03-29',
  endDate: '2026-04-29',
  durationMonths: 1,
  paymentStatus: 'paid',
  paymentType: 'advance',
  amountPaid: 540,
  advancePaid: 540,
  amountDue: 6000,
  createdAt: '2026-03-29T10:00:00.000Z',
  status: 'checked-in',
  notifications: [],
  ...overrides,
});

describe('getBookingInvoiceSummary', () => {
  test('uses the real advance payment amount instead of applying blanket 18% rent tax', () => {
    const summary = getBookingInvoiceSummary(buildBooking());

    expect(summary.roomChargeLabel).toBe('Room Charges (Advance Booking)');
    expect(summary.roomCharge).toBe(540);
    expect(summary.roomGst).toBe(0);
    expect(summary.platformFee).toBe(0);
    expect(summary.platformGst).toBe(0);
    expect(summary.totalAmount).toBe(540);
    expect(summary.amountPaid).toBe(540);
    expect(summary.balanceDue).toBe(0);
  });

  test('uses the monthly due amount for pending rent invoices', () => {
    const summary = getBookingInvoiceSummary(buildBooking({
      paymentType: 'monthly',
      paymentStatus: 'pending',
      amountPaid: 0,
      advancePaid: 540,
      amountDue: 6000,
    }));

    expect(summary.roomChargeLabel).toBe('Room Charges (Monthly Rent)');
    expect(summary.roomCharge).toBe(6000);
    expect(summary.totalAmount).toBe(6000);
    expect(summary.amountPaid).toBe(0);
    expect(summary.balanceDue).toBe(6000);
  });

  test('honors structured GST fields when they are stored on the booking', () => {
    const summary = getBookingInvoiceSummary(buildBooking({
      paymentType: 'full',
      amountPaid: 6838,
      amountDue: 6000,
      roomGst: 720,
      roomGstRate: 0.12,
      platformFee: 100,
      platformGst: 18,
      platformGstRate: 0.18,
      totalAmount: 6838,
    }));

    expect(summary.usesStructuredTaxes).toBe(true);
    expect(summary.roomCharge).toBe(6000);
    expect(summary.roomGst).toBe(720);
    expect(summary.platformFee).toBe(100);
    expect(summary.platformGst).toBe(18);
    expect(summary.totalAmount).toBe(6838);
    expect(summary.balanceDue).toBe(0);
  });
});
