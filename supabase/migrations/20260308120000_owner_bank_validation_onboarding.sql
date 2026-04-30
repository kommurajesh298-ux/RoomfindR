CREATE TABLE IF NOT EXISTS public.owner_bank_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
  signup_email TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  account_number_hash TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  bank_name TEXT,
  branch_name TEXT,
  city TEXT,
  holder_name_input TEXT NOT NULL,
  holder_name_bank TEXT,
  name_match_score NUMERIC(5, 2),
  provider_reference_id TEXT,
  verification_method TEXT,
  verification_status TEXT NOT NULL DEFAULT 'validation_failed',
  failure_reason TEXT,
  penny_drop_txn_id TEXT,
  verification_date TIMESTAMPTZ,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT owner_bank_verifications_status_check CHECK (
    verification_status IN (
      'validated',
      'validation_failed',
      'name_mismatch',
      'duplicate_blocked',
      'rate_limited',
      'penny_drop_pending',
      'penny_drop_failed',
      'verified'
    )
  )
);

CREATE INDEX IF NOT EXISTS owner_bank_verifications_owner_id_idx
  ON public.owner_bank_verifications (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS owner_bank_verifications_signup_email_idx
  ON public.owner_bank_verifications (signup_email, created_at DESC);

CREATE INDEX IF NOT EXISTS owner_bank_verifications_status_idx
  ON public.owner_bank_verifications (verification_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS owner_bank_verifications_current_owner_idx
  ON public.owner_bank_verifications (owner_id)
  WHERE owner_id IS NOT NULL AND is_current = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS owner_bank_verifications_current_signup_idx
  ON public.owner_bank_verifications (signup_email)
  WHERE owner_id IS NULL AND is_current = TRUE;

CREATE OR REPLACE FUNCTION public.set_owner_bank_verifications_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_bank_verifications_updated_at
  ON public.owner_bank_verifications;

CREATE TRIGGER trg_owner_bank_verifications_updated_at
BEFORE UPDATE ON public.owner_bank_verifications
FOR EACH ROW
EXECUTE FUNCTION public.set_owner_bank_verifications_updated_at();

ALTER TABLE public.owner_bank_verifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'owner_bank_verifications'
      AND policyname = 'owner_bank_verifications_owner_select'
  ) THEN
    CREATE POLICY owner_bank_verifications_owner_select
      ON public.owner_bank_verifications
      FOR SELECT
      TO authenticated
      USING (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'owner_bank_verifications'
      AND policyname = 'owner_bank_verifications_admin_select'
  ) THEN
    CREATE POLICY owner_bank_verifications_admin_select
      ON public.owner_bank_verifications
      FOR SELECT
      TO authenticated
      USING (public.is_admin(auth.uid()));
  END IF;
END;
$$;

ALTER TABLE IF EXISTS public.owner_bank_accounts
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS account_holder_name_bank TEXT,
  ADD COLUMN IF NOT EXISTS name_match_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS account_validation_reference_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_method TEXT;

DO $$
BEGIN
  IF to_regclass('public.owner_bank_accounts') IS NOT NULL THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS owner_bank_accounts_account_number_hash_uidx
      ON public.owner_bank_accounts (account_number_hash)
      WHERE account_number_hash IS NOT NULL
    ';
  END IF;
END;
$$;
