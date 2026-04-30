CREATE INDEX IF NOT EXISTS bookings_owner_created_hot_idx
ON public.bookings(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_customer_created_hot_idx
ON public.bookings(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_booking_type_created_hot_idx
ON public.payments(booking_id, payment_type, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_status_created_hot_idx
ON public.payments(status, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_monthly_booking_payment_date_hot_idx
ON public.payments(booking_id, payment_type, payment_date DESC)
WHERE payment_type IN ('monthly', 'rent');

CREATE INDEX IF NOT EXISTS refunds_status_created_hot_idx
ON public.refunds(status, created_at DESC);

CREATE INDEX IF NOT EXISTS settlements_owner_created_hot_idx
ON public.settlements(owner_id, created_at DESC);
