-- ==========================================
-- 🛡️ ULTIMATE IDENTITY SHIELD & SYNC (v8.4)
-- Fixes Data Storage, RLS, and Phone Sync
-- ==========================================
-- 1. CLEAN UP PREVIOUS POLICIES (All Tables)
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can manage own account" ON public.accounts;
DROP POLICY IF EXISTS "Owners manage own profile" ON public.owners;
DROP POLICY IF EXISTS "Admins view all owners" ON public.owners;
DROP POLICY IF EXISTS "Customers manage own profile" ON public.customers;
DROP POLICY IF EXISTS "Admins view all customers" ON public.customers;
-- 2. APPLY RECURSION-FREE RLS (Accounts)
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT TO authenticated USING (id = auth.uid());
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
CREATE POLICY "Users manage own account" ON public.accounts FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 3. APPLY RLS (Owners & Customers)
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage own profile" ON public.owners FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers manage own profile" ON public.customers FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 4. THE MASTER REPAIR ENGINE (v8.4)
-- This extracts EVERYTHING from the Auth metadata to ensure no data loss.
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
curr_bank JSONB;
BEGIN curr_id := auth.uid();
IF curr_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'No UID');
END IF;
-- Extract from Auth metadata (where the app stores it during signup)
SELECT email,
    COALESCE(phone, raw_user_meta_data->>'phone'),
    raw_user_meta_data->>'role',
    raw_user_meta_data->>'name',
    raw_user_meta_data->'bank_details' INTO curr_email,
    curr_phone,
    curr_role,
    curr_name,
    curr_bank
FROM auth.users
WHERE id = curr_id;
curr_role := COALESCE(curr_role, 'customer');
curr_name := COALESCE(curr_name, 'User');
-- Update Accounts (ID is unique)
INSERT INTO public.accounts (id, email, phone, role)
VALUES (curr_id, curr_email, curr_phone, curr_role) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role;
-- Update Role Table
IF curr_role = 'owner' THEN
INSERT INTO public.owners (
        id,
        name,
        email,
        phone,
        bank_details,
        account_holder_name
    )
VALUES (
        curr_id,
        curr_name,
        curr_email,
        curr_phone,
        curr_bank,
        COALESCE(curr_bank->>'accountHolderName', curr_name)
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    bank_details = EXCLUDED.bank_details,
    account_holder_name = EXCLUDED.account_holder_name;
ELSIF curr_role = 'customer' THEN
INSERT INTO public.customers (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone;
END IF;
RETURN jsonb_build_object(
    'success',
    true,
    'repaired',
    true,
    'role',
    curr_role
);
END;
$$;
GRANT EXECUTE ON FUNCTION public.repair_my_profile() TO authenticated;