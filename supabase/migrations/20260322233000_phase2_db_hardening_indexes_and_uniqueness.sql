BEGIN;

CREATE INDEX IF NOT EXISTS bookings_owner_status_created_hot_idx
ON public.bookings(owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_customer_status_created_hot_idx
ON public.bookings(customer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_customer_created_hot_idx
ON public.payments(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_customer_payment_status_hot_idx
ON public.payments(customer_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_payment_status_created_hot_idx
ON public.payments(payment_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS payments_monthly_cycle_success_unique_idx
ON public.payments(
  booking_id,
  LOWER(NULLIF(BTRIM(metadata ->> 'month'), ''))
)
WHERE LOWER(COALESCE(payment_type, '')) IN ('monthly', 'rent')
  AND NULLIF(BTRIM(metadata ->> 'month'), '') IS NOT NULL
  AND LOWER(COALESCE(payment_status, status, '')) IN ('paid', 'completed', 'success', 'authorized');

CREATE INDEX IF NOT EXISTS rent_booking_status_created_hot_idx
ON public.rent(booking_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS rent_owner_status_created_hot_idx
ON public.rent(owner_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS settlements_owner_status_created_hot_idx
ON public.settlements(owner_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_admin_rent_payment_summary()
RETURNS TABLE (
  total_count BIGINT,
  successful_count BIGINT,
  pending_count BIGINT,
  total_amount NUMERIC,
  commission_amount NUMERIC,
  owner_payout_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH rent_rows AS (
    SELECT
      r.transaction_id,
      COALESCE(r.amount, 0)::NUMERIC AS amount,
      LOWER(COALESCE(r.payment_status, 'pending')) AS payment_status
    FROM public.rent r
  ),
  settlement_rows AS (
    SELECT
      s.payment_id,
      COALESCE(s.platform_fee, 0)::NUMERIC AS platform_fee,
      COALESCE(s.net_payable, 0)::NUMERIC AS net_payable
    FROM public.settlements s
    WHERE LOWER(COALESCE(s.payment_type, '')) IN ('monthly', 'rent')
  )
  SELECT
    COUNT(*)::BIGINT AS total_count,
    COUNT(*) FILTER (WHERE rent_rows.payment_status IN ('success', 'paid', 'completed', 'authorized'))::BIGINT AS successful_count,
    COUNT(*) FILTER (WHERE rent_rows.payment_status IN ('pending', 'processing', 'created'))::BIGINT AS pending_count,
    COALESCE(SUM(CASE
      WHEN rent_rows.payment_status IN ('success', 'paid', 'completed', 'authorized') THEN rent_rows.amount
      ELSE 0
    END), 0)::NUMERIC AS total_amount,
    COALESCE(SUM(COALESCE(settlement_rows.platform_fee, 0)), 0)::NUMERIC AS commission_amount,
    COALESCE(SUM(
      CASE
        WHEN settlement_rows.payment_id IS NOT NULL THEN COALESCE(settlement_rows.net_payable, 0)
        WHEN rent_rows.payment_status IN ('success', 'paid', 'completed', 'authorized') THEN rent_rows.amount
        ELSE 0
      END
    ), 0)::NUMERIC AS owner_payout_amount
  FROM rent_rows
  LEFT JOIN settlement_rows
    ON settlement_rows.payment_id = rent_rows.transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_rent_payment_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_owner_finance_summary(p_owner_id UUID)
RETURNS TABLE (
  total_net_payout NUMERIC,
  payout_in_flight BIGINT,
  total_refund_amount NUMERIC,
  refunds_in_flight BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH settlement_stats AS (
    SELECT
      COALESCE(SUM(COALESCE(s.net_payable, 0)), 0)::NUMERIC AS total_net_payout,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(s.status, '')) IN ('PENDING', 'PROCESSING'))::BIGINT AS payout_in_flight
    FROM public.settlements s
    WHERE s.owner_id = p_owner_id
  ),
  refund_stats AS (
    SELECT
      COALESCE(SUM(COALESCE(r.refund_amount, 0)), 0)::NUMERIC AS total_refund_amount,
      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(r.refund_status::text, r.status::text, '')) IN ('PENDING', 'PROCESSING', 'ONHOLD')
      )::BIGINT AS refunds_in_flight
    FROM public.refunds r
    JOIN public.bookings b
      ON b.id = r.booking_id
    WHERE b.owner_id = p_owner_id
  )
  SELECT
    settlement_stats.total_net_payout,
    settlement_stats.payout_in_flight,
    refund_stats.total_refund_amount,
    refund_stats.refunds_in_flight
  FROM settlement_stats, refund_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_owner_finance_summary(UUID) TO authenticated, service_role;

COMMIT;
