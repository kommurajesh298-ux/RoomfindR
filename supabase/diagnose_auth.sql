-- ==========================================
-- DIAGNOSTIC SCRIPT FOR SIGNUP 406 ERROR
-- ==========================================
-- 1. Check for errors logged during the trigger execution
-- If the trigger failed, the error message will be here.
SELECT *
FROM public.app_logs
ORDER BY created_at DESC
LIMIT 20;
-- 2. Check if the user exists in Auth (should be there if you see 406)
SELECT id,
    email,
    phone,
    created_at
FROM auth.users
WHERE email = 'YOUR_TEST_EMAIL_HERE' -- CHANGE THIS to your test email
    OR phone = 'YOUR_TEST_PHONE_HERE';
-- CHANGE THIS to your test phone
-- 3. Check if the account row exists (This is what 406 is missing)
SELECT *
FROM public.accounts
WHERE email = 'YOUR_TEST_EMAIL_HERE' -- CHANGE THIS
    OR phone = 'YOUR_TEST_PHONE_HERE';
-- CHANGE THIS
-- 4. Check for duplicate profiles that might be blocking the trigger
-- (e.g. an account with the same phone but a different ID)
SELECT id,
    email,
    phone,
    role
FROM public.accounts
WHERE phone IN (
        SELECT phone
        FROM auth.users
        WHERE email = 'YOUR_TEST_EMAIL_HERE'
    );