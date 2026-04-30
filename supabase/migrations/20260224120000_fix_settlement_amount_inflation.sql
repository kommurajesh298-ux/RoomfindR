BEGIN;
-- Fix settlement gross inflation:
-- gross must follow actual paid amount (advance/paid), not monthly_rent fallback.
CREATE OR REPLACE FUNCTION public.prepare_settlement_for_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_latest_paid NUMERIC := 0;
    v_fee_pct NUMERIC := 0;
    v_gross NUMERIC := 0;
    v_platform_fee NUMERIC := 0;
    v_net NUMERIC := 0;
BEGIN
    SELECT *
    INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF lower(coalesce(v_booking.status::text, '')) NOT IN (
        'accepted',
        'approved',
        'checked-in',
        'checked_in',
        'active',
        'ongoing',
        'completed'
    ) THEN
        RETURN;
    END IF;

    -- Choose one trusted successful payment amount (latest verified/high-confidence row first).
    SELECT coalesce(p.amount, 0)
    INTO v_latest_paid
    FROM public.payments p
    WHERE p.booking_id = v_booking.id
      AND lower(coalesce(p.status::text, p.payment_status::text, '')) IN ('completed', 'success', 'paid', 'authorized')
    ORDER BY
      CASE
        WHEN p.verified_at IS NOT NULL
          OR coalesce(p.webhook_received, FALSE) = TRUE
          OR nullif(coalesce(p.provider_payment_id, ''), '') IS NOT NULL
          THEN 0
        ELSE 1
      END,
      coalesce(p.verified_at, p.updated_at, p.created_at) DESC NULLS LAST,
      p.created_at DESC NULLS LAST
    LIMIT 1;

    -- Strict precedence: payment row -> booking.amount_paid -> booking.advance_paid.
    -- Do NOT fallback to monthly_rent/amount_due (causes 500 -> 5000 inflation).
    v_gross := greatest(
        0,
        coalesce(
            nullif(v_latest_paid, 0),
            nullif(coalesce(v_booking.amount_paid, 0), 0),
            nullif(coalesce(v_booking.advance_paid, 0), 0),
            0
        )
    );

    IF v_gross <= 0 THEN
        RETURN;
    END IF;

    SELECT coalesce(nullif(value, '')::numeric, 0)
    INTO v_fee_pct
    FROM public.config
    WHERE key = 'platform_fee_percentage'
    LIMIT 1;

    v_platform_fee := round((v_gross * coalesce(v_fee_pct, 0)) / 100, 2);
    v_net := greatest(0, round(v_gross - v_platform_fee, 2));

    INSERT INTO public.settlements (
        booking_id,
        owner_id,
        week_start_date,
        week_end_date,
        period_type,
        total_amount,
        platform_fee,
        net_payable,
        refunded_amount,
        status,
        payout_status,
        failure_reason,
        updated_at
    )
    VALUES (
        v_booking.id,
        v_booking.owner_id,
        coalesce(v_booking.start_date, current_date),
        coalesce(v_booking.end_date, v_booking.start_date, current_date),
        'WEEKLY',
        v_gross,
        v_platform_fee,
        v_net,
        0,
        'PENDING',
        'PENDING',
        NULL,
        now()
    )
    ON CONFLICT (booking_id) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        week_start_date = EXCLUDED.week_start_date,
        week_end_date = EXCLUDED.week_end_date,
        period_type = EXCLUDED.period_type,
        total_amount = CASE
            WHEN upper(coalesce(public.settlements.status::text, '')) IN ('PROCESSING', 'COMPLETED')
              OR upper(coalesce(public.settlements.payout_status, '')) IN ('PROCESSING', 'SUCCESS')
                THEN public.settlements.total_amount
            ELSE EXCLUDED.total_amount
        END,
        platform_fee = CASE
            WHEN upper(coalesce(public.settlements.status::text, '')) IN ('PROCESSING', 'COMPLETED')
              OR upper(coalesce(public.settlements.payout_status, '')) IN ('PROCESSING', 'SUCCESS')
                THEN public.settlements.platform_fee
            ELSE EXCLUDED.platform_fee
        END,
        net_payable = CASE
            WHEN upper(coalesce(public.settlements.status::text, '')) IN ('PROCESSING', 'COMPLETED')
              OR upper(coalesce(public.settlements.payout_status, '')) IN ('PROCESSING', 'SUCCESS')
                THEN public.settlements.net_payable
            ELSE EXCLUDED.net_payable
        END,
        refunded_amount = coalesce(public.settlements.refunded_amount, 0),
        status = CASE
            WHEN upper(coalesce(public.settlements.status::text, '')) IN ('PROCESSING', 'COMPLETED')
                THEN public.settlements.status
            ELSE 'PENDING'::public.settlement_status_enum
        END,
        payout_status = CASE
            WHEN upper(coalesce(public.settlements.status::text, '')) = 'COMPLETED'
              OR upper(coalesce(public.settlements.payout_status, '')) = 'SUCCESS'
                THEN 'SUCCESS'
            WHEN upper(coalesce(public.settlements.status::text, '')) = 'PROCESSING'
              OR upper(coalesce(public.settlements.payout_status, '')) = 'PROCESSING'
                THEN 'PROCESSING'
            ELSE 'PENDING'
        END,
        failure_reason = CASE
            WHEN upper(coalesce(public.settlements.status::text, '')) = 'FAILED'
                THEN public.settlements.failure_reason
            ELSE NULL
        END,
        updated_at = now();
