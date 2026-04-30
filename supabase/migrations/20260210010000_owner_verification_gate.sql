-- Ensure owner verification starts as pending (no auto-approval)
-- and align existing records with verification_status.

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
-- Normalize existing owners: approved => verified, else not verified
UPDATE public.owners
SET verification_status = COALESCE(NULLIF(verification_status, ''), 'pending')
WHERE verification_status IS NULL OR verification_status = '';
UPDATE public.owners
SET verified = (verification_status = 'approved')
WHERE verified IS DISTINCT FROM (verification_status = 'approved');
DO $$
BEGIN
  IF to_regprocedure('public.is_owner_verified(uuid)') IS NOT NULL THEN
    UPDATE public.properties
    SET status = 'draft'
    WHERE status = 'published'
      AND NOT public.is_owner_verified(owner_id);
  END IF;
END $$;
