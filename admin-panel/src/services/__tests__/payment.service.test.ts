import { paymentService } from '../payment.service';
import { supabase } from '../../test/mocks/supabase-config';

describe('admin paymentService rent payments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prefers settlement payout_status over generic settlement status for rent rows', async () => {
    const paymentsQuery = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: [{
          id: 'payment-1',
          booking_id: 'booking-1',
          amount: 5000,
          payment_type: 'monthly',
          payment_method: 'upi',
          provider_order_id: 'order-1',
          provider_payment_id: 'cf-pay-1',
          status: 'SUCCESS',
          payment_status: 'SUCCESS',
          created_at: '2026-04-21T12:00:00Z',
          updated_at: '2026-04-21T12:01:00Z',
          verified_at: '2026-04-21T12:01:00Z',
        }],
        error: null,
      }),
    };

    const bookingsQuery = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({
        data: [{
          id: 'booking-1',
          customer_name: 'Rajesh',
          owners: { name: 'Owner Name' },
          properties: { title: 'Rajesh PG' },
        }],
        error: null,
      }),
    };

    const settlementsQuery = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({
        data: [{
          id: 'settlement-1',
          payment_id: 'payment-1',
          booking_id: 'booking-1',
          status: 'PROCESSING',
          payout_status: 'SUCCESS',
          platform_fee: 0,
          net_payable: 5000,
          provider_reference: 'synthetic_transfer',
          provider_transfer_id: 'transfer-1',
          processed_at: '2026-04-21T12:02:00Z',
        }],
        error: null,
      }),
    };

    supabase.from = jest.fn((table: string) => {
      if (table === 'payments') return paymentsQuery;
      if (table === 'bookings') return bookingsQuery;
      if (table === 'settlements') return settlementsQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const rows = await paymentService.getRentPayments();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'payment-1',
      booking_id: 'booking-1',
      status: 'paid',
      payout_status_display: 'SUCCESS',
    });
  });

  test('treats completed settlement status as successful even when payout_status is stale processing', async () => {
    const paymentsQuery = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: [{
          id: 'payment-2',
          booking_id: 'booking-2',
          amount: 5000,
          payment_type: 'monthly',
          payment_method: 'upi',
          provider_order_id: 'order-2',
          provider_payment_id: 'cf-pay-2',
          status: 'SUCCESS',
          payment_status: 'SUCCESS',
          created_at: '2026-04-21T12:00:00Z',
          updated_at: '2026-04-21T12:01:00Z',
          verified_at: '2026-04-21T12:01:00Z',
        }],
        error: null,
      }),
    };

    const bookingsQuery = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({
        data: [{
          id: 'booking-2',
          customer_name: 'Rajesh',
          owners: { name: 'Owner Name' },
          properties: { title: 'Rajesh PG' },
        }],
        error: null,
      }),
    };

    const settlementsQuery = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({
        data: [{
          id: 'settlement-2',
          payment_id: 'payment-2',
          booking_id: 'booking-2',
          status: 'COMPLETED',
          payout_status: 'processing',
          platform_fee: 0,
          net_payable: 5000,
          provider_reference: 'synthetic_transfer',
          provider_transfer_id: 'transfer-2',
          processed_at: '2026-04-21T12:02:00Z',
        }],
        error: null,
      }),
    };

    supabase.from = jest.fn((table: string) => {
      if (table === 'payments') return paymentsQuery;
      if (table === 'bookings') return bookingsQuery;
      if (table === 'settlements') return settlementsQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const rows = await paymentService.getRentPayments();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'payment-2',
      booking_id: 'booking-2',
      status: 'paid',
      payout_status_display: 'SUCCESS',
    });
  });
});
