-- Fresh payment architecture reset: remove legacy refund/settlement/commission automation
-- and establish strict advance + rent flows.

BEGIN;
-- Disable legacy automation cron jobs (if pg_cron is installed).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        BEGIN
            PERFORM cron.unschedule(jobid)
            FROM cron.job
            WHERE lower(jobname) LIKE '%refund%'
               OR lower(jobname) LIKE '%settlement%'
               OR lower(jobname) LIKE '%payout%'
               OR lower(jobname) LIKE 'cashfree-%';
        EXCEPTION
            WHEN undefined_table THEN
                NULL;
        END;
    END IF;
END $$;
-- Drop legacy payment/settlement/refund/payout/commission SQL functions.
DO $$
DECLARE
    fn regprocedure;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n
          ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (
              p.proname ILIKE '%refund%'
              OR p.proname ILIKE '%settlement%'
              OR p.proname ILIKE '%payout%'
              OR p.proname ILIKE '%commission%'
              OR p.proname IN (
                  'record_monthly_payment',
                  'rent_payments_refresh_summary',
                  'sync_processing_settlements',
                  'run_cashfree_settlement_automation'
              )
          )
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', fn);
    END LOOP;
END $$;
-- Remove legacy payment-adjacent tables.
DROP TABLE IF EXISTS public.refunds CASCADE;
DROP TABLE IF EXISTS public.settlements CASCADE;
DROP TABLE IF EXISTS public.rent_payments CASCADE;
DROP TABLE IF EXISTS public.commission_records CASCADE;
DROP TABLE IF EXISTS public.payouts CASCADE;
DROP TABLE IF EXISTS public.owner_monthly_summary CASCADE;
DROP TABLE IF EXISTS public.payment_attempts CASCADE;
-- Keep booking domain intact; add alignment columns for fresh flow.
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS booking_status TEXT,
    ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS settlement_status TEXT;
UPDATE public.bookings
SET booking_status = COALESCE(NULLIF(trim(booking_status), ''), status::text, 'requested');
UPDATE public.bookings
SET advance_amount = COALESCE(advance_amount, advance_paid, amount_due, 0);
UPDATE public.bookings
SET settlement_status = COALESCE(NULLIF(trim(settlement_status), ''), 'not_eligible');
ALTER TABLE public.bookings
    ALTER COLUMN booking_status SET DEFAULT 'requested',
    ALTER COLUMN booking_status SET NOT NULL,
    ALTER COLUMN settlement_status SET DEFAULT 'not_eligible',
    ALTER COLUMN settlement_status SET NOT NULL;
DROP INDEX IF EXISTS idx_bookings_booking_status;
CREATE INDEX IF NOT EXISTS idx_bookings_booking_status ON public.bookings(booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_settlement_status ON public.bookings(settlement_status);
-- Recreate payments table with strict advance/rent architecture.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_id_fkey;
DROP TABLE IF EXISTS public.payments CASCADE;
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    payment_type TEXT NOT NULL CHECK (payment_type IN ('advance', 'rent')),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    settlement_status TEXT NOT NULL DEFAULT 'not_eligible'
        CHECK (settlement_status IN ('not_eligible', 'eligible_for_admin_review', 'settled', 'failed')),
    payout_status TEXT
        CHECK (payout_status IS NULL OR payout_status IN ('pending', 'processing', 'success', 'failed')),
    cashfree_order_id TEXT,
    cashfree_payout_id TEXT,
    payout_reference_id TEXT,
    destination TEXT NOT NULL DEFAULT 'admin_account'
        CHECK (destination IN ('admin_account', 'owner_direct')),
    rent_commission NUMERIC(10, 2) NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'cashfree',
    provider_order_id TEXT,
    provider_payment_id TEXT,
    provider_reference TEXT,
    provider_session_id TEXT,
    payment_method TEXT,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT payments_status_sync CHECK (lower(status) = lower(payment_status)),
    CONSTRAINT payments_destination_rules CHECK (
        (payment_type = 'advance' AND destination = 'admin_account')
        OR (payment_type = 'rent' AND destination = 'owner_direct' AND rent_commission = 0)
    )
);
-- Existing booking.payment_id values point to dropped legacy payments.
UPDATE public.bookings
SET payment_id = NULL
WHERE payment_id IS NOT NULL;
ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_payment_id_fkey
    FOREIGN KEY (payment_id)
    REFERENCES public.payments(id)
    ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_type_status ON public.payments(payment_type, status);
