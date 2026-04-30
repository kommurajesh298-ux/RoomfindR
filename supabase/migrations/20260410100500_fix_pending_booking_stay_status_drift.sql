UPDATE public.bookings
SET stay_status = NULL,
    updated_at = timezone('utc', now())
WHERE COALESCE(vacate_date, NULL) IS NULL
  AND lower(COALESCE(status::text, '')) IN (
    'requested',
    'pending',
    'approved',
    'accepted',
    'confirmed',
    'paid',
    'payment_pending',
    'payment-pending',
    'payment_failed',
    'payment-failed',
    'rejected',
    'cancelled',
    'refunded'
  )
  AND lower(COALESCE(stay_status, '')) IN ('ongoing', 'active', 'checked-in', 'checked_in');

NOTIFY pgrst, 'reload schema';
