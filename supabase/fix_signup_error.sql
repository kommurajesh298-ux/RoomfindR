-- Fix 500 Signup Error
-- 1. Ensure admins table exists (it was referenced in trigger but likely missing)
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Enable RLS on admins
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
-- 3. Fix the handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
DECLARE user_role TEXT;
user_phone TEXT;
user_name TEXT;
BEGIN -- Extract metadata safely
user_role := COALESCE(new.raw_user_meta_data->>'role', 'owner');
-- Prefer phone from Auth table, fallback to metadata
user_phone := COALESCE(new.phone, new.raw_user_meta_data->>'phone');
user_name := COALESCE(new.raw_user_meta_data->>'name', '');
-- Insert into accounts (Common for all roles)
-- We use ON CONFLICT DO UPDATE to handle rare race conditions or re-signups
INSERT INTO public.accounts (id, email, phone, role)
VALUES (
        new.id,
        new.email,
        user_phone,
        user_role
    ) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    updated_at = NOW();
-- Role specific inserts
IF (user_role = 'admin') THEN
INSERT INTO public.admins (id, name, email)
VALUES (
        new.id,
        COALESCE(user_name, 'Admin'),
        new.email
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    updated_at = NOW();
ELSIF (user_role = 'owner') THEN
INSERT INTO public.owners (
        id,
        name,
        email,
        phone,
        bank_details,
        account_holder_name
    )
VALUES (
        new.id,
        COALESCE(user_name, 'Owner'),
        new.email,
        user_phone,
        COALESCE(
            (new.raw_user_meta_data->'bank_details')::jsonb,
            '{}'::jsonb
        ),
        new.raw_user_meta_data->>'account_holder_name'
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    bank_details = EXCLUDED.bank_details,
    account_holder_name = EXCLUDED.account_holder_name,
    updated_at = NOW();
ELSE -- Default to customer
INSERT INTO public.customers (id, name, email, phone, city)
VALUES (
        new.id,
        user_name,
        new.email,
        user_phone,
        new.raw_user_meta_data->>'city'
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    city = EXCLUDED.city,
    updated_at = NOW();
END IF;
RETURN new;
EXCEPTION
WHEN OTHERS THEN -- Log error but don't output to user if possible, or raise to abort transaction
-- For debugging, we re-raise to see the error, but in prod we might want to handle gracefully
RAISE EXCEPTION 'Failed to create user profile: %',
SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;