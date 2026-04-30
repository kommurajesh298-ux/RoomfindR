BEGIN;

INSERT INTO public.rent (
    transaction_id,
    booking_id,
    owner_id,
    customer_id,
    amount,
    payment_status,
    cashfree_order_id,
    cf_payment_id,
    metadata,
    created_at,
    updated_at
)
SELECT
    p.id,
    p.booking_id,
    b.owner_id,
    COALESCE(p.customer_id, b.customer_id),
    COALESCE(p.amount, 0),
    CASE
        WHEN lower(COALESCE(p.payment_status, p.status, 'pending')) IN ('paid', 'completed', 'success', 'authorized') THEN 'success'
        WHEN lower(COALESCE(p.payment_status, p.status, 'pending')) IN ('failed', 'cancelled', 'expired', 'terminated') THEN 'failed'
        WHEN lower(COALESCE(p.payment_status, p.status, 'pending')) = 'refunded' THEN 'refunded'
        ELSE 'pending'
    END,
    NULLIF(trim(COALESCE(p.provider_order_id, '')), ''),
    NULLIF(trim(COALESCE(p.provider_payment_id, '')), ''),
    COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
        'payment_id', p.id,
        'payment_type', COALESCE(p.payment_type, 'monthly'),
        'month', COALESCE(p.metadata->>'month', p.metadata->'client_context'->>'month'),
        'source', 'monthly_payments_backfill'
    ),
    COALESCE(p.verified_at, p.payment_date, p.created_at, timezone('utc', now())),
    timezone('utc', now())
FROM public.payments p
JOIN public.bookings b
  ON b.id = p.booking_id
WHERE lower(COALESCE(p.payment_type, '')) IN ('monthly', 'rent')
ON CONFLICT (transaction_id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    owner_id = EXCLUDED.owner_id,
    customer_id = EXCLUDED.customer_id,
    amount = EXCLUDED.amount,
    payment_status = EXCLUDED.payment_status,
    cashfree_order_id = EXCLUDED.cashfree_order_id,
    cf_payment_id = EXCLUDED.cf_payment_id,
    metadata = COALESCE(public.rent.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = timezone('utc', now());

UPDATE public.settlements
SET amount = COALESCE(NULLIF(total_amount, 0), NULLIF(amount, 0), net_payable, 0),
    total_amount = COALESCE(NULLIF(total_amount, 0), NULLIF(amount, 0), net_payable, 0),
    platform_fee = 0,
    net_payable = COALESCE(NULLIF(total_amount, 0), NULLIF(amount, 0), net_payable, 0),
    payment_status = CASE
        WHEN upper(COALESCE(status, '')) = 'COMPLETED' THEN 'success'
        WHEN upper(COALESCE(status, '')) = 'FAILED' THEN 'failed'
        ELSE COALESCE(payment_status, 'pending')
    END,
    updated_at = timezone('utc', now())
WHERE lower(COALESCE(payment_type, '')) IN ('monthly', 'rent')
  AND (
      COALESCE(platform_fee, 0) <> 0
      OR COALESCE(net_payable, 0) <> COALESCE(NULLIF(total_amount, 0), NULLIF(amount, 0), net_payable, 0)
      OR COALESCE(amount, 0) = 0
      OR lower(COALESCE(payment_status, 'pending')) = 'pending'
  );

COMMIT;
