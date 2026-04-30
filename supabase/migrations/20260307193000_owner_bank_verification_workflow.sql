CREATE TABLE IF NOT EXISTS public.owner_bank_verification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL UNIQUE REFERENCES public.owners(id) ON DELETE CASCADE,
  bank_account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  transfer_amount NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
  transfer_reference_id TEXT,
  provider_reference_id TEXT,
  transfer_status TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT owner_bank_verification_status_check
    CHECK (transfer_status IN ('pending', 'success', 'failed'))
);

CREATE TABLE IF NOT EXISTS public.owner_bank_verification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  verification_id UUID REFERENCES public.owner_bank_verification(id) ON DELETE SET NULL,
  bank_account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  transfer_amount NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
  transfer_reference TEXT,
  provider_reference_id TEXT,
  transfer_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT owner_bank_verification_history_status_check
    CHECK (transfer_status IN ('pending', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_owner_bank_verification_owner_id
  ON public.owner_bank_verification(owner_id);

CREATE INDEX IF NOT EXISTS idx_owner_bank_verification_status
  ON public.owner_bank_verification(transfer_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_bank_verification_transfer_ref
  ON public.owner_bank_verification(transfer_reference_id)
  WHERE transfer_reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_owner_bank_verification_history_owner_id
  ON public.owner_bank_verification_history(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_owner_bank_verification_history_transfer_ref
  ON public.owner_bank_verification_history(transfer_reference, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_owner_bank_verification_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_bank_verification_updated_at
  ON public.owner_bank_verification;

CREATE TRIGGER trg_owner_bank_verification_updated_at
BEFORE UPDATE ON public.owner_bank_verification
FOR EACH ROW
EXECUTE FUNCTION public.set_owner_bank_verification_updated_at();

ALTER TABLE public.owner_bank_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_bank_verification_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'owner_bank_verification'
      AND policyname = 'owner_bank_verification_owner_select'
  ) THEN
    CREATE POLICY owner_bank_verification_owner_select
      ON public.owner_bank_verification
      FOR SELECT
      USING (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'owner_bank_verification'
      AND policyname = 'owner_bank_verification_admin_select'
  ) THEN
    CREATE POLICY owner_bank_verification_admin_select
      ON public.owner_bank_verification
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.accounts AS a
          WHERE a.id = auth.uid()
            AND a.role = 'admin'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'owner_bank_verification_history'
      AND policyname = 'owner_bank_verification_history_owner_select'
  ) THEN
    CREATE POLICY owner_bank_verification_history_owner_select
      ON public.owner_bank_verification_history
      FOR SELECT
      USING (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'owner_bank_verification_history'
      AND policyname = 'owner_bank_verification_history_admin_select'
  ) THEN
    CREATE POLICY owner_bank_verification_history_admin_select
      ON public.owner_bank_verification_history
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.accounts AS a
          WHERE a.id = auth.uid()
            AND a.role = 'admin'
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'owner_bank_verification'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_bank_verification;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'owner_bank_verification_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_bank_verification_history;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_owner_bank_verified_before_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  verification_state TEXT;
BEGIN
  IF (
    (COALESCE(NEW.verified, FALSE) = TRUE OR COALESCE(NEW.verification_status, '') = 'approved')
    AND (
      COALESCE(OLD.verified, FALSE) IS DISTINCT FROM TRUE
      OR COALESCE(OLD.verification_status, '') <> 'approved'
    )
  ) THEN
    SELECT transfer_status
    INTO verification_state
    FROM public.owner_bank_verification
    WHERE owner_id = NEW.id;

    IF COALESCE(verification_state, '') <> 'success' THEN
      RAISE EXCEPTION 'Owner bank verification must succeed before approval';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_approval_requires_bank_verification
  ON public.owners;

CREATE TRIGGER trg_owner_approval_requires_bank_verification
BEFORE UPDATE OF verified, verification_status
ON public.owners
FOR EACH ROW
EXECUTE FUNCTION public.ensure_owner_bank_verified_before_approval();
