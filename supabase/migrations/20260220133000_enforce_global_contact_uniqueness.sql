BEGIN;
-- Normalize contacts in one place so every path uses the same rules.
CREATE OR REPLACE FUNCTION public.normalize_contact_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
SELECT lower(NULLIF(trim(COALESCE(p_email, '')), ''));
$$;
-- Canonical phone format:
--  - keep digits only
--  - treat 10-digit local India numbers as +91XXXXXXXXXX
--  - treat 91XXXXXXXXXX as +91XXXXXXXXXX
CREATE OR REPLACE FUNCTION public.normalize_contact_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
WITH cleaned AS (
    SELECT NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '') AS digits
)
SELECT CASE
    WHEN digits IS NULL THEN NULL
    WHEN digits ~ '^91[0-9]{10}$' THEN '+91' || right(digits, 10)
    WHEN digits ~ '^[0-9]{10}$' THEN '+91' || digits
    ELSE '+' || digits
END
FROM cleaned;
$$;
-- Refuse migration if different users already share the same normalized email/phone.
DO $$
DECLARE
    dup_email TEXT;
    dup_phone TEXT;
BEGIN
    SELECT t.email_norm
    INTO dup_email
    FROM (
        SELECT c.id, public.normalize_contact_email(c.email) AS email_norm FROM public.customers c
        UNION ALL
        SELECT o.id, public.normalize_contact_email(o.email) AS email_norm FROM public.owners o
        UNION ALL
        SELECT ad.id, public.normalize_contact_email(ad.email) AS email_norm FROM public.admins ad
        UNION ALL
        SELECT a.id, public.normalize_contact_email(a.email) AS email_norm FROM public.accounts a
    ) t
    WHERE t.email_norm IS NOT NULL
    GROUP BY t.email_norm
    HAVING COUNT(DISTINCT t.id) > 1
    LIMIT 1;

    IF dup_email IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = format('Duplicate email exists across profiles/accounts: %s', dup_email),
            HINT = 'Remove duplicates first, then rerun this migration.';
    END IF;

    SELECT t.phone_norm
    INTO dup_phone
    FROM (
        SELECT c.id, public.normalize_contact_phone(c.phone) AS phone_norm FROM public.customers c
        UNION ALL
        SELECT o.id, public.normalize_contact_phone(o.phone) AS phone_norm FROM public.owners o
        UNION ALL
        SELECT a.id, public.normalize_contact_phone(a.phone) AS phone_norm FROM public.accounts a
    ) t
    WHERE t.phone_norm IS NOT NULL
    GROUP BY t.phone_norm
    HAVING COUNT(DISTINCT t.id) > 1
    LIMIT 1;

    IF dup_phone IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = format('Duplicate phone exists across profiles/accounts: %s', dup_phone),
            HINT = 'Remove duplicates first, then rerun this migration.';
    END IF;
END
$$;
-- Always normalize on write to accounts. Existing unique constraints then enforce uniqueness globally.
CREATE OR REPLACE FUNCTION public.normalize_accounts_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.email := public.normalize_contact_email(NEW.email);
    NEW.phone := public.normalize_contact_phone(NEW.phone);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS normalize_accounts_contact ON public.accounts;
CREATE TRIGGER normalize_accounts_contact
BEFORE INSERT OR UPDATE OF email, phone
ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.normalize_accounts_contact();
-- Shared writer into accounts. Uniqueness is enforced by accounts constraints.
CREATE OR REPLACE FUNCTION public.sync_profile_contact_to_accounts(
    p_user_id UUID,
    p_role TEXT,
    p_email TEXT,
    p_phone TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_email TEXT;
    v_phone TEXT;
BEGIN
    v_email := public.normalize_contact_email(p_email);
    v_phone := public.normalize_contact_phone(p_phone);

    INSERT INTO public.accounts (id, email, phone, role, updated_at)
    VALUES (p_user_id, v_email, v_phone, p_role, NOW())
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.accounts.phone),
        updated_at = NOW();

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'EMAIL_OR_PHONE_ALREADY_EXISTS';
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_customer_unique_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
    NEW.email := public.normalize_contact_email(NEW.email);
    NEW.phone := public.normalize_contact_phone(NEW.phone);

    IF NEW.phone IS NULL THEN
        RAISE EXCEPTION 'PHONE_REQUIRED';
    END IF;

    PERFORM public.sync_profile_contact_to_accounts(
        NEW.id,
        'customer',
        NEW.email,
        NEW.phone
    );
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_owner_unique_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
    NEW.email := public.normalize_contact_email(NEW.email);
    NEW.phone := public.normalize_contact_phone(NEW.phone);

    IF NEW.phone IS NULL THEN
        RAISE EXCEPTION 'PHONE_REQUIRED';
    END IF;

    PERFORM public.sync_profile_contact_to_accounts(
        NEW.id,
        'owner',
        NEW.email,
        NEW.phone
    );
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_admin_unique_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security = off
AS $$
DECLARE
    resolved_phone TEXT;
