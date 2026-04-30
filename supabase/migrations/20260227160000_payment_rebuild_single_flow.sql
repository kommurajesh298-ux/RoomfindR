BEGIN;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS hostel_id UUID,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT;
UPDATE public.payments
SET order_id = COALESCE(
    NULLIF(trim(order_id), ''),
    NULLIF(trim(cashfree_order_id), ''),
    NULLIF(trim(provider_order_id), '')
)
WHERE COALESCE(trim(order_id), '') = '';
UPDATE public.payments p
SET user_id = b.customer_id,
    hostel_id = b.property_id
FROM public.bookings b
WHERE b.id = p.booking_id
  AND (
    p.user_id IS NULL
    OR p.hostel_id IS NULL
  );
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_order_id_not_blank;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_order_id_not_blank
  CHECK (order_id IS NULL OR trim(order_id) <> '');
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_id_unique
  ON public.payments(order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_user_id
  ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_hostel_id
  ON public.payments(hostel_id);
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

    IF coalesce(NEW.refund_status, '') = '' THEN
        NEW.refund_status := 'not_requested';
    END IF;

    NEW.status := lower(NEW.status);
    NEW.payment_status := lower(NEW.payment_status);
    NEW.refund_status := lower(NEW.refund_status);

    IF NEW.order_id IS NULL THEN
        NEW.order_id := coalesce(NEW.cashfree_order_id, NEW.provider_order_id);
    END IF;

    IF NEW.provider_order_id IS NULL THEN
        NEW.provider_order_id := coalesce(NEW.order_id, NEW.cashfree_order_id);
    END IF;

    IF NEW.cashfree_order_id IS NULL THEN
        NEW.cashfree_order_id := coalesce(NEW.order_id, NEW.provider_order_id);
    END IF;

    IF NEW.order_id IS NULL THEN
        NEW.order_id := coalesce(NEW.provider_order_id, NEW.cashfree_order_id);
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

    IF NEW.refund_status = 'success' THEN
        NEW.status := 'refunded';
        NEW.payment_status := 'refunded';
        IF NEW.refunded_at IS NULL THEN
            NEW.refunded_at := timezone('utc', now());
        END IF;
    END IF;

    IF NEW.status = 'refunded' THEN
        NEW.refund_status := 'success';
        IF NEW.refunded_at IS NULL THEN
            NEW.refunded_at := timezone('utc', now());
        END IF;
    END IF;

    NEW.updated_at := timezone('utc', now());
    RETURN NEW;
END;
$$;
CREATE TABLE IF NOT EXISTS public.rent_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    month TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
    due_amount NUMERIC(10,2) NOT NULL CHECK (due_amount >= 0),
    paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'partial', 'paid', 'failed', 'overdue', 'terminated')
    ),
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_ledger_booking_month_unique
  ON public.rent_ledger(booking_id, month);
CREATE INDEX IF NOT EXISTS idx_rent_ledger_status
  ON public.rent_ledger(status);
CREATE INDEX IF NOT EXISTS idx_rent_ledger_payment_id
  ON public.rent_ledger(payment_id);
DROP TRIGGER IF EXISTS update_rent_ledger_updated_at ON public.rent_ledger;
CREATE TRIGGER update_rent_ledger_updated_at
BEFORE UPDATE ON public.rent_ledger
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
WITH rent_rows AS (
    SELECT
        p.id AS payment_id,
        p.booking_id,
        COALESCE(
            NULLIF(trim(p.rent_cycle_id), ''),
            NULLIF(trim(p.metadata->>'month_token'), ''),
            NULLIF(trim(p.metadata->>'month'), ''),
            CASE
                WHEN trim(coalesce(p.metadata->>'cycle_start_date', '')) ~ '^\d{4}-\d{2}-\d{2}$'
                    THEN substr(trim(p.metadata->>'cycle_start_date'), 1, 7)
                ELSE NULL
            END,
            to_char(coalesce(p.created_at, timezone('utc', now())), 'YYYY-MM')
        ) AS month,
        COALESCE(b.monthly_rent, p.amount, 0)::numeric(10,2) AS due_amount,
        COALESCE(p.amount, 0)::numeric(10,2) AS paid_amount,
        CASE
            WHEN lower(coalesce(p.payment_status, p.status, '')) IN ('paid', 'completed', 'success', 'authorized') THEN 'paid'
            WHEN lower(coalesce(p.payment_status, p.status, '')) IN ('failed', 'cancelled', 'expired', 'terminated', 'rejected') THEN 'failed'
            ELSE 'pending'
        END AS ledger_status,
        jsonb_build_object(
            'source', 'payments_backfill',
            'order_id', coalesce(p.order_id, p.cashfree_order_id, p.provider_order_id),
            'payment_type', p.payment_type
        ) AS ledger_metadata
    FROM public.payments p
    JOIN public.bookings b ON b.id = p.booking_id
    WHERE lower(coalesce(p.payment_type, '')) = 'rent'
)
INSERT INTO public.rent_ledger (
    booking_id,
    month,
    due_amount,
    paid_amount,
    status,
    payment_id,
    metadata
)
SELECT
    booking_id,
    month,
    due_amount,
    paid_amount,
    ledger_status,
    payment_id,
    ledger_metadata
FROM rent_rows
WHERE month IS NOT NULL
  AND month ~ '^\d{4}-\d{2}$'
ON CONFLICT (booking_id, month)
DO UPDATE
SET due_amount = EXCLUDED.due_amount,
    paid_amount = GREATEST(public.rent_ledger.paid_amount, EXCLUDED.paid_amount),
    status = CASE
        WHEN EXCLUDED.status = 'paid' THEN 'paid'
        WHEN EXCLUDED.status = 'failed' AND public.rent_ledger.status <> 'paid' THEN 'failed'
        WHEN public.rent_ledger.status = 'paid' THEN 'paid'
        ELSE public.rent_ledger.status
    END,
    payment_id = COALESCE(EXCLUDED.payment_id, public.rent_ledger.payment_id),
    metadata = public.rent_ledger.metadata || EXCLUDED.metadata,
    updated_at = timezone('utc', now());
ALTER TABLE public.rent_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rent_ledger_select ON public.rent_ledger;
DROP POLICY IF EXISTS rent_ledger_admin_write ON public.rent_ledger;
CREATE POLICY rent_ledger_select ON public.rent_ledger
FOR SELECT
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = rent_ledger.booking_id
        AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid())
  )
);
CREATE POLICY rent_ledger_admin_write ON public.rent_ledger
FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
ALTER TABLE public.rent_ledger REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (
      SELECT 1
      FROM pg_publication
      WHERE pubname = 'supabase_realtime'
  ) THEN
      IF NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'rent_ledger'
      ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.rent_ledger;
      END IF;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
