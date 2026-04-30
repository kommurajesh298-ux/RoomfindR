BEGIN;
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  payment_attempt_id uuid,
  booking_id uuid,
  customer_id uuid,
  owner_id uuid,
  charge_type text,
  amount numeric(12, 2),
  currency text NOT NULL DEFAULT 'INR',
  cashfree_order_id text,
  cf_payment_id text,
  payout_id uuid,
  payout_status text,
  idempotency_key text,
  trace_id text,
  paid_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS payment_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid,
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS charge_type text,
  ADD COLUMN IF NOT EXISTS amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS cashfree_order_id text,
  ADD COLUMN IF NOT EXISTS cf_payment_id text,
  ADD COLUMN IF NOT EXISTS payout_id uuid,
  ADD COLUMN IF NOT EXISTS payout_status text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE public.transactions
SET currency = 'INR'
WHERE currency IS NULL;
UPDATE public.transactions
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;
UPDATE public.transactions
SET created_at = NOW()
WHERE created_at IS NULL;
UPDATE public.transactions
SET updated_at = NOW()
WHERE updated_at IS NULL;
ALTER TABLE public.transactions
  ALTER COLUMN currency SET DEFAULT 'INR',
  ALTER COLUMN currency SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;
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
CREATE UNIQUE INDEX IF NOT EXISTS transactions_payment_attempt_id_uk
  ON public.transactions(payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_key_uk
  ON public.transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_cf_payment_id_uk
  ON public.transactions(cf_payment_id)
  WHERE cf_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_order_id_idx
  ON public.transactions(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_booking_id_idx
  ON public.transactions(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_owner_id_idx
  ON public.transactions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_payout_id_idx
  ON public.transactions(payout_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_payout_status_idx
  ON public.transactions(payout_status, created_at DESC);
DO $$
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_order_id_fkey
        FOREIGN KEY (order_id)
        REFERENCES public.orders(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    WHEN OTHERS THEN NULL;
    END;

    BEGIN
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_payment_attempt_id_fkey
        FOREIGN KEY (payment_attempt_id)
        REFERENCES public.payment_attempts(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    WHEN OTHERS THEN NULL;
    END;

    BEGIN
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_booking_id_fkey
        FOREIGN KEY (booking_id)
        REFERENCES public.bookings(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    WHEN OTHERS THEN NULL;
    END;

    BEGIN
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_payout_id_fkey
        FOREIGN KEY (payout_id)
        REFERENCES public.payouts(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    WHEN OTHERS THEN NULL;
    END;
  END IF;
END
$$;
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
  END IF;
END
$$;
ALTER TABLE IF EXISTS public.transactions REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
