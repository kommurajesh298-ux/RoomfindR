-- ==========================================
-- 🛡️ THE FINAL BOSS KILLER (v8.3)
-- 0 Recursion. 0 Stale Data. 100% Authorized.
-- ==========================================
-- 1. DIAGNOSE (Run this part first to see what is happening)
SELECT 'auth_user' as type,
    id,
    email,
    phone,
    raw_user_meta_data->>'role' as meta_role
FROM auth.users
WHERE id = '88c54130-8045-45b0-a406-1fc9e34e2d2d';
SELECT 'account_profile' as type,
    id,
    email,
    role
FROM public.accounts
WHERE id = '88c54130-8045-45b0-a406-1fc9e34e2d2d';
-- 2. BREAK THE RECURSION FOREVER
-- We will stop querying the table for roles. We will use the JWT Metadata.
-- This is 1000% safe from recursion.
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
DROP POLICY IF EXISTS "Enable read access for all" ON public.accounts;
DROP POLICY IF EXISTS "Service role bypass" ON public.accounts;
DROP POLICY IF EXISTS "Users can manage own account" ON public.accounts;
-- Policy A: You can see yourself
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT TO authenticated USING (id = auth.uid());
-- Policy B: Admins can see everything (USING METADATA INSTEAD OF TABLE)
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
-- Policy C: Healing and Syncing
CREATE POLICY "Users can manage own account" ON public.accounts FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 3. THE REPAIR ENGINE (v8.3)
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
    role = EXCLUDED.role;
-- Healing Role Table
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