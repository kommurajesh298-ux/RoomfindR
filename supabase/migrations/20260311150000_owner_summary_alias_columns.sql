ALTER TABLE IF EXISTS public.owners
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS mobile_number text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS cashfree_status text;

ALTER TABLE IF EXISTS public.owners
  ALTER COLUMN bank_verified SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_owner_alias_columns_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.owner_id := COALESCE(NEW.owner_id, NEW.id);
  NEW.full_name := COALESCE(NULLIF(NEW.full_name, ''), NEW.name);
  NEW.mobile_number := COALESCE(NULLIF(NEW.mobile_number, ''), NEW.phone);
  NEW.bank_account_number := COALESCE(
    NULLIF(NEW.bank_account_number, ''),
    NULLIF(NEW.bank_details->>'accountNumber', '')
  );
  NEW.bank_ifsc := COALESCE(
    NULLIF(NEW.bank_ifsc, ''),
    NULLIF(NEW.bank_details->>'ifscCode', '')
  );
  NEW.cashfree_status := COALESCE(
    NULLIF(NEW.cashfree_status, ''),
    CASE
      WHEN lower(COALESCE(NEW.bank_verification_status, '')) = 'verified' THEN 'success'
      WHEN lower(COALESCE(NEW.bank_verification_status, '')) = 'failed' THEN 'failed'
      ELSE 'pending'
    END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_owner_alias_columns_before_write
  ON public.owners;

CREATE TRIGGER trg_sync_owner_alias_columns_before_write
BEFORE INSERT OR UPDATE ON public.owners
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_alias_columns_before_write();

CREATE OR REPLACE FUNCTION public.refresh_owner_summary_bank_aliases(p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  bank_row RECORD;
  verification_row RECORD;
BEGIN
  IF p_owner_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    account_holder_name,
    account_number_last4,
    ifsc,
    bank_name,
    branch_name,
    city,
    cashfree_beneficiary_id
  INTO bank_row
  FROM public.owner_bank_accounts
  WHERE owner_id = p_owner_id;

  SELECT
    transfer_reference_id,
    transfer_status,
    verified_at
  INTO verification_row
  FROM public.owner_bank_verification
  WHERE owner_id = p_owner_id;

  UPDATE public.owners AS o
  SET
    owner_id = o.id,
    full_name = COALESCE(NULLIF(o.full_name, ''), o.name),
    mobile_number = COALESCE(NULLIF(o.mobile_number, ''), o.phone),
    account_holder_name = COALESCE(bank_row.account_holder_name, o.account_holder_name),
    bank_account_number = COALESCE(
      CASE
        WHEN COALESCE(bank_row.account_number_last4, '') <> ''
          THEN 'XXXX' || bank_row.account_number_last4
        ELSE NULL
      END,
      NULLIF(o.bank_details->>'accountNumber', ''),
      o.bank_account_number
    ),
    bank_ifsc = COALESCE(
      NULLIF(bank_row.ifsc, ''),
      NULLIF(o.bank_details->>'ifscCode', ''),
      o.bank_ifsc
    ),
    bank_details = CASE
      WHEN bank_row IS NULL THEN o.bank_details
      ELSE jsonb_strip_nulls(
        COALESCE(o.bank_details, '{}'::jsonb) ||
        jsonb_build_object(
          'accountHolderName', COALESCE(bank_row.account_holder_name, o.account_holder_name),
          'accountNumber', COALESCE(
            CASE
              WHEN COALESCE(bank_row.account_number_last4, '') <> ''
                THEN 'XXXX' || bank_row.account_number_last4
              ELSE NULL
            END,
            NULLIF(o.bank_details->>'accountNumber', ''),
            o.bank_account_number
          ),
          'ifscCode', COALESCE(
            NULLIF(bank_row.ifsc, ''),
            NULLIF(o.bank_details->>'ifscCode', ''),
            o.bank_ifsc
          ),
          'bankName', bank_row.bank_name,
          'branchName', bank_row.branch_name,
          'city', bank_row.city
        )
      )
    END,
    cashfree_transfer_id = COALESCE(
      NULLIF(verification_row.transfer_reference_id, ''),
      o.cashfree_transfer_id
    ),
    cashfree_status = COALESCE(
      NULLIF(verification_row.transfer_status, ''),
      NULLIF(o.cashfree_status, ''),
      CASE
        WHEN lower(COALESCE(o.bank_verification_status, '')) = 'verified' THEN 'success'
        WHEN lower(COALESCE(o.bank_verification_status, '')) = 'failed' THEN 'failed'
        ELSE 'pending'
      END
    ),
    bank_verified_at = CASE
      WHEN COALESCE(o.bank_verified, false) = true THEN COALESCE(verification_row.verified_at, o.bank_verified_at)
      ELSE o.bank_verified_at
    END,
    updated_at = now()
  WHERE o.id = p_owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_owner_bank_accounts_alias_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.refresh_owner_summary_bank_aliases(NEW.owner_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_bank_accounts_alias_sync
  ON public.owner_bank_accounts;

CREATE TRIGGER trg_owner_bank_accounts_alias_sync
AFTER INSERT OR UPDATE ON public.owner_bank_accounts
FOR EACH ROW
EXECUTE FUNCTION public.handle_owner_bank_accounts_alias_sync();

CREATE OR REPLACE FUNCTION public.handle_owner_bank_verification_alias_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.refresh_owner_summary_bank_aliases(NEW.owner_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_bank_verification_alias_sync
  ON public.owner_bank_verification;

CREATE TRIGGER trg_owner_bank_verification_alias_sync
AFTER INSERT OR UPDATE ON public.owner_bank_verification
FOR EACH ROW
EXECUTE FUNCTION public.handle_owner_bank_verification_alias_sync();

UPDATE public.owners AS o
SET
  owner_id = COALESCE(o.owner_id, o.id),
  full_name = COALESCE(NULLIF(o.full_name, ''), o.name),
  mobile_number = COALESCE(NULLIF(o.mobile_number, ''), o.phone),
  bank_account_number = COALESCE(
    NULLIF(o.bank_account_number, ''),
    NULLIF(o.bank_details->>'accountNumber', ''),
    (
      SELECT CASE
        WHEN COALESCE(oba.account_number_last4, '') <> ''
          THEN 'XXXX' || oba.account_number_last4
        ELSE NULL
      END
      FROM public.owner_bank_accounts AS oba
      WHERE oba.owner_id = o.id
      LIMIT 1
    ),
    (
      SELECT NULLIF(obv.bank_account_number, '')
      FROM public.owner_bank_verification AS obv
      WHERE obv.owner_id = o.id
      LIMIT 1
    )
  ),
  bank_ifsc = COALESCE(
    NULLIF(o.bank_ifsc, ''),
    NULLIF(o.bank_details->>'ifscCode', ''),
    (
      SELECT NULLIF(oba.ifsc, '')
      FROM public.owner_bank_accounts AS oba
      WHERE oba.owner_id = o.id
      LIMIT 1
    ),
    (
      SELECT NULLIF(obv.ifsc_code, '')
      FROM public.owner_bank_verification AS obv
      WHERE obv.owner_id = o.id
      LIMIT 1
    )
  ),
  cashfree_transfer_id = COALESCE(
    NULLIF(o.cashfree_transfer_id, ''),
    (
      SELECT NULLIF(obv.transfer_reference_id, '')
      FROM public.owner_bank_verification AS obv
      WHERE obv.owner_id = o.id
      LIMIT 1
    ),
    o.verification_reference_id
  ),
  cashfree_status = COALESCE(
    NULLIF(o.cashfree_status, ''),
    (
      SELECT NULLIF(obv.transfer_status, '')
      FROM public.owner_bank_verification AS obv
      WHERE obv.owner_id = o.id
      LIMIT 1
    ),
    CASE
      WHEN lower(COALESCE(o.bank_verification_status, '')) = 'verified' THEN 'success'
      WHEN lower(COALESCE(o.bank_verification_status, '')) = 'failed' THEN 'failed'
      ELSE 'pending'
    END
  );

SELECT public.refresh_owner_summary_bank_aliases(id)
FROM public.owners;

CREATE UNIQUE INDEX IF NOT EXISTS owners_owner_id_uidx
  ON public.owners (owner_id);

CREATE INDEX IF NOT EXISTS owners_cashfree_status_idx
  ON public.owners (cashfree_status);
