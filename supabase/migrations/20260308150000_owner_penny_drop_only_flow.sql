BEGIN;

DROP TABLE IF EXISTS public.owner_bank_verifications CASCADE;
DROP FUNCTION IF EXISTS public.set_owner_bank_verifications_updated_at();

ALTER TABLE IF EXISTS public.owner_bank_accounts
  DROP COLUMN IF EXISTS account_holder_name_bank,
  DROP COLUMN IF EXISTS name_match_score,
  DROP COLUMN IF EXISTS account_validation_reference_id;

UPDATE public.owners
SET
  verified = TRUE,
  verification_status = 'approved',
  updated_at = timezone('utc', now())
WHERE COALESCE(bank_verified, FALSE) = TRUE
  AND (
    verified IS DISTINCT FROM TRUE
    OR COALESCE(verification_status, '') <> 'approved'
  );

CREATE OR REPLACE FUNCTION public.is_owner_verified(owner_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.owners o
    WHERE o.id = owner_uuid
      AND (
        o.bank_verified IS TRUE
        OR o.verified IS TRUE
        OR o.verification_status = 'approved'
      )
  );
$$;

COMMIT;