END;
$$;
-- Backfill stale non-terminal rows that were inflated by monthly_rent fallback.
WITH fee_pct AS (
    SELECT coalesce(nullif(value, '')::numeric, 0) AS pct
    FROM public.config
    WHERE key = 'platform_fee_percentage'
    LIMIT 1
),
latest_paid AS (
    SELECT DISTINCT ON (p.booking_id)
        p.booking_id,
        greatest(0, coalesce(p.amount, 0)) AS paid_amount
    FROM public.payments p
    WHERE lower(coalesce(p.status::text, p.payment_status::text, '')) IN ('completed', 'success', 'paid', 'authorized')
    ORDER BY
        p.booking_id,
        CASE
            WHEN p.verified_at IS NOT NULL
              OR coalesce(p.webhook_received, FALSE) = TRUE
              OR nullif(coalesce(p.provider_payment_id, ''), '') IS NOT NULL
                THEN 0
            ELSE 1
        END,
        coalesce(p.verified_at, p.updated_at, p.created_at) DESC NULLS LAST,
        p.created_at DESC NULLS LAST
),
computed AS (
    SELECT
        s.id,
        round(
            greatest(
                0,
                coalesce(
                    nullif(lp.paid_amount, 0),
                    nullif(coalesce(b.amount_paid, 0), 0),
                    nullif(coalesce(b.advance_paid, 0), 0),
                    0
                )
            ),
            2
        ) AS expected_gross,
        coalesce((SELECT pct FROM fee_pct), 0) AS fee_pct
    FROM public.settlements s
    JOIN public.bookings b
      ON b.id = s.booking_id
    LEFT JOIN latest_paid lp
      ON lp.booking_id = s.booking_id
    WHERE s.booking_id IS NOT NULL
      AND upper(coalesce(s.status::text, '')) IN ('PENDING', 'FAILED')
      AND upper(coalesce(s.payout_status, 'PENDING')) IN ('PENDING', 'FAILED')
),
expected AS (
    SELECT
        c.id,
        c.expected_gross,
        round((c.expected_gross * c.fee_pct) / 100, 2) AS expected_fee,
        greatest(0, round(c.expected_gross - round((c.expected_gross * c.fee_pct) / 100, 2), 2)) AS expected_net
    FROM computed c
    WHERE c.expected_gross > 0
)
UPDATE public.settlements s
SET total_amount = e.expected_gross,
    platform_fee = e.expected_fee,
    net_payable = e.expected_net,
    updated_at = now()
FROM expected e
WHERE s.id = e.id
  AND (
      coalesce(s.total_amount, 0) <> e.expected_gross
      OR coalesce(s.platform_fee, 0) <> e.expected_fee
      OR coalesce(s.net_payable, 0) <> e.expected_net
  );
-- Re-run preparation for current active bookings to ensure new/updated rows use corrected logic.
DO $$
DECLARE
    v_booking RECORD;
BEGIN
    FOR v_booking IN
        SELECT b.id
        FROM public.bookings b
        WHERE lower(coalesce(b.status::text, '')) IN (
            'accepted',
            'approved',
            'checked-in',
            'checked_in',
            'active',
            'ongoing',
            'completed'
        )
    LOOP
        PERFORM public.prepare_settlement_for_booking(v_booking.id);
    END LOOP;
END;
$$;
COMMIT;
