CREATE OR REPLACE FUNCTION get_user_role(user_id UUID) RETURNS TEXT AS $$
BEGIN
    RETURN (SELECT role FROM public.accounts WHERE id = user_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_user_role(auth.uid()) = 'admin';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
CREATE OR REPLACE FUNCTION is_owner() RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_user_role(auth.uid()) = 'owner';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
CREATE OR REPLACE FUNCTION is_customer() RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_user_role(auth.uid()) = 'customer';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION get_user_role(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_customer() TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.check_user_exists(text, text);
CREATE OR REPLACE FUNCTION public.check_user_exists(email_val text, phone_val text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_email text := NULLIF(TRIM(email_val), '');
    v_phone text := NULLIF(TRIM(phone_val), '');
    email_exists boolean := false;
    phone_exists boolean := false;
BEGIN
    IF v_email IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM auth.users WHERE lower(email) = lower(v_email)) INTO email_exists;
        IF NOT email_exists THEN
            SELECT EXISTS(SELECT 1 FROM public.accounts WHERE lower(email) = lower(v_email)) INTO email_exists;
        END IF;
    END IF;

    IF v_phone IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM auth.users WHERE phone = v_phone) INTO phone_exists;
        IF NOT phone_exists THEN
            SELECT EXISTS(SELECT 1 FROM public.accounts WHERE phone = v_phone) INTO phone_exists;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'emailExists', COALESCE(email_exists, false),
        'phoneExists', COALESCE(phone_exists, false)
    );
END;
$$;
DROP FUNCTION IF EXISTS public.repair_my_profile();
CREATE OR REPLACE FUNCTION public.repair_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    u record;
    role_val text;
BEGIN
    SELECT id, email, phone, raw_user_meta_data, raw_app_meta_data
      INTO u
      FROM auth.users
     WHERE id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No authenticated user';
    END IF;

    role_val := COALESCE(u.raw_user_meta_data->>'role', u.raw_app_meta_data->>'role', 'customer');

    INSERT INTO public.accounts (id, email, phone, role, updated_at)
    VALUES (u.id, u.email, u.phone, role_val, NOW())
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            role = EXCLUDED.role,
            updated_at = NOW();

    IF role_val = 'customer' THEN
        INSERT INTO public.customers (id, email, phone, name, updated_at)
        VALUES (u.id, u.email, u.phone, COALESCE(u.raw_user_meta_data->>'name','User'), NOW())
        ON CONFLICT (id) DO UPDATE
            SET email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                name = EXCLUDED.name,
                updated_at = NOW();
    ELSIF role_val = 'owner' THEN
        INSERT INTO public.owners (id, email, phone, name, verified, verification_status, updated_at)
        VALUES (u.id, u.email, u.phone, COALESCE(u.raw_user_meta_data->>'name','Owner'), true, 'approved', NOW())
        ON CONFLICT (id) DO UPDATE
            SET email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                name = EXCLUDED.name,
                updated_at = NOW();
    ELSIF role_val = 'admin' THEN
        INSERT INTO public.admins (id, email, name, updated_at)
        VALUES (u.id, u.email, COALESCE(u.raw_user_meta_data->>'name','Admin'), NOW())
        ON CONFLICT (id) DO UPDATE
            SET email = EXCLUDED.email,
                name = EXCLUDED.name,
                updated_at = NOW();
    END IF;

    RETURN jsonb_build_object('success', true, 'role', role_val);
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_user_exists(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_my_profile() TO authenticated;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
CREATE POLICY "Users can view own account" ON public.accounts FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS "Users can update own account" ON public.accounts;
CREATE POLICY "Users can update own account" ON public.accounts FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
