BEGIN;

INSERT INTO public.accounts (id, email, phone, role, account_status, updated_at)
SELECT
    c.id,
    public.normalize_contact_email(c.email) AS email,
    public.normalize_contact_phone(
        COALESCE(
            NULLIF(c.phone, ''),
            NULLIF(u.phone, ''),
            NULLIF(u.raw_user_meta_data->>'phone', ''),
            NULLIF(u.raw_user_meta_data->>'phone_number', ''),
            NULLIF(u.raw_user_meta_data->>'mobile', ''),
            NULLIF(u.raw_user_meta_data->>'mobile_number', '')
        )
    ) AS phone,
    'customer' AS role,
    'active' AS account_status,
    NOW() AS updated_at
FROM public.customers c
LEFT JOIN auth.users u ON u.id = c.id
LEFT JOIN public.accounts a ON a.id = c.id
WHERE a.id IS NULL
  AND public.normalize_contact_phone(
      COALESCE(
          NULLIF(c.phone, ''),
          NULLIF(u.phone, ''),
          NULLIF(u.raw_user_meta_data->>'phone', ''),
          NULLIF(u.raw_user_meta_data->>'phone_number', ''),
          NULLIF(u.raw_user_meta_data->>'mobile', ''),
          NULLIF(u.raw_user_meta_data->>'mobile_number', '')
      )
  ) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.accounts (id, email, phone, role, account_status, updated_at)
SELECT
    o.id,
    public.normalize_contact_email(o.email) AS email,
    public.normalize_contact_phone(
        COALESCE(
            NULLIF(o.phone, ''),
            NULLIF(u.phone, ''),
            NULLIF(u.raw_user_meta_data->>'phone', ''),
            NULLIF(u.raw_user_meta_data->>'phone_number', ''),
            NULLIF(u.raw_user_meta_data->>'mobile', ''),
            NULLIF(u.raw_user_meta_data->>'mobile_number', '')
        )
    ) AS phone,
    'owner' AS role,
    CASE
        WHEN COALESCE(o.verified, FALSE)
          OR LOWER(COALESCE(o.verification_status, '')) = 'approved'
          OR LOWER(COALESCE(o.bank_verification_status, '')) = 'verified'
          OR LOWER(COALESCE(o.cashfree_status, '')) = 'success'
          OR COALESCE(o.bank_verified, FALSE)
          THEN 'active'
        WHEN LOWER(COALESCE(o.verification_status, '')) IN ('blocked', 'rejected', 'suspended')
          THEN 'blocked'
        ELSE 'pending_admin_approval'
    END AS account_status,
    NOW() AS updated_at
FROM public.owners o
LEFT JOIN auth.users u ON u.id = o.id
LEFT JOIN public.accounts a ON a.id = o.id
WHERE a.id IS NULL
  AND public.normalize_contact_phone(
      COALESCE(
          NULLIF(o.phone, ''),
          NULLIF(u.phone, ''),
          NULLIF(u.raw_user_meta_data->>'phone', ''),
          NULLIF(u.raw_user_meta_data->>'phone_number', ''),
          NULLIF(u.raw_user_meta_data->>'mobile', ''),
          NULLIF(u.raw_user_meta_data->>'mobile_number', '')
      )
  ) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.accounts (id, email, phone, role, account_status, updated_at)
SELECT
    ad.id,
    public.normalize_contact_email(ad.email) AS email,
    public.normalize_contact_phone(
        COALESCE(
            NULLIF(u.phone, ''),
            NULLIF(u.raw_user_meta_data->>'phone', ''),
            NULLIF(u.raw_user_meta_data->>'phone_number', ''),
            NULLIF(u.raw_user_meta_data->>'mobile', ''),
            NULLIF(u.raw_user_meta_data->>'mobile_number', '')
        )
    ) AS phone,
    'admin' AS role,
    'active' AS account_status,
    NOW() AS updated_at
FROM public.admins ad
LEFT JOIN auth.users u ON u.id = ad.id
LEFT JOIN public.accounts a ON a.id = ad.id
WHERE a.id IS NULL
  AND public.normalize_contact_phone(
      COALESCE(
          NULLIF(u.phone, ''),
          NULLIF(u.raw_user_meta_data->>'phone', ''),
          NULLIF(u.raw_user_meta_data->>'phone_number', ''),
          NULLIF(u.raw_user_meta_data->>'mobile', ''),
          NULLIF(u.raw_user_meta_data->>'mobile_number', '')
      )
  ) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;
