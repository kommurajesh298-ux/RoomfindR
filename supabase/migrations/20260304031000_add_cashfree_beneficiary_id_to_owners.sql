-- Backward-compatibility for projects where this column was not added.
-- Required by admin payout/refund queue owner joins.

ALTER TABLE IF EXISTS public.owners
  ADD COLUMN IF NOT EXISTS cashfree_beneficiary_id text;
DO $$
BEGIN
  IF to_regclass('public.owners') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS owners_cashfree_beneficiary_id_idx
      ON public.owners (cashfree_beneficiary_id);
  END IF;
END;
$$;
