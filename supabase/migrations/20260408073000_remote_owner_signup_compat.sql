-- Compatibility bridge for older hosted projects used by the current apps.
-- Adds the minimum owner-signup and auth-helper schema needed by the newer
-- frontend and edge functions without disturbing existing rows.

ALTER TABLE IF EXISTS public.accounts
  ADD COLUMN IF NOT EXISTS account_status text;

UPDATE public.accounts
SET account_status = COALESCE(account_status, 'active')
WHERE account_status IS NULL;

ALTER TABLE IF EXISTS public.accounts
  ALTER COLUMN account_status SET DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_account_status_check'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_account_status_check
      CHECK (account_status IN ('active', 'blocked', 'pending_admin_approval'));
  END IF;
END;
$$;

ALTER TABLE IF EXISTS public.owners
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS mobile_number text,
  ADD COLUMN IF NOT EXISTS bank_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS bank_verification_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_reference_id text,
  ADD COLUMN IF NOT EXISTS cashfree_transfer_id text,
  ADD COLUMN IF NOT EXISTS cashfree_status text,
  ADD COLUMN IF NOT EXISTS cashfree_beneficiary_id text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text;

UPDATE public.owners
SET
  owner_id = COALESCE(owner_id, id),
  full_name = COALESCE(NULLIF(full_name, ''), name),
  mobile_number = COALESCE(NULLIF(mobile_number, ''), phone),
  bank_verified = COALESCE(bank_verified, false),
  bank_verification_status = COALESCE(
    NULLIF(bank_verification_status, ''),
    CASE
      WHEN COALESCE(bank_verified, false) = true THEN 'verified'
      ELSE 'pending'
    END
  ),
  cashfree_status = COALESCE(
    NULLIF(cashfree_status, ''),
    CASE
      WHEN COALESCE(bank_verified, false) = true THEN 'success'
      ELSE 'pending'
    END
  )
WHERE
  owner_id IS NULL
  OR full_name IS NULL
  OR mobile_number IS NULL
  OR bank_verified IS NULL
  OR bank_verification_status IS NULL
  OR cashfree_status IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS owners_owner_id_uidx
  ON public.owners (owner_id);

