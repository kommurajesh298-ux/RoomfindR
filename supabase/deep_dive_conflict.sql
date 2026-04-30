-- ==========================================
-- DEEP DIVE: FIND THE HIDDEN DUPLICATE
-- ==========================================
-- 1. Search for ALL variations of the phone 7674962641
-- This will find if it exists with or without +91 or formatting
SELECT 'Accounts' as source,
    id,
    email,
    phone,
    role
FROM public.accounts
WHERE phone LIKE '%7674962641%';
SELECT 'Owners' as source,
    id,
    email,
    phone
FROM public.owners
WHERE phone LIKE '%7674962641%';
SELECT 'Customers' as source,
    id,
    email,
    phone
FROM public.customers
WHERE phone LIKE '%7674962641%';
-- 2. Check for "Invisible" Auth users
-- Sometimes a user is in auth but not in public.accounts
SELECT id,
    email,
    phone,
    created_at
FROM auth.users
WHERE phone LIKE '%7674962641%'
    OR email = 'kommurahesh7674@gmail.com';
-- 3. Check for RECENT errors (again, looking for a different message)
SELECT *
FROM public.app_logs
ORDER BY created_at DESC
LIMIT 10;
-- 4. Check the Trigger Body one more time
-- Let's see if there's any logic that could be hard-coding a value?
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname = 'handle_new_user';