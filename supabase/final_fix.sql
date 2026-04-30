-- ==========================================
-- FINAL FIX FOR SIGNUP ERRORS (v2)
-- ==========================================
-- 1. Create Logging Table (to catch trigger errors without crashing)
CREATE TABLE IF NOT EXISTS public.app_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view logs" ON public.app_logs FOR
SELECT USING (
        (
            SELECT role
            FROM accounts
            WHERE id = auth.uid()
        ) = 'admin'
    );
-- 2. Ensure 'admins' table exists (Critical source of crashes)
CREATE TABLE IF NOT EXISTS public.admins (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
-- 3. Install Secure Existence Check RPC (Fixes RLS issues)
CREATE OR REPLACE FUNCTION public.check_user_exists(
        phone_val TEXT DEFAULT NULL,
        email_val TEXT DEFAULT NULL
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE phone_exists BOOLEAN := FALSE;
email_exists BOOLEAN := FALSE;
BEGIN IF phone_val IS NOT NULL
AND phone_val != '' THEN
SELECT EXISTS(
        SELECT 1
        FROM accounts
        WHERE phone = phone_val
            OR phone = REPLACE(phone_val, '+91', '')
            OR phone = CONCAT('+91', phone_val)
    ) INTO phone_exists;
END IF;
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
GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT, TEXT) TO anon,
    authenticated,
    service_role;
-- 4. ROBUST Trigger Function (Swallows errors to prevent 500)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
DECLARE user_role TEXT;
user_phone TEXT;
user_name TEXT;
BEGIN -- Wrap in block to catch errors locally
BEGIN user_role := COALESCE(new.raw_user_meta_data->>'role', 'owner');
user_phone := COALESCE(new.phone, new.raw_user_meta_data->>'phone');
user_name := COALESCE(new.raw_user_meta_data->>'name', '');
-- Insert into accounts
INSERT INTO public.accounts (id, email, phone, role)
VALUES (new.id, new.email, user_phone, user_role) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
-- Role specific inserts
IF (user_role = 'admin') THEN
INSERT INTO public.admins (id, name, email)
VALUES (new.id, COALESCE(user_name, 'Admin'), new.email) ON CONFLICT (id) DO NOTHING;
ELSIF (user_role = 'owner') THEN
INSERT INTO public.owners (
        id,
        name,
        email,
        phone,
        bank_details,
        account_holder_name
    )
VALUES (
        new.id,
        COALESCE(user_name, 'Owner'),
        new.email,
        user_phone,
        COALESCE(
            (new.raw_user_meta_data->'bank_details')::jsonb,
            '{}'::jsonb
        ),
        new.raw_user_meta_data->>'account_holder_name'
    ) ON CONFLICT (id) DO NOTHING;
ELSE -- Customer
INSERT INTO public.customers (id, name, email, phone, city)
VALUES (
        new.id,
        user_name,
        new.email,
        user_phone,
        new.raw_user_meta_data->>'city'
    ) ON CONFLICT (id) DO NOTHING;
END IF;
EXCEPTION
WHEN OTHERS THEN -- CRITICAL: Log error but DO NOT FAIL the transaction
-- This ensures the 500 error is avoided and the user is created in Auth
INSERT INTO public.app_logs (message, details)
VALUES ('Trigger Failed for User: ' || new.id, SQLERRM);
END;
RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. Re-apply Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();