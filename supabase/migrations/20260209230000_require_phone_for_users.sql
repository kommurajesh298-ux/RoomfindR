BEGIN;
-- Enforce phone requirement for new users
CREATE OR REPLACE FUNCTION public.repair_my_profile() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE curr_id UUID;
curr_email TEXT;
curr_phone TEXT;
curr_role TEXT;
curr_name TEXT;
BEGIN
  curr_id := auth.uid();
  IF curr_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'No Login Found');
  END IF;

  SELECT email,
         COALESCE(
           NULLIF(phone, ''),
           NULLIF(raw_user_meta_data->>'phone', ''),
           NULLIF(raw_user_meta_data->>'phone_number', ''),
           NULLIF(raw_user_meta_data->>'mobile', ''),
           NULLIF(raw_user_meta_data->>'mobile_number', '')
         ),
         raw_user_meta_data->>'role',
         raw_user_meta_data->>'name'
    INTO curr_email, curr_phone, curr_role, curr_name
  FROM auth.users
  WHERE id = curr_id;

  curr_phone := NULLIF(trim(curr_phone), '');
  IF curr_phone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'PHONE_REQUIRED');
  END IF;

  curr_role := COALESCE(curr_role, 'customer');
  curr_name := COALESCE(curr_name, 'User');

  INSERT INTO public.accounts (id, email, phone, role)
  VALUES (curr_id, curr_email, curr_phone, curr_role)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      phone = COALESCE(EXCLUDED.phone, public.accounts.phone),
      role = EXCLUDED.role,
      updated_at = NOW();

  IF curr_role = 'owner' THEN
    INSERT INTO public.owners (id, name, email, phone)
    VALUES (curr_id, curr_name, curr_email, curr_phone)
    ON CONFLICT (id) DO NOTHING;
  ELSIF curr_role = 'customer' THEN
    INSERT INTO public.customers (id, name, email, phone)
    VALUES (curr_id, curr_name, curr_email, curr_phone)
    ON CONFLICT (id) DO NOTHING;
  ELSIF curr_role = 'admin' THEN
    INSERT INTO public.admins (id, name, email, created_at, updated_at)
    VALUES (curr_id, COALESCE(curr_name, 'Admin'), curr_email, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success',
    true,
    'repaired_id',
    curr_id,
    'role',
    curr_role
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.repair_my_profile() TO authenticated, service_role;
-- Auth trigger: require phone at signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    role_val TEXT;
    name_val TEXT;
    phone_val TEXT;
BEGIN
    role_val := COALESCE(new.raw_user_meta_data->>'role', new.raw_app_meta_data->>'role', 'customer');
    name_val := COALESCE(new.raw_user_meta_data->>'name', new.raw_app_meta_data->>'name', 'User');
    phone_val := COALESCE(
      NULLIF(new.phone, ''),
      NULLIF(new.raw_user_meta_data->>'phone', ''),
      NULLIF(new.raw_user_meta_data->>'phone_number', ''),
      NULLIF(new.raw_user_meta_data->>'mobile', ''),
      NULLIF(new.raw_user_meta_data->>'mobile_number', '')
    );
    phone_val := NULLIF(trim(phone_val), '');

    IF phone_val IS NULL THEN
        RAISE EXCEPTION 'PHONE_REQUIRED';
    END IF;

    BEGIN
        INSERT INTO public.accounts (id, email, phone, role, updated_at)
        VALUES (new.id, new.email, phone_val, role_val, NOW())
        ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            phone = COALESCE(EXCLUDED.phone, public.accounts.phone),
            role = EXCLUDED.role,
            updated_at = NOW();
    EXCEPTION WHEN OTHERS THEN
        -- Never block signup on profile insert failures
        NULL;
    END;

    IF role_val = 'admin' THEN
        BEGIN
            INSERT INTO public.admins (id, name, email, updated_at)
            VALUES (new.id, COALESCE(name_val, 'Admin'), new.email, NOW())
            ON CONFLICT (id) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    ELSIF role_val = 'owner' THEN
        BEGIN
            INSERT INTO public.owners (id, name, email, phone, verified, verification_status, updated_at)
            VALUES (new.id, COALESCE(name_val, 'Owner'), new.email, phone_val, FALSE, 'pending', NOW())
            ON CONFLICT (id) DO UPDATE
            SET email = EXCLUDED.email,
                phone = COALESCE(EXCLUDED.phone, public.owners.phone),
                name = EXCLUDED.name,
                updated_at = NOW();
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    ELSE
        BEGIN
            INSERT INTO public.customers (id, name, email, phone, updated_at)
            VALUES (new.id, COALESCE(name_val, 'User'), new.email, phone_val, NOW())
            ON CONFLICT (id) DO UPDATE
            SET email = EXCLUDED.email,
                phone = COALESCE(EXCLUDED.phone, public.customers.phone),
                name = EXCLUDED.name,
                updated_at = NOW();
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    RETURN new;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- Backfill accounts phone from auth.users metadata when missing
UPDATE public.accounts a
SET phone = COALESCE(
  NULLIF(u.phone, ''),
  NULLIF(u.raw_user_meta_data->>'phone', ''),
  NULLIF(u.raw_user_meta_data->>'phone_number', ''),
  NULLIF(u.raw_user_meta_data->>'mobile', ''),
  NULLIF(u.raw_user_meta_data->>'mobile_number', '')
)
FROM auth.users u
WHERE a.id = u.id
  AND (a.phone IS NULL OR a.phone = '')
  AND COALESCE(
    NULLIF(u.phone, ''),
    NULLIF(u.raw_user_meta_data->>'phone', ''),
    NULLIF(u.raw_user_meta_data->>'phone_number', ''),
    NULLIF(u.raw_user_meta_data->>'mobile', ''),
    NULLIF(u.raw_user_meta_data->>'mobile_number', '')
  ) IS NOT NULL;
-- Sync role tables if their phone is missing
UPDATE public.customers c
SET phone = a.phone
FROM public.accounts a
WHERE c.id = a.id
  AND (c.phone IS NULL OR c.phone = '')
  AND a.phone IS NOT NULL;
UPDATE public.owners o
SET phone = a.phone
FROM public.accounts a
WHERE o.id = a.id
  AND (o.phone IS NULL OR o.phone = '')
  AND a.phone IS NOT NULL;
-- Enforce phone requirement for new rows (existing NULLs allowed until fixed)
DO $$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_phone_required CHECK (phone IS NOT NULL AND phone <> '') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.customers ADD CONSTRAINT customers_phone_required CHECK (phone IS NOT NULL AND phone <> '') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.owners ADD CONSTRAINT owners_phone_required CHECK (phone IS NOT NULL AND phone <> '') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
