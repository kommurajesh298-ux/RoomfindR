-- Fix Signup RLS Issues
-- The client cannot check if a phone/email exists because RLS hides other users.
-- This RPC function (Security Definer) allows checking existence safely without exposing data.
CREATE OR REPLACE FUNCTION public.check_user_exists(
        phone_val TEXT DEFAULT NULL,
        email_val TEXT DEFAULT NULL
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER -- This allows the function to bypass RLS
    AS $$
DECLARE phone_exists BOOLEAN := FALSE;
email_exists BOOLEAN := FALSE;
BEGIN -- Check Phone
IF phone_val IS NOT NULL
AND phone_val != '' THEN -- Check both precise format and broad format to be safe
SELECT EXISTS(
        SELECT 1
        FROM accounts
        WHERE phone = phone_val
            OR phone = REPLACE(phone_val, '+91', '')
            OR phone = CONCAT('+91', phone_val)
    ) INTO phone_exists;
END IF;
-- Check Email
IF email_val IS NOT NULL
AND email_val != '' THEN
SELECT EXISTS(
        SELECT 1
        FROM accounts
        WHERE email = LOWER(TRIM(email_val))
    ) INTO email_exists;
END IF;
RETURN jsonb_build_object(
    'phoneExists',
    phone_exists,
    'emailExists',
    email_exists
);
END;
$$;
-- Grant execute permission to anon/authenticated
GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT, TEXT) TO anon,
    authenticated,
    service_role;