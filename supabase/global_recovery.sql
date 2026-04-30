-- ==========================================
-- 🚀 GLOBAL DATA RECOVERY (v8.6) 🚀
-- Synchronizes EVERYTHING from Auth to Public
-- ==========================================
DO $$
DECLARE r RECORD;
BEGIN FOR r IN (
    SELECT id,
        email,
        phone,
        raw_user_meta_data
    FROM auth.users
) LOOP -- 1. Sync to Accounts (Resilient to Phone Conflicts)
BEGIN
INSERT INTO public.accounts (id, email, phone, role)
VALUES (
        r.id,
        r.email,
        COALESCE(r.phone, r.raw_user_meta_data->>'phone'),
        COALESCE(r.raw_user_meta_data->>'role', 'customer')
    ) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    phone = COALESCE(public.accounts.phone, EXCLUDED.phone),
    role = EXCLUDED.role;
EXCEPTION
WHEN unique_violation THEN -- If phone conflicts, try inserting/updating WITHOUT the phone
INSERT INTO public.accounts (id, email, role)
VALUES (
        r.id,
        r.email,
        COALESCE(r.raw_user_meta_data->>'role', 'customer')
    ) ON CONFLICT (id) DO
UPDATE
SET email = EXCLUDED.email,
    role = EXCLUDED.role;
END;
-- 2. Sync to Role Tables
IF (r.raw_user_meta_data->>'role' = 'owner') THEN BEGIN
INSERT INTO public.owners (
        id,
        name,
        email,
        phone,
        bank_details,
        account_holder_name
    )
VALUES (
        r.id,
        COALESCE(r.raw_user_meta_data->>'name', 'Owner'),
        r.email,
        COALESCE(r.phone, r.raw_user_meta_data->>'phone'),
        COALESCE(
            r.raw_user_meta_data->'bank_details',
            '{}'::jsonb
        ),
        COALESCE(
            r.raw_user_meta_data->'bank_details'->>'accountHolderName',
            r.raw_user_meta_data->>'name'
        )
    ) ON CONFLICT (id) DO
UPDATE
SET name = COALESCE(public.owners.name, EXCLUDED.name),
    email = EXCLUDED.email,
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
EXCEPTION
WHEN unique_violation THEN -- Skip phone on conflict
INSERT INTO public.owners (id, name, email, bank_details)
VALUES (
        r.id,
        COALESCE(r.raw_user_meta_data->>'name', 'Owner'),
        r.email,
        COALESCE(
            r.raw_user_meta_data->'bank_details',
            '{}'::jsonb
        )
    ) ON CONFLICT (id) DO
UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email;
END;
ELSIF (
    r.raw_user_meta_data->>'role' = 'customer'
    OR r.raw_user_meta_data->>'role' IS NULL
) THEN
INSERT INTO public.customers (id, name, email, phone)
VALUES (
        r.id,
        COALESCE(r.raw_user_meta_data->>'name', 'Customer'),
        r.email,
        COALESCE(r.phone, r.raw_user_meta_data->>'phone')
    ) ON CONFLICT (id) DO
UPDATE
SET name = COALESCE(public.customers.name, EXCLUDED.name),
    email = EXCLUDED.email,
    phone = COALESCE(public.customers.phone, EXCLUDED.phone);
END IF;
END LOOP;
END $$;
-- 3. FINAL VERIFICATION
SELECT id,
    email,
    phone,
    verification_status,
    account_holder_name
FROM public.owners;