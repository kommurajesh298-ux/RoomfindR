-- ==========================================
-- RLS RECURSION REPAIR (v8.1)
-- ==========================================
-- 1. HARDEN HELPER FUNCTIONS
-- Explicitly set search_path to prevent recursion/impersonation issues
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID) RETURNS TEXT AS $$ BEGIN RETURN (
        SELECT role
        FROM public.accounts
        WHERE id = user_id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$ BEGIN RETURN public.get_user_role(auth.uid()) = 'admin';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;
-- 2. RESET ACCOUNTS POLICIES
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Users can view their own account" ON public.accounts;
DROP POLICY IF EXISTS "Users can create own account" ON public.accounts;
DROP POLICY IF EXISTS "Users can update own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can manage all accounts" ON public.accounts;
-- 3. RE-IMPLEMENT CLEAN POLICIES
-- SELECT: Only own row OR if admin
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT USING (
        auth.uid() = id
        OR public.is_admin()
    );
-- INSERT: Only own UID
CREATE POLICY "Users can create own account" ON public.accounts FOR
INSERT WITH CHECK (auth.uid() = id);
-- UPDATE: Only own row, and non-admins CANNOT change their role
CREATE POLICY "Users can update own account" ON public.accounts FOR
UPDATE USING (auth.uid() = id) WITH CHECK (
        auth.uid() = id
        AND (
            (
                CASE
                    WHEN public.is_admin() THEN TRUE
                    ELSE role = public.get_user_role(auth.uid())
                END
            )
        )
    );
-- ADMIN: Full access
CREATE POLICY "Admins can manage all accounts" ON public.accounts FOR ALL USING (public.is_admin());
-- 4. FINAL VERIFICATION
SELECT 'RLS Repaired!' as status,
    count(*) as policy_count
FROM pg_policies
WHERE tablename = 'accounts';