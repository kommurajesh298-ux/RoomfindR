ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
  CHECK (commission_amount >= 0);
