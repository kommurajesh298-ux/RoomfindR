-- ==========================================
-- 🛡️ HARDEN OWNER APPROVAL MIGRATION
-- Enables RLS and ensures Admin/Owner permissions
-- ==========================================
-- 1. Enable RLS on owners table
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
-- 2. RESET POLICIES (Start from clean slate)
DROP POLICY IF EXISTS "Admins can manage all owners" ON public.owners;
DROP POLICY IF EXISTS "Owners can view own profile" ON public.owners;
DROP POLICY IF EXISTS "Owners can update own profile" ON public.owners;
DROP POLICY IF EXISTS "Public can view owners" ON public.owners;
-- 3. ADMIN POLICY: Full power
-- Uses JWT metadata for speed and to avoid recursion
CREATE POLICY "Admins can manage all owners" ON public.owners FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- 4. OWNER POLICY: Self-management
CREATE POLICY "Owners can view own profile" ON public.owners FOR
SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Owners can update own profile" ON public.owners FOR
UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 5. HEALING: Ensure existing admins have proper metadata
-- NOTE: This requires manual execution or a script that loops through admins.
-- For now, we provide the logic to fix the master admin if needed.
DO $$
DECLARE target_email TEXT := 'kommurajesh298@gmail.com';
target_id UUID;
BEGIN
SELECT id INTO target_id
FROM auth.users
WHERE email = target_email;
IF target_id IS NOT NULL THEN -- Force metadata update
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data || '{"role": "admin"}'::jsonb
WHERE id = target_id;
-- Ensure public.accounts is in sync
INSERT INTO public.accounts (id, email, role, updated_at)
VALUES (target_id, target_email, 'admin', NOW()) ON CONFLICT (id) DO
UPDATE
SET role = 'admin',
    updated_at = NOW();
-- Ensure public.admins is in sync
INSERT INTO public.admins (id, name, email, updated_at)
VALUES (target_id, 'Master Admin', target_email, NOW()) ON CONFLICT (id) DO NOTHING;
RAISE NOTICE 'Healed Master Admin: %',
target_email;
END IF;
END $$;
