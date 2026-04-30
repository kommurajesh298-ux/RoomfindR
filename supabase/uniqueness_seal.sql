-- ==========================================
-- ROOMFINDR UNIQUENESS SEAL (v8.1)
-- Enforces absolute global identity uniqueness
-- ==========================================
-- 1. CLEANUP: Remove duplicates that might block new constraints
-- Keep only the record matching the main 'accounts' table or the most recent one.
-- Clean Customers
DELETE FROM public.customers c1 USING public.customers c2
WHERE c1.id < c2.id
    AND (
        c1.phone = c2.phone
        OR c1.email = c2.email
    );
-- Clean Owners
DELETE FROM public.owners o1 USING public.owners o2
WHERE o1.id < o2.id
    AND (
        o1.phone = o2.phone
        OR o1.email = o2.email
    );
-- 2. HARDEN CONSTRAINTS: Add UNIQUE to role tables
-- This ensures that even if a trigger is bypassed, the DB blocks duplicates.
-- Customers
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_phone_key'
) THEN
ALTER TABLE public.customers
ADD CONSTRAINT customers_phone_key UNIQUE (phone);
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_email_key'
) THEN
ALTER TABLE public.customers
ADD CONSTRAINT customers_email_key UNIQUE (email);
END IF;
END $$;
-- Owners
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'owners_phone_key'
) THEN
ALTER TABLE public.owners
ADD CONSTRAINT owners_phone_key UNIQUE (phone);
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'owners_email_key'
) THEN
ALTER TABLE public.owners
ADD CONSTRAINT owners_email_key UNIQUE (email);
END IF;
END $$;
-- 3. TRIPLE-CHECK RPC: The ultimate identity checker
-- This function checks all 3 tables to ensure a phone/email is TRULY available.
CREATE OR REPLACE FUNCTION public.check_user_exists(
        phone_val TEXT DEFAULT NULL,
        email_val TEXT DEFAULT NULL
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE phone_exists BOOLEAN := FALSE;
email_exists BOOLEAN := FALSE;
clean_phone TEXT;
BEGIN -- Normalize phone: remove non-digits and handle +91
IF phone_val IS NOT NULL
AND phone_val != '' THEN clean_phone := REPLACE(phone_val, '+91', '');
clean_phone := REGEXP_REPLACE(clean_phone, '\D', '', 'g');
-- Check in all identity tables
SELECT EXISTS (
        SELECT 1
        FROM public.accounts
        WHERE phone = phone_val
            OR phone = clean_phone
            OR phone = '+91' || clean_phone
        UNION
        SELECT 1
        FROM public.customers
        WHERE phone = phone_val
            OR phone = clean_phone
            OR phone = '+91' || clean_phone
        UNION
        SELECT 1
        FROM public.owners
        WHERE phone = phone_val
            OR phone = clean_phone
            OR phone = '+91' || clean_phone
    ) INTO phone_exists;
END IF;
-- Check Email
IF email_val IS NOT NULL
AND email_val != '' THEN
SELECT EXISTS (
        SELECT 1
        FROM public.accounts
        WHERE email = LOWER(TRIM(email_val))
        UNION
        SELECT 1
        FROM public.customers
        WHERE email = LOWER(TRIM(email_val))
        UNION
        SELECT 1
        FROM public.owners
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
-- Grant permissions
GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT, TEXT) TO anon,
    authenticated,
    service_role;
-- 4. TRIGGER UPDATE: Ensure handle_new_user uses the same cleanup logic
-- This is a safety net if a "zombie" record exists but no Auth user.
CREATE OR REPLACE FUNCTION public.handle_new_user_cleanup() RETURNS TRIGGER AS $$ BEGIN -- Delete from any table if the phone/email exists but the ID belongs to a non-existent auth user
DELETE FROM public.accounts
WHERE (
        email = new.email
        OR (
            phone IS NOT NULL
            AND phone = new.phone
        )
    )
    AND id != new.id
    AND id NOT IN (
        SELECT id
        FROM auth.users
    );
DELETE FROM public.customers
WHERE (
        email = new.email
        OR (
            phone IS NOT NULL
            AND phone = new.phone
        )
    )
    AND id != new.id
    AND id NOT IN (
        SELECT id
        FROM auth.users
    );
DELETE FROM public.owners
WHERE (
        email = new.email
        OR (
            phone IS NOT NULL
            AND phone = new.phone
        )
    )
    AND id != new.id
    AND id NOT IN (
        SELECT id
        FROM auth.users
    );
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS on_auth_user_created_cleanup ON auth.users;
CREATE TRIGGER on_auth_user_created_cleanup BEFORE
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_cleanup();