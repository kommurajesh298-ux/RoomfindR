ALTER TABLE IF EXISTS public.owners
  ADD COLUMN IF NOT EXISTS cashfree_transfer_id text;

UPDATE public.owners
SET cashfree_transfer_id = verification_reference_id
WHERE cashfree_transfer_id IS NULL
  AND verification_reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS owners_cashfree_transfer_id_idx
  ON public.owners (cashfree_transfer_id);
