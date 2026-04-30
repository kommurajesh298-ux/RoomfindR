-- ==========================================
-- 🛠️ 406 ERROR RECOVERY SCRIPT
-- Specific fix for user: 0ce335df-3973-400c-8f77-d8e13b9e4d49
-- ==========================================
-- 1. Ensure the "Peace Treaty" is applied (Breaks Infinite Recursion)
-- If you haven't run the previous fix script, this will do it safely.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$ BEGIN RETURN (auth.jwt()->'user_metadata'->>'role') = 'admin';
END;
$$;
-- 2. RESET ACCOUNTS POLICIES (Simplify to prevent 406)
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins view all" ON public.accounts;
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
-- SAFE VIEW POLICY: No subqueries, no recursion.
CREATE POLICY "View own account" ON public.accounts FOR
SELECT TO authenticated USING (id = auth.uid());
-- SAFE ADMIN POLICY: Uses JWT metadata for speed and safety.
CREATE POLICY "Admins view all" ON public.accounts FOR
SELECT TO authenticated USING ((auth.jwt()->'user_metadata'->>'role') = 'admin');
-- 3. FORCED HEALING for the specific user
-- This ensures the record actually exists in the public table.
DO $$
DECLARE target_id UUID := '0ce335df-3973-400c-8f77-d8e13b9e4d49';
u_email TEXT;
u_phone TEXT;
u_role TEXT;
BEGIN -- Fetch from auth.users
SELECT email,
    phone,
    raw_user_meta_data->>'role' INTO u_email,
    u_phone,
    u_role
FROM auth.users
WHERE id = target_id;
IF u_email IS NOT NULL THEN
INSERT INTO public.accounts (id, email, phone, role, updated_at)
VALUES (
        target_id,
        u_email,
        u_phone,
        COALESCE(u_role, 'customer'),
        NOW()
    ) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
RAISE NOTICE 'Healed account for user %',
target_id;
ELSE RAISE NOTICE 'User % not found in auth.users',
target_id;
END IF;
END $$;
-- 4. Reload PostgREST Cache (Just in case)
NOTIFY pgrst,
'reload schema';
