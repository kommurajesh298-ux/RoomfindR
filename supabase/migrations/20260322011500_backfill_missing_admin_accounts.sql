BEGIN;

DO $$
DECLARE
    admin_row RECORD;
    resolved_phone TEXT;
BEGIN
    FOR admin_row IN
        SELECT
            ad.id,
            public.normalize_contact_email(ad.email) AS email
        FROM public.admins ad
    LOOP
        SELECT public.normalize_contact_phone(
            COALESCE(
                NULLIF(a.phone, ''),
                NULLIF(u.phone, ''),
                NULLIF(u.raw_user_meta_data->>'phone', ''),
                NULLIF(u.raw_user_meta_data->>'phone_number', ''),
                NULLIF(u.raw_user_meta_data->>'mobile', ''),
                NULLIF(u.raw_user_meta_data->>'mobile_number', '')
            )
        )
        INTO resolved_phone
        FROM auth.users u
        LEFT JOIN public.accounts a ON a.id = u.id
        WHERE u.id = admin_row.id;

        IF resolved_phone IS NULL THEN
            RAISE WARNING 'Skipping admin % because no phone could be resolved from auth/users metadata.', admin_row.id;
            CONTINUE;
        END IF;

        INSERT INTO public.accounts (id, email, phone, role, updated_at)
        VALUES (admin_row.id, admin_row.email, resolved_phone, 'admin', NOW())
        ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            phone = COALESCE(EXCLUDED.phone, public.accounts.phone),
            role = 'admin',
            updated_at = NOW();
    END LOOP;
END
$$;

COMMIT;
