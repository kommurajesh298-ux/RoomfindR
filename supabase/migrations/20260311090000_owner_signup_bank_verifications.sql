CREATE TABLE IF NOT EXISTS public.owner_signup_bank_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  phone TEXT,
  full_name TEXT,
  account_holder_name TEXT NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  account_number_last4 TEXT,
  account_number_hash TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  bank_name TEXT,
  branch_name TEXT,
  city TEXT,
  cashfree_beneficiary_id TEXT,
  transfer_reference_id TEXT,
  provider_reference_id TEXT,
  transfer_status TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT owner_signup_bank_verifications_status_check
    CHECK (transfer_status IN ('pending', 'success', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_signup_bank_verifications_email_uidx
  ON public.owner_signup_bank_verifications (email);

CREATE INDEX IF NOT EXISTS owner_signup_bank_verifications_account_hash_idx
  ON public.owner_signup_bank_verifications (account_number_hash);

CREATE INDEX IF NOT EXISTS owner_signup_bank_verifications_transfer_ref_idx
  ON public.owner_signup_bank_verifications (transfer_reference_id);

CREATE INDEX IF NOT EXISTS owner_signup_bank_verifications_status_idx
  ON public.owner_signup_bank_verifications (transfer_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS owner_signup_bank_verifications_account_success_uidx
  ON public.owner_signup_bank_verifications (account_number_hash)
  WHERE transfer_status = 'success' AND consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_owner_signup_bank_verifications_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_signup_bank_verifications_updated_at
  ON public.owner_signup_bank_verifications;

CREATE TRIGGER trg_owner_signup_bank_verifications_updated_at
BEFORE UPDATE ON public.owner_signup_bank_verifications
FOR EACH ROW
EXECUTE FUNCTION public.set_owner_signup_bank_verifications_updated_at();

ALTER TABLE public.owner_signup_bank_verifications ENABLE ROW LEVEL SECURITY;
