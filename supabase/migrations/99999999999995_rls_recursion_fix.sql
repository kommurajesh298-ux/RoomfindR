-- ==========================================
-- 🛡️ RECURSION PEACE TREATY V1
-- Resolves "infinite recursion detected in policy for relation accounts"
-- ==========================================
-- 1. Reset auth helpers to be RECURSION-PROOF
-- These now prioritize JWT metadata which is faster and doesn't trigger RLS loops.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$ BEGIN RETURN (auth.jwt()->'user_metadata'->>'role') = 'admin';
END;
$$;
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$ BEGIN RETURN (auth.jwt()->'user_metadata'->>'role') = 'owner';
END;
$$;
CREATE OR REPLACE FUNCTION public.is_customer() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$ BEGIN RETURN (auth.jwt()->'user_metadata'->>'role') = 'customer'
    OR (auth.jwt()->'user_metadata'->>'role') IS NULL;
-- Default role
END;
$$;
-- 2. Clean up 'accounts' policies (The core of the loop)
-- We remove all subqueries to other tables to break the loop.
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can manage own account" ON public.accounts;
DROP POLICY IF EXISTS "View own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins view all" ON public.accounts;
-- 🛡️ SAFE POLICY 1: View own record (Identity based)
CREATE POLICY "View own account" ON public.accounts FOR
SELECT TO authenticated USING (id = auth.uid());
-- 🛡️ SAFE POLICY 2: Admins view all (Metadata based - NO RECURSION)
CREATE POLICY "Admins view all" ON public.accounts FOR
SELECT TO authenticated USING ((auth.jwt()->'user_metadata'->>'role') = 'admin');
-- 🛡️ SAFE POLICY 3: Full management for self
CREATE POLICY "Manage own account" ON public.accounts FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 3. Update 'admins' table to avoid calling accounts
-- If admins exists, ensure it doesn't loop back.
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage admins" ON public.admins;
CREATE POLICY "Admins can manage admins" ON public.admins FOR ALL TO authenticated USING ((auth.jwt()->'user_metadata'->>'role') = 'admin');
-- 4. Final verification
SELECT proname as helper_fixed,
    prosecdef as definer
FROM pg_proc
WHERE proname IN ('is_admin', 'is_owner', 'is_customer');