BEGIN
    NEW.email := public.normalize_contact_email(NEW.email);

    SELECT public.normalize_contact_phone(
        COALESCE(
            NULLIF(a.phone, ''),
            NULLIF(u.phone, ''),
            NULLIF(u.raw_user_meta_data->>'phone', ''),
            NULLIF(u.raw_user_meta_data->>'phone_number', ''),
            NULLIF(u.raw_user_meta_data->>'mobile', ''),
            NULLIF(u.raw_user_meta_data->>'mobile_number', '')
        )
    )
    INTO resolved_phone
    FROM auth.users u
    LEFT JOIN public.accounts a ON a.id = u.id
    WHERE u.id = NEW.id;

    IF resolved_phone IS NULL THEN
        RAISE EXCEPTION 'PHONE_REQUIRED';
    END IF;

    PERFORM public.sync_profile_contact_to_accounts(
        NEW.id,
        'admin',
        NEW.email,
        resolved_phone
    );
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_customer_unique_contact ON public.customers;
CREATE TRIGGER enforce_customer_unique_contact
BEFORE INSERT OR UPDATE OF email, phone
ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_unique_contact();
DROP TRIGGER IF EXISTS enforce_owner_unique_contact ON public.owners;
CREATE TRIGGER enforce_owner_unique_contact
BEFORE INSERT OR UPDATE OF email, phone
ON public.owners
FOR EACH ROW
EXECUTE FUNCTION public.enforce_owner_unique_contact();
DROP TRIGGER IF EXISTS enforce_admin_unique_contact ON public.admins;
CREATE TRIGGER enforce_admin_unique_contact
BEFORE INSERT OR UPDATE OF email
ON public.admins
FOR EACH ROW
EXECUTE FUNCTION public.enforce_admin_unique_contact();
-- Normalize existing persisted values (will fail loudly if duplicates exist after normalization).
UPDATE public.accounts
SET email = email,
    phone = phone;
UPDATE public.customers
SET email = public.normalize_contact_email(email),
    phone = public.normalize_contact_phone(phone)
WHERE email IS DISTINCT FROM public.normalize_contact_email(email)
   OR phone IS DISTINCT FROM public.normalize_contact_phone(phone);
UPDATE public.owners
SET email = public.normalize_contact_email(email),
    phone = public.normalize_contact_phone(phone)
WHERE email IS DISTINCT FROM public.normalize_contact_email(email)
   OR phone IS DISTINCT FROM public.normalize_contact_phone(phone);
UPDATE public.admins
SET email = public.normalize_contact_email(email)
WHERE email IS DISTINCT FROM public.normalize_contact_email(email);
-- Validation RPC should use normalized checks and include all role tables.
CREATE OR REPLACE FUNCTION public.check_user_exists(
  phone_val TEXT DEFAULT NULL,
  email_val TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  phone_exists BOOLEAN := FALSE;
  email_exists BOOLEAN := FALSE;
  phone_in_public BOOLEAN := FALSE;
  email_in_public BOOLEAN := FALSE;
  role_val TEXT := NULL;
  account_id UUID := NULL;
  norm_phone TEXT := public.normalize_contact_phone(phone_val);
  norm_email TEXT := public.normalize_contact_email(email_val);
BEGIN
  IF norm_phone IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM auth.users u
      WHERE public.normalize_contact_phone(
        COALESCE(
          NULLIF(u.phone, ''),
          NULLIF(u.raw_user_meta_data->>'phone', ''),
          NULLIF(u.raw_user_meta_data->>'phone_number', ''),
          NULLIF(u.raw_user_meta_data->>'mobile', ''),
          NULLIF(u.raw_user_meta_data->>'mobile_number', '')
        )
      ) = norm_phone
    ) INTO phone_exists;

    SELECT a.id, a.role
    INTO account_id, role_val
    FROM public.accounts a
    WHERE public.normalize_contact_phone(a.phone) = norm_phone
    LIMIT 1;

    phone_in_public := account_id IS NOT NULL;

    IF NOT phone_in_public THEN
      SELECT x.id, x.role
      INTO account_id, role_val
      FROM (
        SELECT c.id, 'customer'::TEXT AS role, public.normalize_contact_phone(c.phone) AS phone_norm
        FROM public.customers c
        UNION ALL
        SELECT o.id, 'owner'::TEXT AS role, public.normalize_contact_phone(o.phone) AS phone_norm
        FROM public.owners o
      ) x
      WHERE x.phone_norm = norm_phone
      LIMIT 1;

      phone_in_public := account_id IS NOT NULL;
    END IF;
  END IF;

  IF norm_email IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM auth.users u
      WHERE public.normalize_contact_email(u.email) = norm_email
    ) INTO email_exists;

    IF account_id IS NULL THEN
      SELECT a.id, a.role
      INTO account_id, role_val
      FROM public.accounts a
      WHERE public.normalize_contact_email(a.email) = norm_email
      LIMIT 1;
    END IF;

    SELECT EXISTS(
      SELECT 1
      FROM public.accounts a
      WHERE public.normalize_contact_email(a.email) = norm_email
    ) INTO email_in_public;

    IF NOT email_in_public THEN
      SELECT x.id, x.role
      INTO account_id, role_val
      FROM (
        SELECT c.id, 'customer'::TEXT AS role, public.normalize_contact_email(c.email) AS email_norm
        FROM public.customers c
        UNION ALL
        SELECT o.id, 'owner'::TEXT AS role, public.normalize_contact_email(o.email) AS email_norm
        FROM public.owners o
        UNION ALL
        SELECT ad.id, 'admin'::TEXT AS role, public.normalize_contact_email(ad.email) AS email_norm
        FROM public.admins ad
      ) x
      WHERE x.email_norm = norm_email
      LIMIT 1;

      email_in_public := account_id IS NOT NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'phoneExists', phone_exists,
    'emailExists', email_exists,
    'phoneInPublic', phone_in_public,
    'emailInPublic', email_in_public,
    'isGhost', ((email_exists AND NOT email_in_public) OR (phone_exists AND NOT phone_in_public)),
    'isFullyRegistered', ((email_exists AND email_in_public) OR (phone_exists AND phone_in_public)),
    'role', role_val,
    'accountId', account_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT, TEXT)
TO anon, authenticated, service_role;
COMMIT;
