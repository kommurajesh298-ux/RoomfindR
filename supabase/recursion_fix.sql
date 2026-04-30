-- ==========================================
-- 🛡️ RECURSION-FREE IDENTITY SHIELD (v8.2)
-- The definitive fix for the 500/Recursion error
-- ==========================================
-- 1. Create a Security Definer Helper (Bypasses RLS)
-- This function runs as the database owner, so it doesn't trigger RLS loops.
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID) RETURNS BOOLEAN AS $$ BEGIN RETURN EXISTS (
        SELECT 1
        FROM public.accounts
        WHERE id = user_id
            AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- 2. RESET ALL POLICIES ON ACCOUNTS
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
DROP POLICY IF EXISTS "Enable read access for all" ON public.accounts;
DROP POLICY IF EXISTS "Service role bypass" ON public.accounts;
-- 3. APPLY CLEAN, INDEPENDENT POLICIES
-- Policy 1: Users can see themselves (Non-recursive)
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT TO authenticated USING (id = auth.uid());
-- Policy 2: Admins can see everything (Uses the helper to avoid loop)
CREATE POLICY "Admins can view all accounts" ON public.accounts FOR
SELECT TO authenticated USING (public.is_admin(auth.uid()));
-- Policy 3: Allow profile healing (INSERT/UPDATE)
CREATE POLICY "Users can manage own account" ON public.accounts FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 4. APPLY TO ROLE TABLES TOO (To prevent cross-table recursion)
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage own profile" ON public.owners;
CREATE POLICY "Owners manage own profile" ON public.owners FOR ALL TO authenticated USING (id = auth.uid());
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Customers manage own profile" ON public.customers;
CREATE POLICY "Customers manage own profile" ON public.customers FOR ALL TO authenticated USING (id = auth.uid());
-- 5. THE HEALING RPC (Updated)
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
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
INSERT INTO public.accounts (id, email, phone, role)
VALUES (curr_id, curr_email, curr_phone, curr_role) ON CONFLICT (id) DO
UPDATE
SET email = curr_email,
    phone = curr_phone,
    role = curr_role;
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