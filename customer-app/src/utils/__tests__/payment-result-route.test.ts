import {
  buildPaymentFailureRedirect,
  buildPaymentSuccessRedirect,
} from '../payment-result-route';

describe('payment result routes', () => {
  test('routes booking payment failures back to bookings with failure state', () => {
    expect(buildPaymentFailureRedirect({
      bookingId: 'booking-123',
      propertyId: 'property-123',
      roomId: 'room-123',
      app: 'customer',
      isRentPayment: false,
      context: 'verification',
      message: 'Wait for refund.',
    })).toBe('/bookings?app=customer&booking_id=booking-123&payment_result=failed&payment_context=verification&payment_message=Wait+for+refund.&highlight=booking-123');
  });

  test('routes booking payment successes to bookings with owner-wait state', () => {
    expect(buildPaymentSuccessRedirect({
      bookingId: 'booking-123',
      app: 'customer',
      isRentPayment: false,
      message: 'Payment received.',
    })).toBe('/bookings?app=customer&payment_result=success&payment_context=payment&payment_message=Payment+received.&booking_id=booking-123&owner_wait=1&highlight=booking-123');
  });
});
