-- ==========================================
-- 🛡️ AUTH RECOVERY MIGRATION
-- Consolidates missing RPCs and Triggers
-- ==========================================
-- 1. check_user_exists RPC (Fixed from fix_auth_checks.sql)
DROP FUNCTION IF EXISTS public.check_user_exists(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.check_user_exists(
        phone_val TEXT DEFAULT NULL,
        email_val TEXT DEFAULT NULL
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE phone_exists BOOLEAN := FALSE;
email_exists BOOLEAN := FALSE;
phone_in_public BOOLEAN := FALSE;
email_in_public BOOLEAN := FALSE;
BEGIN -- Check Phone
IF phone_val IS NOT NULL
AND phone_val != '' THEN -- 1. Check in Auth
SELECT EXISTS(
        SELECT 1
        FROM auth.users
        WHERE phone = phone_val
            OR phone = REPLACE(phone_val, '+91', '')
            OR phone = CONCAT('+91', phone_val)
    ) INTO phone_exists;
-- 2. Check in Public Accounts
SELECT EXISTS(
        SELECT 1
        FROM public.accounts
        WHERE phone = phone_val
            OR phone = REPLACE(phone_val, '+91', '')
            OR phone = CONCAT('+91', phone_val)
    ) INTO phone_in_public;
END IF;
-- Check Email
IF email_val IS NOT NULL
AND email_val != '' THEN -- 1. Check in Auth
SELECT EXISTS(
        SELECT 1
        FROM auth.users
        WHERE email = LOWER(TRIM(email_val))
    ) INTO email_exists;
-- 2. Check in Public Accounts
SELECT EXISTS(
        SELECT 1
        FROM public.accounts
        WHERE email = LOWER(TRIM(email_val))
    ) INTO email_in_public;
END IF;
RETURN jsonb_build_object(
    'phoneExists',
    phone_exists,
    'emailExists',
    email_exists,
    'phoneInPublic',
    phone_in_public,
    'emailInPublic',
    email_in_public,
    'isGhost',
    (
        (
            email_exists
            AND NOT email_in_public
        )
        OR (
            phone_exists
            AND NOT phone_in_public
        )
    ),
    'isFullyRegistered',
    (
        (
            email_exists
            AND email_in_public
        )
        OR (
            phone_exists
            AND phone_in_public
        )
    )
);
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT, TEXT) TO anon,
    authenticated,
    service_role;
-- 2. repair_my_profile RPC (Fixed from final_boss_fix.sql)
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
BEGIN curr_id := auth.uid();
IF curr_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'No Login Found');
END IF;
-- Fetch from Auth directly
SELECT email,
    phone,
    raw_user_meta_data->>'role',
    raw_user_meta_data->>'name' INTO curr_email,
    curr_phone,
    curr_role,
    curr_name
FROM auth.users
WHERE id = curr_id;
curr_role := COALESCE(curr_role, 'customer');
curr_name := COALESCE(curr_name, 'User');
-- Healing Accounts
INSERT INTO public.accounts (id, email, phone, role)
VALUES (curr_id, curr_email, curr_phone, curr_role) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
-- Healing Role Tables
IF curr_role = 'owner' THEN
INSERT INTO public.owners (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO NOTHING;
ELSIF curr_role = 'customer' THEN
INSERT INTO public.customers (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO NOTHING;
END IF;
RETURN jsonb_build_object(
    'success',
    true,
    'repaired_id',
    curr_id,
    'role',
    curr_role
);
END;
$$;
GRANT EXECUTE ON FUNCTION public.repair_my_profile() TO authenticated,
    service_role;
-- 3. handle_new_user Trigger Function (Fixed from master_setup.sql)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ BEGIN
INSERT INTO public.accounts (id, email, phone, role)
VALUES (
        new.id,
        new.email,
        new.phone,
        COALESCE(new.raw_user_meta_data->>'role', 'customer')
    ) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
IF (
    COALESCE(new.raw_user_meta_data->>'role', 'customer') = 'admin'
) THEN
INSERT INTO public.admins (id, name, email)
VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'name', 'Admin'),
        new.email
    ) ON CONFLICT (id) DO NOTHING;
ELSIF (
    COALESCE(new.raw_user_meta_data->>'role', 'customer') = 'owner'
) THEN
INSERT INTO public.owners (id, name, email, phone)
VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'name', 'Owner'),
        new.email,
        new.phone
    ) ON CONFLICT (id) DO NOTHING;
ELSE
INSERT INTO public.customers (id, name, email, phone)
VALUES (
        new.id,
        new.raw_user_meta_data->>'name',
        new.email,
        new.phone
    ) ON CONFLICT (id) DO NOTHING;
END IF;
RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Re-create Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- 5. Harden RLS Policies (From final_boss_fix.sql)
-- Prevents common 406/Recursion errors
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
CREATE POLICY "Admins can view all accounts" ON public.accounts FOR
SELECT TO authenticated USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
        OR (
            auth.jwt()->>'email' IN (
                SELECT email
                FROM public.admins
            )
        )
    );
DROP POLICY IF EXISTS "Users can manage own account" ON public.accounts;
CREATE POLICY "Users can manage own account" ON public.accounts FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
