SET search_path = public;
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id UUID,
  amount NUMERIC(10, 2) NOT NULL,
  payment_date TIMESTAMPTZ DEFAULT now(),
  payment_type TEXT CHECK (payment_type IN ('advance', 'monthly', 'refund', 'deposit', 'booking', 'full')),
  payment_method TEXT,
  currency TEXT DEFAULT 'INR',
  provider TEXT DEFAULT 'cashfree',
  provider_order_id TEXT,
  provider_payment_id TEXT,
  provider_session_id TEXT,
  provider_reference TEXT,
  gateway_reference TEXT,
  idempotency_key TEXT,
  failure_reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('created', 'pending', 'authorized', 'success', 'completed', 'failed', 'cancelled', 'refunded')),
  payment_status TEXT,
  verified_at TIMESTAMPTZ,
  webhook_received BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_id UUID,
  ADD COLUMN IF NOT EXISTS booking_id UUID,
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_session_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS gateway_reference TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_received BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_payment_id_fkey'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_payment_id_fkey
      FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
  END IF;
END;
$$;
ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_session_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT,
  ADD COLUMN IF NOT EXISTS upi_app TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;
UPDATE public.payment_attempts
SET
  provider = COALESCE(provider, 'cashfree'),
  provider_order_id = COALESCE(provider_order_id, gateway_order_id),
  provider_payment_id = COALESCE(provider_payment_id, gateway_payment_id),
  provider_session_id = COALESCE(provider_session_id, gateway_payment_session_id),
  provider_event_id = COALESCE(provider_event_id, webhook_event_id),
  failure_reason = COALESCE(failure_reason, failure_message),
  raw_payload = COALESCE(raw_payload, gateway_payload)
WHERE
  provider IS NULL
  OR provider_order_id IS NULL
  OR provider_payment_id IS NULL
  OR provider_session_id IS NULL
  OR provider_event_id IS NULL
  OR failure_reason IS NULL
  OR raw_payload IS NULL;
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_status TEXT,
  ADD COLUMN IF NOT EXISTS initiated_by TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS provider_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS refund_id TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
UPDATE public.refunds r
SET
  payment_id = COALESCE(r.payment_id, pa.payment_id),
  booking_id = COALESCE(r.booking_id, pa.booking_id)
FROM public.payment_attempts pa
WHERE r.payment_attempt_id = pa.id
  AND (r.payment_id IS NULL OR r.booking_id IS NULL);
UPDATE public.refunds r
SET customer_id = COALESCE(r.customer_id, b.customer_id)
FROM public.bookings b
WHERE r.booking_id = b.id
  AND r.customer_id IS NULL;
UPDATE public.refunds
SET
  refund_amount = COALESCE(refund_amount, amount),
  refund_status = COALESCE(refund_status, UPPER(status::text)),
  initiated_by = COALESCE(initiated_by, requested_by::text),
  provider = COALESCE(provider, 'cashfree'),
  provider_refund_id = COALESCE(provider_refund_id, gateway_refund_id),
  refund_id = COALESCE(refund_id, gateway_refund_id)
WHERE
  refund_amount IS NULL
  OR refund_status IS NULL
  OR initiated_by IS NULL
  OR provider IS NULL
  OR provider_refund_id IS NULL
  OR refund_id IS NULL;
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS week_start_date DATE,
  ADD COLUMN IF NOT EXISTS week_end_date DATE,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_payable NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cashfree',
  ADD COLUMN IF NOT EXISTS provider_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
UPDATE public.settlements s
SET
  week_start_date = COALESCE(s.week_start_date, b.start_date, CURRENT_DATE),
  week_end_date = COALESCE(s.week_end_date, b.end_date, b.start_date, CURRENT_DATE),
  total_amount = COALESCE(NULLIF(s.total_amount, 0), s.amount, 0),
  net_payable = COALESCE(NULLIF(s.net_payable, 0), s.amount, 0),
  provider = COALESCE(s.provider, 'cashfree'),
  provider_transfer_id = COALESCE(s.provider_transfer_id, s.transfer_id),
  provider_reference = COALESCE(s.provider_reference, s.cashfree_payout_id)
