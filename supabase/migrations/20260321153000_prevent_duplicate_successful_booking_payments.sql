-- Prevent duplicate successful booking/deposit payments per booking while
-- still allowing multiple monthly/rent payments across different cycles.

CREATE UNIQUE INDEX IF NOT EXISTS payments_successful_booking_scope_uk
ON public.payments (
  booking_id,
  COALESCE(payment_type, 'booking')
)
WHERE COALESCE(payment_type, 'booking') NOT IN ('monthly', 'rent')
  AND lower(COALESCE(status, '')) IN ('completed', 'success', 'paid', 'authorized');