CREATE INDEX IF NOT EXISTS idx_payments_settlement_status ON public.payments(settlement_status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_cashfree_order_unique ON public.payments(cashfree_order_id) WHERE cashfree_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_cashfree_payout_unique ON public.payments(cashfree_payout_id) WHERE cashfree_payout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_order_unique ON public.payments(provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_unique ON public.payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sync_payment_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF coalesce(NEW.status, '') = '' THEN
        NEW.status := coalesce(NEW.payment_status, 'pending');
    END IF;

    IF coalesce(NEW.payment_status, '') = '' THEN
        NEW.payment_status := coalesce(NEW.status, 'pending');
    END IF;

    NEW.status := lower(NEW.status);
    NEW.payment_status := lower(NEW.payment_status);

    IF NEW.provider_order_id IS NULL THEN
        NEW.provider_order_id := NEW.cashfree_order_id;
    END IF;

    IF NEW.cashfree_order_id IS NULL THEN
        NEW.cashfree_order_id := NEW.provider_order_id;
    END IF;

    IF NEW.provider_reference IS NULL THEN
        NEW.provider_reference := NEW.cashfree_payout_id;
    END IF;

    IF NEW.cashfree_payout_id IS NULL THEN
        NEW.cashfree_payout_id := NEW.provider_reference;
    END IF;

    IF NEW.payout_status IS NOT NULL THEN
        NEW.payout_status := lower(NEW.payout_status);
    END IF;

    NEW.updated_at := timezone('utc', now());
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payments_sync_columns ON public.payments;
CREATE TRIGGER trg_payments_sync_columns
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.sync_payment_columns();
DROP TRIGGER IF EXISTS update_payments_updated_at ON public.payments;
CREATE TRIGGER update_payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_bookings_updated_at ON public.bookings;
CREATE TRIGGER update_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- Owner acceptance helper: confirm booking and mark advance settlement eligible.
CREATE OR REPLACE FUNCTION public.owner_accept_booking_v2(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_booking public.bookings%ROWTYPE;
BEGIN
    SELECT *
      INTO v_booking
      FROM public.bookings
     WHERE id = p_booking_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;

    IF v_booking.owner_id IS DISTINCT FROM v_actor
       AND NOT public.is_admin(v_actor) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF lower(coalesce(v_booking.booking_status, v_booking.status::text, '')) = 'rejected' THEN
        RAISE EXCEPTION 'BOOKING_REJECTED';
    END IF;

    UPDATE public.bookings
       SET status = 'confirmed',
           booking_status = 'confirmed',
           settlement_status = 'eligible_for_admin_review',
           updated_at = timezone('utc', now())
     WHERE id = p_booking_id;

    UPDATE public.payments
       SET settlement_status = 'eligible_for_admin_review',
           updated_at = timezone('utc', now())
     WHERE booking_id = p_booking_id
       AND payment_type = 'advance'
       AND status IN ('paid_pending_owner_acceptance', 'paid', 'completed', 'success');

    RETURN (
        SELECT b
          FROM public.bookings b
         WHERE b.id = p_booking_id
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.owner_accept_booking_v2(UUID) TO authenticated;
-- Admin helper: reserve payment for payout to avoid duplicate triggers.
CREATE OR REPLACE FUNCTION public.reserve_advance_payout(p_payment_id UUID)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin UUID := auth.uid();
    v_payment public.payments%ROWTYPE;
BEGIN
    IF v_admin IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;

    IF NOT public.is_admin(v_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    UPDATE public.payments
       SET payout_status = 'processing',
           updated_at = timezone('utc', now())
     WHERE id = p_payment_id
       AND payment_type = 'advance'
       AND settlement_status = 'eligible_for_admin_review'
       AND coalesce(payout_status, 'pending') NOT IN ('processing', 'success')
     RETURNING * INTO v_payment;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_ELIGIBLE_FOR_PAYOUT';
    END IF;

    RETURN v_payment;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_advance_payout(UUID) TO authenticated;
-- Admin helper: apply payout result and finalize settlement status.
CREATE OR REPLACE FUNCTION public.apply_advance_payout_result(
    p_payment_id UUID,
    p_cashfree_payout_id TEXT,
    p_payout_reference_id TEXT,
    p_payout_status TEXT,
    p_failure_reason TEXT DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin UUID := auth.uid();
    v_status TEXT := lower(coalesce(p_payout_status, 'failed'));
    v_payment public.payments%ROWTYPE;
BEGIN
    IF v_admin IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;

    IF NOT public.is_admin(v_admin) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_status NOT IN ('success', 'failed', 'processing') THEN
        RAISE EXCEPTION 'INVALID_PAYOUT_STATUS';
    END IF;

    UPDATE public.payments
       SET cashfree_payout_id = coalesce(p_cashfree_payout_id, cashfree_payout_id),
           payout_reference_id = coalesce(p_payout_reference_id, payout_reference_id),
           provider_reference = coalesce(p_payout_reference_id, provider_reference),
           payout_status = v_status,
           settlement_status = CASE
               WHEN v_status = 'success' THEN 'settled'
               WHEN v_status = 'failed' THEN 'failed'
               ELSE settlement_status
           END,
           failure_reason = CASE
               WHEN v_status = 'failed' THEN coalesce(p_failure_reason, 'Payout failed')
               ELSE NULL
           END,
           updated_at = timezone('utc', now())
     WHERE id = p_payment_id
       AND payment_type = 'advance'
     RETURNING * INTO v_payment;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
    END IF;

    IF v_status = 'success' THEN
        UPDATE public.bookings
           SET settlement_status = 'settled',
               updated_at = timezone('utc', now())
         WHERE id = v_payment.booking_id;
    ELSIF v_status = 'failed' THEN
        UPDATE public.bookings
           SET settlement_status = 'eligible_for_admin_review',
               updated_at = timezone('utc', now())
         WHERE id = v_payment.booking_id;
    END IF;

    RETURN v_payment;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_advance_payout_result(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
-- Keep payment settlement eligibility synchronized with booking status transitions.
CREATE OR REPLACE FUNCTION public.sync_booking_payment_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_status TEXT := lower(coalesce(NEW.booking_status, NEW.status::text, ''));
    v_old_status TEXT := lower(coalesce(OLD.booking_status, OLD.status::text, ''));
BEGIN
    IF v_new_status = v_old_status THEN
        RETURN NEW;
    END IF;

    IF v_new_status = 'confirmed' THEN
        UPDATE public.payments
           SET settlement_status = 'eligible_for_admin_review',
               updated_at = timezone('utc', now())
         WHERE booking_id = NEW.id
           AND payment_type = 'advance'
           AND status IN ('paid_pending_owner_acceptance', 'paid', 'completed', 'success');
    ELSIF v_new_status IN ('rejected', 'cancelled', 'cancelled_by_customer') THEN
        UPDATE public.payments
           SET settlement_status = 'not_eligible',
               updated_at = timezone('utc', now())
         WHERE booking_id = NEW.id
           AND payment_type = 'advance'
           AND settlement_status <> 'settled';
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_booking_payment_state ON public.bookings;
CREATE TRIGGER trg_sync_booking_payment_state
AFTER UPDATE OF status, booking_status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_booking_payment_state();
-- Realtime propagation.
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1
              FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = 'payments'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = 'bookings'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
        END IF;
    END IF;
END $$;
-- RLS for fresh payments table.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_select ON public.payments;
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payments_update ON public.payments;
DROP POLICY IF EXISTS payments_delete ON public.payments;
DROP POLICY IF EXISTS admin_payments_all ON public.payments;
CREATE POLICY payments_select
ON public.payments
FOR SELECT
USING (
    public.is_admin(auth.uid())
    OR EXISTS (
        SELECT 1
          FROM public.bookings b
         WHERE b.id = payments.booking_id
           AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid())
    )
);
CREATE POLICY payments_insert_customer
ON public.payments
FOR INSERT
WITH CHECK (
    public.is_admin(auth.uid())
    OR EXISTS (
        SELECT 1
          FROM public.bookings b
         WHERE b.id = payments.booking_id
           AND b.customer_id = auth.uid()
    )
);
CREATE POLICY payments_update_admin_or_customer
ON public.payments
FOR UPDATE
USING (
    public.is_admin(auth.uid())
    OR EXISTS (
        SELECT 1
          FROM public.bookings b
         WHERE b.id = payments.booking_id
           AND b.customer_id = auth.uid()
    )
)
WITH CHECK (
    public.is_admin(auth.uid())
    OR EXISTS (
        SELECT 1
          FROM public.bookings b
         WHERE b.id = payments.booking_id
           AND b.customer_id = auth.uid()
    )
);
COMMIT;
