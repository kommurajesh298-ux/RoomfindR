-- ==========================================
-- 🛡️ HARDENED PROFILE HEALING V2
-- Prevents 409 Conflicts by cleaning orphaned records
-- and returning descriptive JSON errors.
-- ==========================================
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
meta_phone TEXT;
meta_city TEXT;
conflicting_id UUID;
BEGIN curr_id := auth.uid();
IF curr_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Not Authenticated');
END IF;
-- 1. Get raw user data from Auth
SELECT email,
    phone,
    (raw_user_meta_data->>'role')::text,
    (raw_user_meta_data->>'name')::text,
    (raw_user_meta_data->>'phone')::text,
    (raw_user_meta_data->>'city')::text INTO curr_email,
    curr_phone,
    curr_role,
    curr_name,
    meta_phone,
    meta_city
FROM auth.users
WHERE id = curr_id;
IF NOT FOUND THEN RETURN jsonb_build_object(
    'success',
    false,
    'message',
    'User Not Found',
    'detail',
    'The authenticated user ID was not found in the identity provider.'
);
END IF;
-- Priority for identification: Auth phone > Metadata phone
curr_phone := COALESCE(curr_phone, meta_phone);
curr_role := COALESCE(curr_role, 'customer');
curr_name := COALESCE(curr_name, 'User');
-- 🛡️ SELF-CLEANING: Find and delete ORPHANED records in accounts that conflict with our email/phone
DELETE FROM public.accounts
WHERE id != curr_id
    AND (
        (
            email IS NOT NULL
            AND email = curr_email
        )
        OR (
            phone IS NOT NULL
            AND phone = curr_phone
        )
    )
    AND id NOT IN (
        SELECT id
        FROM auth.users
    );
-- 🛡️ CONFLICT CHECK: See if we STILL have a conflict with an ACTIVE user
SELECT id INTO conflicting_id
FROM public.accounts
WHERE id != curr_id
    AND (
        (
            email IS NOT NULL
            AND email = curr_email
        )
        OR (
            phone IS NOT NULL
            AND phone = curr_phone
        )
    )
LIMIT 1;
IF conflicting_id IS NOT NULL THEN RETURN jsonb_build_object(
    'success',
    false,
    'message',
    'Identity Conflict',
    'detail',
    'Your email or phone is already linked to another active account.'
);
END IF;
-- 2. Repair/Create Public Account record
INSERT INTO public.accounts (id, email, phone, role)
VALUES (curr_id, curr_email, curr_phone, curr_role) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
-- 3. Repair/Create Role-Specific record
IF curr_role = 'admin' THEN
INSERT INTO public.admins (id, name, email)
VALUES (curr_id, curr_name, curr_email) ON CONFLICT (id) DO NOTHING;
ELSIF curr_role = 'owner' THEN
INSERT INTO public.owners (id, name, email, phone)
VALUES (curr_id, curr_name, curr_email, curr_phone) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    updated_at = NOW();
ELSE -- Default to customer
INSERT INTO public.customers (id, name, email, phone, city)
VALUES (
        curr_id,
        curr_name,
        curr_email,
        curr_phone,
        meta_city
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    city = EXCLUDED.city,
    updated_at = NOW();
END IF;
RETURN jsonb_build_object(
    'success',
    true,
    'repaired_account',
    true,
    'role',
    curr_role,
    'email',
    curr_email
);
END;
$$;
