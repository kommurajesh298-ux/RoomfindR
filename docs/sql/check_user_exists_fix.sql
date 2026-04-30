-- Fix duplicate-check accuracy for signup/login.
-- Run in Supabase SQL editor (Hosted).

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
    v_email TEXT := NULLIF(LOWER(TRIM(email_val)), '');
    v_phone TEXT := NULLIF(TRIM(phone_val), '');
    email_exists BOOLEAN := FALSE;
    phone_exists BOOLEAN := FALSE;
BEGIN
    IF v_email IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM auth.users WHERE LOWER(email) = v_email)
          INTO email_exists;
        IF NOT email_exists THEN
            SELECT EXISTS(SELECT 1 FROM public.accounts WHERE LOWER(email) = v_email)
              INTO email_exists;
        END IF;
        IF NOT email_exists THEN
            SELECT EXISTS(SELECT 1 FROM public.customers WHERE LOWER(email) = v_email)
              INTO email_exists;
        END IF;
        IF NOT email_exists THEN
            SELECT EXISTS(SELECT 1 FROM public.owners WHERE LOWER(email) = v_email)
              INTO email_exists;
        END IF;
        IF NOT email_exists THEN
            SELECT EXISTS(SELECT 1 FROM public.admins WHERE LOWER(email) = v_email)
              INTO email_exists;
        END IF;
    END IF;

    IF v_phone IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM auth.users WHERE phone = v_phone)
          INTO phone_exists;
        IF NOT phone_exists THEN
            SELECT EXISTS(
                SELECT 1
                  FROM public.accounts
                 WHERE phone = v_phone
                    OR phone = REPLACE(v_phone, '+91', '')
                    OR phone = CONCAT('+91', v_phone)
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

GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT, TEXT)
TO anon, authenticated, service_role;
