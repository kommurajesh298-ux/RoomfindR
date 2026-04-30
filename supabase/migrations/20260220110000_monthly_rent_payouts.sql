BEGIN;
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS payout_status TEXT,
    ADD COLUMN IF NOT EXISTS payout_reference_id TEXT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_payout_status_check'
          AND conrelid = 'public.payments'::regclass
    ) THEN
        ALTER TABLE public.payments
            ADD CONSTRAINT payments_payout_status_check
            CHECK (
                payout_status IS NULL
                OR upper(payout_status) IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')
            );
    END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_payments_payout_status ON public.payments(payout_status);
CREATE INDEX IF NOT EXISTS idx_payments_payout_reference_id
    ON public.payments(payout_reference_id)
    WHERE payout_reference_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.payouts (
    payout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    month_token TEXT NOT NULL,
    transfer_id TEXT,
    cashfree_reference_id TEXT,
    transfer_mode TEXT NOT NULL DEFAULT 'IMPS',
    status TEXT NOT NULL DEFAULT 'PENDING',
    payout_attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    failure_reason TEXT,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT payouts_month_token_format CHECK (month_token ~ '^[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT payouts_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_booking_month_unique
    ON public.payouts(booking_id, month_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_payment_unique
    ON public.payouts(payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_transfer_unique
    ON public.payouts(transfer_id)
    WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_idempotency_unique
    ON public.payouts(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payouts_owner_status ON public.payouts(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_payouts_retry ON public.payouts(status, next_retry_at);
DROP TRIGGER IF EXISTS update_payouts_updated_at ON public.payouts;
CREATE TRIGGER update_payouts_updated_at
    BEFORE UPDATE ON public.payouts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_payouts_all ON public.payouts;
CREATE POLICY admin_payouts_all ON public.payouts
    FOR ALL
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS owner_payouts_select ON public.payouts;
CREATE POLICY owner_payouts_select ON public.payouts
    FOR SELECT
    USING (owner_id = auth.uid() OR public.is_admin(auth.uid()));
ALTER TABLE public.payouts REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_publication p ON p.oid = pr.prpubid
        WHERE p.pubname = 'supabase_realtime'
          AND c.relname = 'payouts'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.payouts';
    END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE OR REPLACE FUNCTION public.run_monthly_payout_retry()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL
       OR service_key IS NULL
       OR supabase_url LIKE 'REPLACE_WITH_%'
       OR service_key LIKE 'REPLACE_WITH_%' THEN
        RAISE NOTICE 'Missing supabase_url or service key for monthly payout retry';
        RETURN;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/cashfree-monthly-payout',
        headers := headers,
        body := jsonb_build_object(
            'action', 'retry_failed',
            'limit', 100
        )
    );
END;
$$;
DO $$
DECLARE
    job_id INT;
BEGIN
    SELECT jobid INTO job_id
    FROM cron.job
    WHERE jobname = 'cashfree-monthly-payout-retry';

    IF job_id IS NOT NULL THEN
        PERFORM cron.unschedule(job_id);
    END IF;

    PERFORM cron.schedule(
        'cashfree-monthly-payout-retry',
        '*/5 * * * *',
        'SELECT public.run_monthly_payout_retry();'
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_monthly_payout_retry() TO service_role;
COMMIT;
