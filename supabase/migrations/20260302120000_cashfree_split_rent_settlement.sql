BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
BEGIN
  IF to_regprocedure('public.cashfree_set_updated_at()') IS NULL THEN
    CREATE OR REPLACE FUNCTION public.cashfree_set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END
$$;
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id text NOT NULL,
  kyc_status text NOT NULL DEFAULT 'pending' CHECK (
    kyc_status IN ('pending', 'verified', 'failed', 'suspended')
  ),
  is_active boolean NOT NULL DEFAULT TRUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id),
  UNIQUE (vendor_id)
);
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_attempt_id uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  charge_type text NOT NULL DEFAULT 'advance',
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'INR',
  cashfree_order_id text,
  cf_payment_id text,
  vendor_id text,
  split_amount numeric(12, 2),
  settlement_status text NOT NULL DEFAULT 'not_applicable' CHECK (
    settlement_status IN ('not_applicable', 'pending', 'settled', 'failed')
  ),
  trace_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (payment_attempt_id)
);
CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  vendor_id text,
  cashfree_order_id text,
  cf_payment_id text,
  split_amount numeric(12, 2) NOT NULL CHECK (split_amount > 0),
  settlement_cycle_start date,
  settlement_cycle_end date,
  settlement_status text NOT NULL DEFAULT 'pending' CHECK (
    settlement_status IN ('pending', 'settled', 'failed')
  ),
  cashfree_settlement_id text,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT FALSE,
  processed boolean NOT NULL DEFAULT FALSE,
  cashfree_order_id text,
  cf_payment_id text,
  vendor_id text,
  split_amount numeric(12, 2),
  settlement_status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  processed_at timestamptz,
  UNIQUE (source, event_id)
);
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS booking_id uuid,
  ADD COLUMN IF NOT EXISTS order_type text DEFAULT 'advance',
  ADD COLUMN IF NOT EXISTS vendor_id text,
  ADD COLUMN IF NOT EXISTS split_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS cashfree_order_id text,
  ADD COLUMN IF NOT EXISTS cf_payment_id text,
  ADD COLUMN IF NOT EXISTS settlement_status text DEFAULT 'not_applicable';
ALTER TABLE IF EXISTS public.bookings
  ADD COLUMN IF NOT EXISTS cashfree_order_id text,
  ADD COLUMN IF NOT EXISTS cf_payment_id text,
  ADD COLUMN IF NOT EXISTS vendor_id text,
  ADD COLUMN IF NOT EXISTS split_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS settlement_status text;
ALTER TABLE IF EXISTS public.payouts
  ADD COLUMN IF NOT EXISTS booking_id uuid,
  ADD COLUMN IF NOT EXISTS cashfree_order_id text,
  ADD COLUMN IF NOT EXISTS cf_payment_id text,
  ADD COLUMN IF NOT EXISTS vendor_id text,
  ADD COLUMN IF NOT EXISTS split_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS settlement_status text;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_payment_attempt_uk
  ON public.transactions(payment_attempt_id);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_cf_payment_id_uk
  ON public.transactions(cf_payment_id)
  WHERE cf_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_order_idx
  ON public.transactions(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_owner_idx
  ON public.transactions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_customer_idx
  ON public.transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_settlement_status_idx
  ON public.transactions(settlement_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS settlements_transaction_vendor_uk
  ON public.settlements(transaction_id, COALESCE(vendor_id, ''));
CREATE UNIQUE INDEX IF NOT EXISTS settlements_cashfree_settlement_id_uk
  ON public.settlements(cashfree_settlement_id)
  WHERE cashfree_settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS settlements_status_idx
  ON public.settlements(settlement_status, created_at DESC);
CREATE INDEX IF NOT EXISTS settlements_owner_idx
  ON public.settlements(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS settlements_order_idx
  ON public.settlements(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_logs_source_created_idx
  ON public.webhook_logs(source, created_at DESC);
DROP TRIGGER IF EXISTS vendors_updated_at_trg ON public.vendors;
CREATE TRIGGER vendors_updated_at_trg
BEFORE UPDATE ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_set_updated_at();
DROP TRIGGER IF EXISTS transactions_updated_at_trg ON public.transactions;
CREATE TRIGGER transactions_updated_at_trg
BEFORE UPDATE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_set_updated_at();
DROP TRIGGER IF EXISTS settlements_updated_at_trg ON public.settlements;
CREATE TRIGGER settlements_updated_at_trg
BEFORE UPDATE ON public.settlements
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_set_updated_at();
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendors_owner_admin_all ON public.vendors;
CREATE POLICY vendors_owner_admin_all
ON public.vendors
FOR ALL
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
)
WITH CHECK (
  owner_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
);
DROP POLICY IF EXISTS transactions_customer_owner_admin_select ON public.transactions;
CREATE POLICY transactions_customer_owner_admin_select
ON public.transactions
FOR SELECT
TO authenticated
USING (
  customer_id = auth.uid()
  OR owner_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
);
DROP POLICY IF EXISTS settlements_customer_owner_admin_select ON public.settlements;
CREATE POLICY settlements_customer_owner_admin_select
ON public.settlements
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.id = settlements.transaction_id
      AND t.customer_id = auth.uid()
  )
);
DROP POLICY IF EXISTS webhook_logs_admin_select ON public.webhook_logs;
CREATE POLICY webhook_logs_admin_select
ON public.webhook_logs
FOR SELECT
TO authenticated
USING (public.cashfree_is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.vendors TO authenticated;
GRANT SELECT ON public.transactions TO authenticated;
GRANT SELECT ON public.settlements TO authenticated;
GRANT SELECT ON public.webhook_logs TO authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.vendors;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.settlements;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_logs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;
ALTER TABLE public.vendors REPLICA IDENTITY FULL;
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.settlements REPLICA IDENTITY FULL;
ALTER TABLE public.webhook_logs REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
