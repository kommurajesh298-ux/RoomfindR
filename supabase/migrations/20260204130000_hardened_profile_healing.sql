-- ==========================================
-- 🛡️ HARDENED PROFILE HEALING MIGRATION
-- Ensures profiles are healed if role-specific records are missing
-- ==========================================
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
repaired_account BOOLEAN := FALSE;
repaired_role BOOLEAN := FALSE;
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
    role = EXCLUDED.role,
    updated_at = NOW()
WHERE accounts.email IS DISTINCT
FROM EXCLUDED.email
    OR accounts.phone IS DISTINCT
FROM EXCLUDED.phone
    OR accounts.role IS DISTINCT
FROM EXCLUDED.role;
IF FOUND THEN repaired_account := TRUE;
END IF;
-- Healing Role Tables
IF curr_role = 'owner' THEN
INSERT INTO public.owners (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO NOTHING;
IF FOUND THEN repaired_role := TRUE;
END IF;
ELSIF curr_role = 'customer' THEN
INSERT INTO public.customers (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO NOTHING;
IF FOUND THEN repaired_role := TRUE;
END IF;
ELSIF curr_role = 'admin' THEN
INSERT INTO public.admins (id, name, email)
VALUES (curr_id, curr_name, curr_email) ON CONFLICT (id) DO NOTHING;
IF FOUND THEN repaired_role := TRUE;
END IF;
END IF;
RETURN jsonb_build_object(
    'success',
    true,
    'repaired_id',
    curr_id,
    'role',
    curr_role,
    'repaired_account',
    repaired_account,
    'repaired_role',
    repaired_role
);
END;
$$;
