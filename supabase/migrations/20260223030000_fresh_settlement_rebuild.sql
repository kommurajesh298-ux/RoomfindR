BEGIN;
-- Fresh settlement lifecycle reset: disable legacy automation and rebuild clean RPC workflow.

CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Disable the old cron automation job if it exists.
DO $$
DECLARE
    v_job_id INTEGER;
BEGIN
    SELECT jobid
    INTO v_job_id
    FROM cron.job
    WHERE jobname = 'cashfree-settlement-automation'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
    END IF;
END;
$$;
DROP FUNCTION IF EXISTS public.run_cashfree_settlement_automation();
DROP FUNCTION IF EXISTS public.cashfree_payout_integrity_report();
DROP VIEW IF EXISTS public.v_settlement_approval_guard_violations;
DROP FUNCTION IF EXISTS public.get_settlement_approval_guard_violation_count();
DO $$ BEGIN
    CREATE TYPE public.settlement_period_enum AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS period_type public.settlement_period_enum,
    ADD COLUMN IF NOT EXISTS payout_status TEXT,
    ADD COLUMN IF NOT EXISTS transaction_id TEXT,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failure_reason TEXT,
    ADD COLUMN IF NOT EXISTS payout_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS provider TEXT,
    ADD COLUMN IF NOT EXISTS provider_transfer_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_reference TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE public.settlements
SET period_type = 'WEEKLY'
WHERE period_type IS NULL;
ALTER TABLE public.settlements
    ALTER COLUMN period_type SET DEFAULT 'WEEKLY';
UPDATE public.settlements
SET status = (
    CASE
        WHEN upper(coalesce(status::text, '')) IN ('COMPLETED', 'SUCCESS', 'PAID', 'SETTLEMENT_PAID') THEN 'COMPLETED'
        WHEN upper(coalesce(status::text, '')) IN ('PROCESSING', 'IN_PROGRESS', 'SETTLEMENT_PROCESSING') THEN 'PROCESSING'
        WHEN upper(coalesce(status::text, '')) IN ('FAILED', 'ERROR', 'SETTLEMENT_FAILED') THEN 'FAILED'
        ELSE 'PENDING'
    END
)::public.settlement_status_enum;
UPDATE public.settlements
SET payout_status = CASE
    WHEN upper(coalesce(status::text, '')) = 'COMPLETED' THEN 'SUCCESS'
    WHEN upper(coalesce(status::text, '')) = 'PROCESSING' THEN 'PROCESSING'
    WHEN upper(coalesce(status::text, '')) = 'FAILED' THEN 'FAILED'
    ELSE 'PENDING'
END
WHERE payout_status IS NULL
   OR upper(coalesce(payout_status, '')) NOT IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');
ALTER TABLE public.settlements
    ALTER COLUMN payout_status SET DEFAULT 'PENDING';
ALTER TABLE public.settlements DROP CONSTRAINT IF EXISTS settlements_payout_status_check;
ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_payout_status_check
    CHECK (upper(coalesce(payout_status, 'PENDING')) IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'));
CREATE INDEX IF NOT EXISTS idx_settlements_status_updated
    ON public.settlements(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_owner_status_updated
    ON public.settlements(owner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_payout_status
    ON public.settlements(payout_status);
DROP FUNCTION IF EXISTS public.prepare_settlement_for_booking(UUID);
CREATE OR REPLACE FUNCTION public.prepare_settlement_for_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_paid_total NUMERIC := 0;
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

    SELECT coalesce(sum(coalesce(p.amount, 0)), 0)
    INTO v_paid_total
    FROM public.payments p
    WHERE p.booking_id = v_booking.id
      AND lower(coalesce(p.status::text, p.payment_status::text, '')) IN ('completed', 'success', 'paid', 'authorized');

    v_gross := greatest(
        coalesce(v_paid_total, 0),
        coalesce(v_booking.amount_paid, 0),
        coalesce(v_booking.advance_paid, 0),
        coalesce(v_booking.amount_due, 0),
        coalesce(v_booking.monthly_rent, 0),
        0
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
        total_amount = EXCLUDED.total_amount,
        platform_fee = EXCLUDED.platform_fee,
        net_payable = EXCLUDED.net_payable,
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
        updated_at = now()
    ;

    RETURN;
END;
$$;
CREATE OR REPLACE FUNCTION public.trigger_booking_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.prepare_settlement_for_booking(NEW.id);
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
       OR NEW.amount_due IS DISTINCT FROM OLD.amount_due
       OR NEW.advance_paid IS DISTINCT FROM OLD.advance_paid
       OR NEW.monthly_rent IS DISTINCT FROM OLD.monthly_rent THEN
        PERFORM public.prepare_settlement_for_booking(NEW.id);
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_settlement_trigger ON public.bookings;
CREATE TRIGGER bookings_settlement_trigger
AFTER INSERT OR UPDATE OF status, payment_status, amount_paid, amount_due, advance_paid, monthly_rent
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trigger_booking_settlement();
GRANT EXECUTE ON FUNCTION public.prepare_settlement_for_booking(UUID) TO authenticated, service_role;
-- Fresh workflow disallows manual settlement actions.
DROP FUNCTION IF EXISTS public.admin_approve_settlement(UUID, UUID);
DROP FUNCTION IF EXISTS public.admin_mark_settlement_paid(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_mark_settlement_failed(UUID, TEXT, UUID);
-- Refresh pending settlements from current approved/active bookings.
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
