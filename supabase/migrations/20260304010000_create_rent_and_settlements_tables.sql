BEGIN;
-- Rent rows (derived from rent-like transactions).
CREATE TABLE IF NOT EXISTS public.rent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  owner_id uuid,
  customer_id uuid,
  order_id uuid,
  payment_attempt_id uuid,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending',
  payout_status text NOT NULL DEFAULT 'pending',
  settlement_status text NOT NULL DEFAULT 'pending',
  cashfree_order_id text,
  cf_payment_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE IF EXISTS public.rent
  ADD COLUMN IF NOT EXISTS transaction_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS payment_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cashfree_order_id text,
  ADD COLUMN IF NOT EXISTS cf_payment_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rent_payment_status_check'
      AND conrelid = 'public.rent'::regclass
  ) THEN
    ALTER TABLE public.rent
      ADD CONSTRAINT rent_payment_status_check
      CHECK (lower(payment_status) IN ('pending', 'success', 'failed', 'refunded', 'paid'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rent_payout_status_check'
      AND conrelid = 'public.rent'::regclass
  ) THEN
    ALTER TABLE public.rent
      ADD CONSTRAINT rent_payout_status_check
      CHECK (lower(payout_status) IN ('pending', 'initiated', 'processing', 'success', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rent_settlement_status_check'
      AND conrelid = 'public.rent'::regclass
  ) THEN
    ALTER TABLE public.rent
      ADD CONSTRAINT rent_settlement_status_check
      CHECK (lower(settlement_status) IN ('pending', 'initiated', 'processing', 'completed', 'success', 'failed', 'refunded'));
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS rent_transaction_id_uk
  ON public.rent(transaction_id);
CREATE INDEX IF NOT EXISTS rent_owner_created_idx
  ON public.rent(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rent_booking_created_idx
  ON public.rent(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rent_payment_status_idx
  ON public.rent(payment_status, payout_status, settlement_status);
-- Backfill rent from live transactions.
INSERT INTO public.rent (
  transaction_id,
  booking_id,
  owner_id,
  customer_id,
  order_id,
  payment_attempt_id,
  amount,
  payment_status,
  payout_status,
  settlement_status,
  cashfree_order_id,
  cf_payment_id,
  metadata,
  created_at,
  updated_at
)
SELECT
  t.id,
  t.booking_id,
  t.owner_id,
  t.customer_id,
  t.order_id,
  t.payment_attempt_id,
  COALESCE(t.amount, 0),
  CASE
    WHEN COALESCE(t.cf_payment_id, '') <> '' THEN 'success'
    ELSE 'pending'
  END AS payment_status,
  COALESCE(NULLIF(lower(trim(p.payout_status)), ''), NULLIF(lower(trim(p.status)), ''), 'pending') AS payout_status,
  CASE
    WHEN COALESCE(NULLIF(lower(trim(p.payout_status)), ''), NULLIF(lower(trim(p.status)), '')) IN ('success') THEN 'completed'
    WHEN COALESCE(NULLIF(lower(trim(p.payout_status)), ''), NULLIF(lower(trim(p.status)), '')) IN ('failed') THEN 'failed'
    ELSE 'pending'
  END AS settlement_status,
  t.cashfree_order_id,
  t.cf_payment_id,
  jsonb_build_object(
    'source', 'transactions_backfill',
    'charge_type', t.charge_type
  ) AS metadata,
  COALESCE(t.created_at, now()),
  COALESCE(t.updated_at, now())
FROM public.transactions t
LEFT JOIN public.payouts p
  ON p.id = t.payout_id
WHERE lower(COALESCE(t.charge_type, '')) IN ('rent', 'monthly', 'monthly_rent', 'full')
ON CONFLICT (transaction_id) DO UPDATE
SET
  booking_id = EXCLUDED.booking_id,
  owner_id = EXCLUDED.owner_id,
  customer_id = EXCLUDED.customer_id,
  order_id = EXCLUDED.order_id,
  payment_attempt_id = EXCLUDED.payment_attempt_id,
  amount = EXCLUDED.amount,
  payment_status = EXCLUDED.payment_status,
  payout_status = EXCLUDED.payout_status,
  settlement_status = EXCLUDED.settlement_status,
  cashfree_order_id = EXCLUDED.cashfree_order_id,
  cf_payment_id = EXCLUDED.cf_payment_id,
  metadata = EXCLUDED.metadata,
  updated_at = now();
-- Settlement rows (derived from payout rows).
CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid,
  transaction_id uuid,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  owner_id uuid,
  customer_id uuid,
  order_id uuid,
  payment_attempt_id uuid,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending',
  payout_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'pending',
  cashfree_payout_id text,
  transfer_id text,
  admin_approved boolean NOT NULL DEFAULT false,
  admin_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE IF EXISTS public.settlements
  ADD COLUMN IF NOT EXISTS payout_id uuid,
  ADD COLUMN IF NOT EXISTS transaction_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS payment_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cashfree_payout_id text,
  ADD COLUMN IF NOT EXISTS transfer_id text,
  ADD COLUMN IF NOT EXISTS admin_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settlements_payment_status_check_v2'
      AND conrelid = 'public.settlements'::regclass
  ) THEN
    ALTER TABLE public.settlements
      ADD CONSTRAINT settlements_payment_status_check_v2
      CHECK (lower(payment_status) IN ('pending', 'success', 'failed', 'refunded', 'paid'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settlements_payout_status_check_v2'
      AND conrelid = 'public.settlements'::regclass
  ) THEN
    ALTER TABLE public.settlements
      ADD CONSTRAINT settlements_payout_status_check_v2
      CHECK (lower(payout_status) IN ('pending', 'initiated', 'processing', 'success', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settlements_status_check_v2'
      AND conrelid = 'public.settlements'::regclass
  ) THEN
    ALTER TABLE public.settlements
      ADD CONSTRAINT settlements_status_check_v2
      CHECK (lower(status) IN ('pending', 'initiated', 'processing', 'completed', 'success', 'failed'));
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS settlements_payout_id_uk_v2
  ON public.settlements(payout_id);
CREATE UNIQUE INDEX IF NOT EXISTS settlements_transaction_id_uk_v2
  ON public.settlements(transaction_id);
CREATE INDEX IF NOT EXISTS settlements_owner_created_idx_v2
  ON public.settlements(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS settlements_booking_created_idx_v2
  ON public.settlements(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS settlements_status_idx_v2
  ON public.settlements(payout_status, status);
-- Backfill settlements from payout rows (rent/settlement types).
INSERT INTO public.settlements (
  payout_id,
  transaction_id,
  booking_id,
  owner_id,
  customer_id,
  order_id,
  payment_attempt_id,
  amount,
  payment_status,
  payout_status,
  status,
  cashfree_payout_id,
  transfer_id,
  admin_approved,
  admin_id,
  metadata,
  created_at,
  updated_at
)
SELECT
  p.id,
  t.id AS transaction_id,
  COALESCE(p.booking_id, t.booking_id) AS booking_id,
  COALESCE(p.owner_id, t.owner_id) AS owner_id,
  t.customer_id,
  t.order_id,
  t.payment_attempt_id,
  COALESCE(p.amount, t.amount, 0) AS amount,
  CASE
    WHEN t.id IS NOT NULL THEN 'paid'
    ELSE 'pending'
  END AS payment_status,
  COALESCE(NULLIF(lower(trim(p.payout_status)), ''), NULLIF(lower(trim(p.status)), ''), 'pending') AS payout_status,
  CASE
    WHEN COALESCE(NULLIF(lower(trim(p.payout_status)), ''), NULLIF(lower(trim(p.status)), '')) = 'success' THEN 'completed'
    WHEN COALESCE(NULLIF(lower(trim(p.payout_status)), ''), NULLIF(lower(trim(p.status)), '')) = 'failed' THEN 'failed'
    ELSE 'pending'
  END AS status,
  p.cashfree_payout_id,
  p.transfer_id,
  COALESCE(p.admin_approved, false),
  p.admin_id,
  COALESCE(p.metadata, '{}'::jsonb),
  COALESCE(p.created_at, now()),
  COALESCE(p.updated_at, now())
FROM public.payouts p
LEFT JOIN public.transactions t
  ON (
    p.metadata ? 'transaction_id'
    AND (p.metadata->>'transaction_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND t.id = (p.metadata->>'transaction_id')::uuid
  )
  OR t.payout_id = p.id
WHERE lower(COALESCE(p.type, '')) IN ('settlement', 'rent')
ON CONFLICT (payout_id) DO UPDATE
SET
  transaction_id = EXCLUDED.transaction_id,
  booking_id = EXCLUDED.booking_id,
  owner_id = EXCLUDED.owner_id,
  customer_id = EXCLUDED.customer_id,
  order_id = EXCLUDED.order_id,
  payment_attempt_id = EXCLUDED.payment_attempt_id,
  amount = EXCLUDED.amount,
  payment_status = EXCLUDED.payment_status,
  payout_status = EXCLUDED.payout_status,
  status = EXCLUDED.status,
  cashfree_payout_id = EXCLUDED.cashfree_payout_id,
  transfer_id = EXCLUDED.transfer_id,
  admin_approved = EXCLUDED.admin_approved,
  admin_id = EXCLUDED.admin_id,
  metadata = EXCLUDED.metadata,
  updated_at = now();
ALTER TABLE IF EXISTS public.rent ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rent_select_policy ON public.rent;
CREATE POLICY rent_select_policy ON public.rent
FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR customer_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
);
DROP POLICY IF EXISTS rent_admin_write_policy ON public.rent;
CREATE POLICY rent_admin_write_policy ON public.rent
FOR ALL TO authenticated
USING (public.cashfree_is_admin(auth.uid()))
WITH CHECK (public.cashfree_is_admin(auth.uid()));
DROP POLICY IF EXISTS settlements_select_policy_v2 ON public.settlements;
CREATE POLICY settlements_select_policy_v2 ON public.settlements
FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR customer_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
);
DROP POLICY IF EXISTS settlements_admin_write_policy_v2 ON public.settlements;
CREATE POLICY settlements_admin_write_policy_v2 ON public.settlements
FOR ALL TO authenticated
USING (public.cashfree_is_admin(auth.uid()))
WITH CHECK (public.cashfree_is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlements TO authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rent;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.settlements;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
ALTER TABLE IF EXISTS public.rent REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.settlements REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