CREATE TABLE IF NOT EXISTS public.owner_bank_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES public.owners(id) ON DELETE CASCADE,
  bank_account_number text NOT NULL,
  ifsc_code text NOT NULL,
  account_holder_name text NOT NULL,
  transfer_amount numeric(10, 2) NOT NULL DEFAULT 1.00,
  transfer_reference_id text,
  provider_reference_id text,
  transfer_status text NOT NULL DEFAULT 'pending',
  status_message text,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_bank_verification_status_check
    CHECK (transfer_status IN ('pending', 'success', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_bank_verification_transfer_ref_uidx
  ON public.owner_bank_verification (transfer_reference_id)
  WHERE transfer_reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.owner_bank_verification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  verification_id uuid REFERENCES public.owner_bank_verification(id) ON DELETE SET NULL,
  bank_account_number text NOT NULL,
  ifsc_code text NOT NULL,
  account_holder_name text NOT NULL,
  transfer_amount numeric(10, 2) NOT NULL DEFAULT 1.00,
  transfer_reference text,
  provider_reference_id text,
  transfer_status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_bank_verification_history_status_check
    CHECK (transfer_status IN ('pending', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS owner_bank_verification_history_owner_id_idx
  ON public.owner_bank_verification_history (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.owner_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES public.owners(id) ON DELETE CASCADE,
  account_holder_name text NOT NULL,
  account_number text NOT NULL,
  account_number_last4 text,
  account_number_hash text,
  ifsc text NOT NULL,
  bank_name text,
  branch_name text,
  city text,
  cashfree_beneficiary_id text,
  verified boolean NOT NULL DEFAULT false,
  bank_verification_status text NOT NULL DEFAULT 'pending',
  verification_method text,
  license_number text,
  license_document_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_bank_accounts_owner_id_idx
  ON public.owner_bank_accounts (owner_id);

DO $$
BEGIN
  IF to_regclass('public.owner_bank_verification') IS NOT NULL
     AND to_regclass('public.set_owner_bank_verification_updated_at') IS NULL THEN
    CREATE FUNCTION public.set_owner_bank_verification_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_bank_verification_updated_at
  ON public.owner_bank_verification;

CREATE TRIGGER trg_owner_bank_verification_updated_at
BEFORE UPDATE ON public.owner_bank_verification
FOR EACH ROW
EXECUTE FUNCTION public.set_owner_bank_verification_updated_at();

DO $$
BEGIN
  IF to_regclass('public.owner_bank_accounts') IS NOT NULL
     AND to_regclass('public.set_owner_bank_accounts_updated_at') IS NULL THEN
    CREATE FUNCTION public.set_owner_bank_accounts_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_bank_accounts_updated_at
  ON public.owner_bank_accounts;

CREATE TRIGGER trg_owner_bank_accounts_updated_at
BEFORE UPDATE ON public.owner_bank_accounts
FOR EACH ROW
EXECUTE FUNCTION public.set_owner_bank_accounts_updated_at();

DROP FUNCTION IF EXISTS public.check_user_exists(text, text);
CREATE OR REPLACE FUNCTION public.check_user_exists(email_val text, phone_val text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text := NULLIF(trim(email_val), '');
  v_phone text := NULLIF(trim(phone_val), '');
  email_exists boolean := false;
  phone_exists boolean := false;
BEGIN
  IF v_email IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM auth.users
      WHERE lower(email) = lower(v_email)
    )
    INTO email_exists;

    IF NOT email_exists THEN
      SELECT EXISTS(
        SELECT 1
        FROM public.accounts
        WHERE lower(email) = lower(v_email)
      )
      INTO email_exists;
    END IF;
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM auth.users
      WHERE phone = v_phone
    )
    INTO phone_exists;

    IF NOT phone_exists THEN
      SELECT EXISTS(
        SELECT 1
        FROM public.accounts
        WHERE phone = v_phone
      )
      INTO phone_exists;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'emailExists', COALESCE(email_exists, false),
    'phoneExists', COALESCE(phone_exists, false)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.repair_my_profile();
CREATE OR REPLACE FUNCTION public.repair_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  u record;
  role_val text;
  phone_val text;
  name_val text;
  city_val text;
  account_status_val text;
BEGIN
  SELECT id, email, phone, raw_user_meta_data, raw_app_meta_data
  INTO u
  FROM auth.users
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No authenticated user';
  END IF;

  role_val := COALESCE(
    NULLIF(u.raw_user_meta_data->>'role', ''),
    NULLIF(u.raw_app_meta_data->>'role', ''),
    (
      SELECT a.role
      FROM public.accounts AS a
      WHERE a.id = u.id
      LIMIT 1
    ),
    'customer'
  );

  phone_val := COALESCE(
    NULLIF(u.phone, ''),
    NULLIF(u.raw_user_meta_data->>'phone', ''),
    NULLIF(u.raw_user_meta_data->>'mobile_number', '')
  );

  name_val := COALESCE(
    NULLIF(u.raw_user_meta_data->>'name', ''),
    CASE
      WHEN role_val = 'admin' THEN 'Admin'
      WHEN role_val = 'owner' THEN 'Owner'
      ELSE 'User'
    END
  );

  city_val := NULLIF(u.raw_user_meta_data->>'city', '');

  account_status_val := CASE
    WHEN role_val = 'owner' THEN
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.owners AS o
          WHERE o.id = u.id
            AND (
              COALESCE(o.verified, false) = true
              OR lower(COALESCE(o.verification_status, '')) = 'approved'
            )
        ) THEN 'active'
        ELSE 'pending_admin_approval'
      END
    ELSE 'active'
  END;

  INSERT INTO public.accounts (id, email, phone, role, account_status, updated_at)
  VALUES (u.id, u.email, phone_val, role_val, account_status_val, now())
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        role = EXCLUDED.role,
        account_status = EXCLUDED.account_status,
        updated_at = now();

  IF role_val = 'customer' THEN
    INSERT INTO public.customers (id, email, phone, name, city, updated_at)
    VALUES (u.id, u.email, phone_val, name_val, city_val, now())
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          name = EXCLUDED.name,
          city = EXCLUDED.city,
          updated_at = now();
  ELSIF role_val = 'owner' THEN
    INSERT INTO public.owners (
      id,
      owner_id,
      name,
      full_name,
      email,
      phone,
      mobile_number,
      verified,
      verification_status,
      updated_at
    )
    VALUES (
      u.id,
      u.id,
      name_val,
      name_val,
      u.email,
      phone_val,
      phone_val,
      false,
      'pending',
      now()
    )
    ON CONFLICT (id) DO UPDATE
      SET owner_id = EXCLUDED.owner_id,
          name = EXCLUDED.name,
          full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          mobile_number = EXCLUDED.mobile_number,
          updated_at = now();
  ELSIF role_val = 'admin' THEN
    INSERT INTO public.admins (id, email, name, updated_at)
    VALUES (u.id, u.email, name_val, now())
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          name = EXCLUDED.name,
          updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'role', role_val,
    'account_status', account_status_val
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_user_exists(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_my_profile() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
