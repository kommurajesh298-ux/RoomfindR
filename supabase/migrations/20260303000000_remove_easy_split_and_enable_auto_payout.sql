BEGIN;
-- Remove Easy Split artifacts and enforce webhook-driven payout traceability.
DROP TABLE IF EXISTS public.settlements CASCADE;
DROP TABLE IF EXISTS public.vendors CASCADE;
ALTER TABLE IF EXISTS public.orders
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS split_amount,
  DROP COLUMN IF EXISTS settlement_status;
ALTER TABLE IF EXISTS public.bookings
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS split_amount,
  DROP COLUMN IF EXISTS settlement_status;
ALTER TABLE IF EXISTS public.payouts
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS split_amount,
  DROP COLUMN IF EXISTS settlement_status;
ALTER TABLE IF EXISTS public.transactions
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS split_amount,
  DROP COLUMN IF EXISTS settlement_status;
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS cashfree_order_id text,
  ADD COLUMN IF NOT EXISTS cf_payment_id text,
  ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_status text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
DO $$
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    ALTER TABLE public.transactions
      DROP CONSTRAINT IF EXISTS transactions_payout_status_check;
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_payout_status_check
      CHECK (payout_status IS NULL OR payout_status IN ('pending', 'initiated', 'success', 'failed'));
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_key_uk
  ON public.transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_cf_payment_id_uk
  ON public.transactions(cf_payment_id)
  WHERE cf_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_payout_status_idx
  ON public.transactions(payout_status, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_payout_id_idx
  ON public.transactions(payout_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT FALSE,
  processed boolean NOT NULL DEFAULT FALSE,
  cashfree_order_id text,
  cf_payment_id text,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL,
  payout_status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  processed_at timestamptz,
  UNIQUE (source, event_id)
);
ALTER TABLE IF EXISTS public.webhook_logs
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS split_amount,
  DROP COLUMN IF EXISTS settlement_status,
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_status text;
CREATE INDEX IF NOT EXISTS webhook_logs_source_created_idx
  ON public.webhook_logs(source, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_logs_payout_status_idx
  ON public.webhook_logs(payout_status, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_logs_payout_id_idx
  ON public.webhook_logs(payout_id, created_at DESC);
DO $$
BEGIN
  IF to_regclass('public.cashfree_webhook_events') IS NOT NULL THEN
    ALTER TABLE public.cashfree_webhook_events
      DROP CONSTRAINT IF EXISTS cashfree_webhook_events_source_check;
    UPDATE public.cashfree_webhook_events
    SET source = 'payouts'
    WHERE source = 'settlements';
    ALTER TABLE public.cashfree_webhook_events
      ADD CONSTRAINT cashfree_webhook_events_source_check
      CHECK (source IN ('payments', 'payouts'));
  END IF;
END
$$;
ALTER TABLE IF EXISTS public.webhook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_logs_admin_select ON public.webhook_logs;
CREATE POLICY webhook_logs_admin_select
ON public.webhook_logs
FOR SELECT
TO authenticated
USING (public.cashfree_is_admin(auth.uid()));
GRANT SELECT ON public.webhook_logs TO authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payouts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_logs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
ALTER TABLE IF EXISTS public.transactions REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.payouts REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.webhook_logs REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
