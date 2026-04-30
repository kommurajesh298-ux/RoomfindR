-- ==========================================
-- IDENTITY REPAIR SYSTEM (v8.1)
-- Fixes broken profiles without deleting data
-- ==========================================
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
acc_exists BOOLEAN;
BEGIN -- 1. Get current authenticated user details from Auth
curr_id := auth.uid();
IF curr_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
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
-- Defaults
curr_role := COALESCE(curr_role, 'customer');
curr_name := COALESCE(curr_name, 'User');
-- 2. Check and Create Accounts Profile
SELECT EXISTS (
        SELECT 1
        FROM public.accounts
        WHERE id = curr_id
    ) INTO acc_exists;
IF NOT acc_exists THEN -- Attempt to create the missing row
BEGIN
INSERT INTO public.accounts (id, email, phone, role)
VALUES (curr_id, curr_email, curr_phone, curr_role) ON CONFLICT (id) DO
UPDATE
SET email = curr_email,
    phone = curr_phone,
    role = curr_role;
EXCEPTION
WHEN OTHERS THEN -- If it fails (likely phone conflict), we log it but continue
INSERT INTO public.app_logs (message, details)
VALUES ('Repair Failed for Account', SQLERRM);
END;
END IF;
-- 3. Role-Specific Repair
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
    'repaired',
    NOT acc_exists,
    'role',
    curr_role
);
END;
$$;
-- Grant execution
GRANT EXECUTE ON FUNCTION public.repair_my_profile() TO authenticated;