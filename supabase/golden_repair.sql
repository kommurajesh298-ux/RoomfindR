-- ==========================================
-- 🛡️ GOLDEN IDENTITY REPAIR (v8.5)
-- No Recursion. No Overwrites. 100% Data Safety.
-- ==========================================
-- 1. KILL RECURSION (Metadata-Only Mode)
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
DROP POLICY IF EXISTS "Admins can view all accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can manage own account" ON public.accounts;
-- Policy A: You can ALWAYS see your own row
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT TO authenticated USING (id = auth.uid());
-- Policy B: Admins see all (uses JWT metadata - 0% RECURSION)
CREATE POLICY "Admins can view all accounts" ON public.accounts FOR
SELECT TO authenticated USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );
-- Policy C: Allow Healing (Manage own row)
CREATE POLICY "Users can manage own account" ON public.accounts FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 2. SECURE ROLE TABLES (No Cross-Table Checks)
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage own profile" ON public.owners;
CREATE POLICY "Owners manage own profile" ON public.owners FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Customers manage own profile" ON public.customers;
CREATE POLICY "Customers manage own profile" ON public.customers FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 3. THE GOLDEN REPAIR RPC (Non-Destructive)
-- This only fills in MISSING data. It will NEVER overwrite with NULL.
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
-- Extract from Auth
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
-- Update Accounts (Only if row missing or phone is null)
INSERT INTO public.accounts (id, email, phone, role)
VALUES (curr_id, curr_email, curr_phone, curr_role) ON CONFLICT (id) DO
UPDATE
SET email = COALESCE(public.accounts.email, EXCLUDED.email),
    phone = COALESCE(public.accounts.phone, EXCLUDED.phone),
    role = COALESCE(public.accounts.role, EXCLUDED.role);
-- Update Role Table (Additive Only)
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
        curr_bank->>'accountHolderName'
    ) ON CONFLICT (id) DO
UPDATE
SET name = COALESCE(public.owners.name, EXCLUDED.name),
    email = COALESCE(public.owners.email, EXCLUDED.email),
    phone = COALESCE(public.owners.phone, EXCLUDED.phone),
    bank_details = CASE
        WHEN (
            public.owners.bank_details IS NULL
            OR public.owners.bank_details = '{}'::jsonb
        ) THEN EXCLUDED.bank_details
        ELSE public.owners.bank_details
    END,
    account_holder_name = COALESCE(
        public.owners.account_holder_name,
        EXCLUDED.account_holder_name
    );
ELSIF curr_role = 'customer' THEN
INSERT INTO public.customers (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO
UPDATE
SET name = COALESCE(public.customers.name, EXCLUDED.name),
    email = COALESCE(public.customers.email, EXCLUDED.email),
    phone = COALESCE(public.customers.phone, EXCLUDED.phone);
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