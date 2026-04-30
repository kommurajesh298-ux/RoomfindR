CREATE INDEX IF NOT EXISTS idx_bookings_customer_created_at_desc
  ON public.bookings(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_owner_created_at_desc
  ON public.bookings(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_customer_status_property
  ON public.bookings(customer_id, status, property_id);

CREATE INDEX IF NOT EXISTS idx_bookings_owner_status_created_at
  ON public.bookings(owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_status_created_at_desc
  ON public.bookings(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_booking_created_at_desc
  ON public.payments(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_booking_type_created_at_desc
  ON public.payments(booking_id, payment_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_provider_order_created_at_desc
  ON public.payments(provider_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_properties_status_city_created_at_desc
  ON public.properties(status, city, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_properties_owner_created_at_desc
  ON public.properties(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created_at_desc
  ON public.notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_favorites_user_created_at_desc
  ON public.favorites(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_created_at
  ON public.ticket_replies(ticket_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.get_admin_overview_stats()
RETURNS TABLE (
  total_users BIGINT,
  total_owners BIGINT,
  total_properties BIGINT,
  total_bookings BIGINT,
  active_bookings BIGINT,
  revenue_estimate NUMERIC,
  commission_estimate NUMERIC,
  advance_amount NUMERIC,
  rent_amount NUMERIC,
  refund_amount NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH booking_metrics AS (
    SELECT
      COUNT(*)::BIGINT AS total_bookings,
      COUNT(*) FILTER (
        WHERE lower(COALESCE(status::text, '')) IN ('approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing')
      )::BIGINT AS active_bookings,
      COALESCE(SUM(commission_amount), 0)::NUMERIC AS commission_estimate
    FROM public.bookings
  ),
  payment_metrics AS (
    SELECT
      COALESCE(SUM(amount) FILTER (
        WHERE lower(COALESCE(payment_status::text, status::text, '')) IN ('completed', 'success', 'authorized', 'paid')
          AND lower(COALESCE(payment_type::text, '')) NOT IN ('monthly', 'rent', 'monthly_rent')
      ), 0)::NUMERIC AS advance_amount,
      COALESCE(SUM(amount) FILTER (
        WHERE lower(COALESCE(payment_status::text, status::text, '')) IN ('completed', 'success', 'authorized', 'paid')
          AND lower(COALESCE(payment_type::text, '')) IN ('monthly', 'rent', 'monthly_rent')
      ), 0)::NUMERIC AS rent_amount
    FROM public.payments
  ),
  refund_metrics AS (
    SELECT
      COALESCE(SUM(refund_amount) FILTER (
        WHERE lower(COALESCE(refund_status::text, status::text, '')) IN ('pending', 'processing', 'onhold', 'success', 'processed')
      ), 0)::NUMERIC AS refund_amount
    FROM public.refunds
  )
  SELECT
    (SELECT COUNT(*)::BIGINT FROM public.accounts) AS total_users,
    (SELECT COUNT(*)::BIGINT FROM public.owners) AS total_owners,
    (SELECT COUNT(*)::BIGINT FROM public.properties) AS total_properties,
    booking_metrics.total_bookings,
    booking_metrics.active_bookings,
    (payment_metrics.advance_amount + payment_metrics.rent_amount)::NUMERIC AS revenue_estimate,
    booking_metrics.commission_estimate,
    payment_metrics.advance_amount,
    payment_metrics.rent_amount,
    refund_metrics.refund_amount
  FROM booking_metrics, payment_metrics, refund_metrics;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_overview_stats() TO authenticated;
