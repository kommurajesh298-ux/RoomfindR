-- ==========================================
-- CORRECTIVE FIX: ERROR PROPAGATING TRIGGER
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
DECLARE user_role TEXT;
user_phone TEXT;
user_name TEXT;
conflicting_id UUID;
BEGIN -- 1. Extract metadata
user_role := COALESCE(new.raw_user_meta_data->>'role', 'customer');
user_phone := COALESCE(new.phone, new.raw_user_meta_data->>'phone');
user_name := COALESCE(new.raw_user_meta_data->>'name', 'User');
-- 2. Proactive Cleanup: Check for conflicting phone number
IF user_phone IS NOT NULL
AND user_phone != '' THEN -- Find anyone else with this phone
SELECT id INTO conflicting_id
FROM public.accounts
WHERE (
        phone = user_phone
        OR phone = REPLACE(user_phone, '+91', '')
    )
    AND id != new.id
LIMIT 1;
IF conflicting_id IS NOT NULL THEN -- If the conflicting user DOES NOT exist in auth, they are a "zombie". Purge them.
IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = conflicting_id
) THEN
DELETE FROM public.accounts
WHERE id = conflicting_id;
-- Also clear from role tables just in case
DELETE FROM public.customers
WHERE id = conflicting_id;
DELETE FROM public.owners
WHERE id = conflicting_id;
ELSE -- If they ARE a real user, we let the INSERT fail naturally 
-- so the frontend catches the "Database error" and shows a warning.
NULL;
END IF;
END IF;
END IF;
-- 3. Perform the Insert
-- We do NOT wrap this in EXCEPTION because we WANT it to fail 
-- if it violates a real constraint (like an active user's phone).
INSERT INTO public.accounts (id, email, phone, role)
VALUES (new.id, new.email, user_phone, user_role) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
-- 4. Role specific inserts
IF (user_role = 'admin') THEN
INSERT INTO public.admins (id, name, email)
VALUES (new.id, user_name, new.email) ON CONFLICT (id) DO NOTHING;
ELSIF (user_role = 'owner') THEN
INSERT INTO public.owners (id, name, email, phone)
VALUES (new.id, user_name, new.email, user_phone) ON CONFLICT (id) DO NOTHING;
ELSE
INSERT INTO public.customers (id, name, email, phone, city)
VALUES (
        new.id,
        user_name,
        new.email,
        user_phone,
        new.raw_user_meta_data->>'city'
    ) ON CONFLICT (id) DO NOTHING;
END IF;
RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;