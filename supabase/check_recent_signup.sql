-- ==========================================
-- REAL-TIME SIGNUP CHECK
-- ==========================================
-- 1. Check the 3 most recent users in Auth
SELECT id,
    email,
    created_at,
    last_sign_in_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 3;
-- 2. Check if they have an 'accounts' row
SELECT id,
    email,
    phone,
    role,
    created_at
FROM public.accounts
ORDER BY created_at DESC
LIMIT 3;
-- 3. Check for any NEW errors in the logs
SELECT *
FROM public.app_logs
ORDER BY created_at DESC
LIMIT 5;
-- 4. Check for orphaned profile records
-- See if there's someone in owners/customers that isn't in accounts
SELECT 'Owner without Account' as type,
    o.id,
    o.email,
    o.phone
FROM public.owners o
    LEFT JOIN public.accounts a ON o.id = a.id
WHERE a.id IS NULL
UNION ALL
SELECT 'Customer without Account',
    c.id,
    c.email,
    c.phone
FROM public.customers c
    LEFT JOIN public.accounts a ON c.id = a.id
WHERE a.id IS NULL;