FROM public.bookings b
WHERE s.booking_id = b.id;
UPDATE public.settlements
SET
  week_start_date = COALESCE(week_start_date, CURRENT_DATE),
  week_end_date = COALESCE(week_end_date, CURRENT_DATE),
  total_amount = COALESCE(total_amount, amount, 0),
  net_payable = COALESCE(net_payable, amount, 0),
  provider = COALESCE(provider, 'cashfree'),
  provider_transfer_id = COALESCE(provider_transfer_id, transfer_id),
  provider_reference = COALESCE(provider_reference, cashfree_payout_id)
WHERE
  week_start_date IS NULL
  OR week_end_date IS NULL
  OR total_amount IS NULL
  OR net_payable IS NULL
  OR provider IS NULL
  OR provider_transfer_id IS NULL
  OR provider_reference IS NULL;
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  available_balance NUMERIC(10, 2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(10, 2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_owner_wallet UNIQUE (owner_id)
);
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  settlement_id UUID REFERENCES public.settlements(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT DEFAULT 'INR',
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_order_id ON public.payments(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON public.payments(provider_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key ON public.payments(idempotency_key)
WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_id ON public.payment_attempts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_booking_id ON public.payment_attempts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON public.payment_attempts(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_new_event ON public.payment_attempts(provider_event_id)
WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_booking_id_new ON public.refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id_new ON public.refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_customer_id_new ON public.refunds(customer_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status_new ON public.refunds(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_provider_refund_id_new ON public.refunds(provider_refund_id)
WHERE provider_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_booking_id_new ON public.settlements(booking_id);
CREATE INDEX IF NOT EXISTS idx_settlements_owner_id_new ON public.settlements(owner_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status_new ON public.settlements(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_provider_transfer_id_new ON public.settlements(provider_transfer_id)
WHERE provider_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallets_owner_id ON public.wallets(owner_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON public.wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_settlement_id ON public.wallet_transactions(settlement_id);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_related_select ON public.payments;
CREATE POLICY payments_related_select
ON public.payments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = payments.booking_id
      AND (
        b.customer_id = auth.uid()
        OR b.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.accounts a
          WHERE a.id = auth.uid() AND a.role = 'admin'
        )
      )
  )
);
DROP POLICY IF EXISTS payments_related_insert ON public.payments;
CREATE POLICY payments_related_insert
ON public.payments
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = payments.booking_id
      AND (
        b.customer_id = auth.uid()
        OR b.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.accounts a
          WHERE a.id = auth.uid() AND a.role = 'admin'
        )
      )
  )
);
DROP POLICY IF EXISTS admin_payments_all ON public.payments;
CREATE POLICY admin_payments_all
ON public.payments
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = auth.uid() AND a.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = auth.uid() AND a.role = 'admin'
  )
);
DROP POLICY IF EXISTS wallets_owner_select ON public.wallets;
CREATE POLICY wallets_owner_select
ON public.wallets
FOR SELECT
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = auth.uid() AND a.role = 'admin'
  )
);
DROP POLICY IF EXISTS admin_wallets_all ON public.wallets;
CREATE POLICY admin_wallets_all
ON public.wallets
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = auth.uid() AND a.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = auth.uid() AND a.role = 'admin'
  )
);
DROP POLICY IF EXISTS wallet_transactions_related_select ON public.wallet_transactions;
CREATE POLICY wallet_transactions_related_select
ON public.wallet_transactions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.wallets w
    WHERE w.id = wallet_transactions.wallet_id
      AND (
        w.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.accounts a
          WHERE a.id = auth.uid() AND a.role = 'admin'
        )
      )
  )
);
DROP POLICY IF EXISTS admin_wallet_transactions_all ON public.wallet_transactions;
CREATE POLICY admin_wallet_transactions_all
ON public.wallet_transactions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = auth.uid() AND a.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = auth.uid() AND a.role = 'admin'
  )
);
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.wallets REPLICA IDENTITY FULL;
ALTER TABLE public.wallet_transactions REPLICA IDENTITY FULL;
DO $$
BEGIN
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
      AND tablename = 'wallets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wallet_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
  END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
