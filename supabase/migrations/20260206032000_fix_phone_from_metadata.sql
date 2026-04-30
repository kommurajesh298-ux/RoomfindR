BEGIN;
-- Update repair_my_profile to pull phone from metadata when auth.users.phone is null
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
COMMIT;
