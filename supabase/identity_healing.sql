-- ==========================================
-- 🛡️ IDENTITY HEALING & RLS SHIELD (v8.1)
-- Breaks recursion, fixes 406, and repairs profiles
-- ==========================================
-- 1. BREAK THE RECURSION (The Core Fix)
-- Use a non-recursive version of get_user_role that checks metadata first
CREATE OR REPLACE FUNCTION public.get_safe_user_role(target_id UUID) RETURNS TEXT AS $$
DECLARE role_val TEXT;
BEGIN -- Prefer role from accounts table
SELECT role INTO role_val
FROM public.accounts
WHERE id = target_id;
-- Fallback to metadata if not in accounts yet
IF role_val IS NULL THEN
SELECT raw_user_meta_data->>'role' INTO role_val
FROM auth.users
WHERE id = target_id;
END IF;
RETURN COALESCE(role_val, 'customer');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- 2. RESET POLICIES (Stop the loop)
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT TO authenticated USING (
        id = auth.uid()
        OR (
            auth.jwt()->>'email' IN (
                SELECT email
                FROM public.admins
            )
        )
    );
-- 3. THE REPAIR RPC
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
acc_exists BOOLEAN;
BEGIN curr_id := auth.uid();
IF curr_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'No UID');
END IF;
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
-- Insert/Update Account
INSERT INTO public.accounts (id, email, phone, role)
VALUES (curr_id, curr_email, curr_phone, curr_role) ON CONFLICT (id) DO
UPDATE
SET email = curr_email,
    phone = curr_phone,
    role = curr_role;
-- Ensure Role Profile Exists
IF curr_role = 'owner' THEN
INSERT INTO public.owners (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO NOTHING;
ELSIF curr_role = 'customer' THEN
INSERT INTO public.customers (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO NOTHING;
END IF;
RETURN jsonb_build_object('success', true, 'role', curr_role);
END;
$$;
GRANT EXECUTE ON FUNCTION public.repair_my_profile() TO authenticated;