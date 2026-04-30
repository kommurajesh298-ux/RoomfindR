BEGIN;
DROP FUNCTION IF EXISTS public.check_user_exists(TEXT, TEXT);
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
BEGIN
  IF phone_val IS NOT NULL AND phone_val <> '' THEN
    SELECT EXISTS(
      SELECT 1
      FROM auth.users
      WHERE phone = phone_val
        OR phone = REPLACE(phone_val, '+91', '')
        OR phone = CONCAT('+91', phone_val)
    ) INTO phone_exists;

    SELECT EXISTS(
      SELECT 1
      FROM public.accounts
      WHERE phone = phone_val
        OR phone = REPLACE(phone_val, '+91', '')
        OR phone = CONCAT('+91', phone_val)
    ) INTO phone_in_public;

    SELECT id, role
    INTO account_id, role_val
    FROM public.accounts
    WHERE phone = phone_val
      OR phone = REPLACE(phone_val, '+91', '')
      OR phone = CONCAT('+91', phone_val)
    LIMIT 1;
  END IF;

  IF email_val IS NOT NULL AND email_val <> '' THEN
    SELECT EXISTS(
      SELECT 1
      FROM auth.users
      WHERE email = LOWER(TRIM(email_val))
    ) INTO email_exists;

    SELECT EXISTS(
      SELECT 1
      FROM public.accounts
      WHERE email = LOWER(TRIM(email_val))
    ) INTO email_in_public;

    SELECT id, role
    INTO account_id, role_val
    FROM public.accounts
    WHERE email = LOWER(TRIM(email_val))
    LIMIT 1;
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
