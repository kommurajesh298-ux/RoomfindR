-- Owner bank-account verification guardrails for signup and profile updates.
-- Safe extension only: keeps existing payout and settlement logic untouched.

ALTER TABLE IF EXISTS public.owners
  ADD COLUMN IF NOT EXISTS bank_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_reference_id text,
  ADD COLUMN IF NOT EXISTS bank_verification_status text NOT NULL DEFAULT 'pending';
DO $$
BEGIN
  IF to_regclass('public.owners') IS NOT NULL THEN
    ALTER TABLE public.owners
      DROP CONSTRAINT IF EXISTS owners_bank_verification_status_check;
    ALTER TABLE public.owners
      ADD CONSTRAINT owners_bank_verification_status_check
      CHECK (bank_verification_status IN ('pending', 'verified', 'failed', 'skipped'));
  END IF;
END;
$$;
UPDATE public.owners
SET
  bank_verification_status = CASE
    WHEN coalesce(bank_verified, false) = true THEN 'verified'
    WHEN lower(coalesce(trim(bank_verification_status), '')) IN ('pending', 'verified', 'failed', 'skipped')
      THEN lower(trim(bank_verification_status))
    ELSE 'pending'
  END,
  bank_verified_at = CASE
    WHEN coalesce(bank_verified, false) = true THEN coalesce(bank_verified_at, timezone('utc', now()))
    ELSE null
  END
WHERE
  bank_verification_status IS NULL
  OR lower(coalesce(trim(bank_verification_status), '')) NOT IN ('pending', 'verified', 'failed', 'skipped')
  OR (coalesce(bank_verified, false) = true AND bank_verified_at IS NULL);
CREATE INDEX IF NOT EXISTS owners_bank_verified_idx
  ON public.owners (bank_verified);
CREATE INDEX IF NOT EXISTS owners_bank_verification_status_idx
  ON public.owners (bank_verification_status);
CREATE INDEX IF NOT EXISTS owners_verification_reference_id_idx
  ON public.owners (verification_reference_id);
CREATE TABLE IF NOT EXISTS public.owner_bank_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  account_number_masked text,
  ifsc_code text,
  request_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'rate_limited')),
  user_message text,
  provider_status text,
  provider_reference_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS owner_bank_verification_attempts_owner_id_idx
  ON public.owner_bank_verification_attempts (owner_id);
CREATE INDEX IF NOT EXISTS owner_bank_verification_attempts_created_at_idx
  ON public.owner_bank_verification_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS owner_bank_verification_attempts_request_key_idx
  ON public.owner_bank_verification_attempts (request_key);
ALTER TABLE public.owner_bank_verification_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_bank_verification_attempts_admin_all ON public.owner_bank_verification_attempts;
CREATE POLICY owner_bank_verification_attempts_admin_all
  ON public.owner_bank_verification_attempts
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS owner_bank_verification_attempts_owner_select ON public.owner_bank_verification_attempts;
CREATE POLICY owner_bank_verification_attempts_owner_select
  ON public.owner_bank_verification_attempts
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());
DROP TRIGGER IF EXISTS update_owner_bank_verification_attempts_updated_at ON public.owner_bank_verification_attempts;
CREATE TRIGGER update_owner_bank_verification_attempts_updated_at
  BEFORE UPDATE ON public.owner_bank_verification_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
