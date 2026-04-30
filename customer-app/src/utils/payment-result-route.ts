type PaymentResultRouteInput = {
  bookingId?: string;
  propertyId?: string;
  roomId?: string;
  app: string;
  isRentPayment: boolean;
  message?: string;
  context?: string;
};

const setParam = (params: URLSearchParams, key: string, value?: string) => {
  const normalized = String(value || '').trim();
  if (normalized) {
    params.set(key, normalized);
  }
};

export const buildPaymentSuccessRedirect = (input: PaymentResultRouteInput): string => {
  const params = new URLSearchParams();
  setParam(params, 'app', input.app);
  params.set('payment_result', 'success');
  params.set('payment_context', input.isRentPayment ? 'rent' : (input.context || 'payment'));
  setParam(params, 'payment_message', input.message);
  setParam(params, 'booking_id', input.bookingId);

  if (input.isRentPayment) {
    params.set('portalTab', 'payments');
    return `/chat?${params.toString()}`;
  }

  params.set('owner_wait', '1');
  setParam(params, 'highlight', input.bookingId);
  return `/bookings?${params.toString()}`;
};

export const buildPaymentFailureRedirect = (input: PaymentResultRouteInput): string => {
  const params = new URLSearchParams();
  setParam(params, 'app', input.app);
  setParam(params, 'booking_id', input.bookingId);
  const failureContext = input.context || (input.isRentPayment ? 'rent' : 'payment');

  if (input.isRentPayment) {
    params.set('payment_result', 'failed');
    params.set('payment_context', failureContext);
    setParam(params, 'payment_message', input.message);
    params.set('portalTab', 'payments');
    return `/chat?${params.toString()}`;
  }

  params.set('payment_result', 'failed');
  params.set('payment_context', failureContext);
  setParam(params, 'payment_message', input.message);
  setParam(params, 'highlight', input.bookingId);
  return `/bookings?${params.toString()}`;
};

export const buildFreshBookingRetryRedirect = (input: PaymentResultRouteInput): string => {
  if (!input.propertyId) {
    const params = new URLSearchParams();
    setParam(params, 'app', input.app);
    setParam(params, 'booking_id', input.bookingId);
    setParam(params, 'highlight', input.bookingId);
    return params.toString() ? `/bookings?${params.toString()}` : '/bookings';
  }

  const params = new URLSearchParams();
  params.set('retry_booking', '1');
  setParam(params, 'app', input.app);
  setParam(params, 'booking_id', input.bookingId);
  setParam(params, 'room_id', input.roomId);
  return `/property/${encodeURIComponent(input.propertyId)}?${params.toString()}`;
};
