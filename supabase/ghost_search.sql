-- ==========================================
-- THE NUCLEAR "GHOST" SEARCH 🔬🕵️‍♂️
-- ==========================================
-- 1. SEARCH FOR THE PHONE (Every variation)
-- Replace the number below with EXACTLY what you typed in the signup form
DO $$
DECLARE search_term TEXT := '7674962641';
-- <-- DOUBLE CHECK THIS NUMBER
BEGIN RAISE NOTICE 'Searching for any record containing %',
search_term;
END $$;
-- Search in Public Tables
SELECT 'accounts' as tbl,
    id,
    email,
    phone
FROM public.accounts
WHERE phone LIKE '%7674962641%';
SELECT 'owners' as tbl,
    id,
    email,
    phone
FROM public.owners
WHERE phone LIKE '%7674962641%';
SELECT 'customers' as tbl,
    id,
    email,
    phone
FROM public.customers
WHERE phone LIKE '%7674962641%';
-- Search in Auth Tables (The hidden layer)
SELECT 'auth_users' as tbl,
    id,
    email,
    phone
FROM auth.users
WHERE phone LIKE '%7674962641%'
    OR email LIKE '%7674962641%';
-- 2. SEARCH FOR THE EMAIL
SELECT 'accounts_email' as tbl,
    id,
    email,
    role
FROM public.accounts
WHERE email = 'kommurahesh7674@gmail.com';
SELECT 'auth_email' as tbl,
    id,
    email
FROM auth.users
WHERE email = 'kommurahesh7674@gmail.com';
-- 3. CHECK THE TRIGGER STATUS
-- If this returns 0, the trigger is NOT working
SELECT count(*) as trigger_count
FROM information_schema.triggers
WHERE event_object_table = 'users'
    AND event_object_schema = 'auth';
-- 4. CLEANUP COMMANDS (Prepared for you)
-- Once you see the ID in the results above, use it here:
-- DELETE FROM auth.users WHERE id = 'PASTE_ID_HERE';
-- DELETE FROM public.accounts WHERE id = 'PASTE_ID_HERE';