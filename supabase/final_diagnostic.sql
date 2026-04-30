-- ==========================================
-- FINAL SYNC & DATA INTEGRITY CHECK
-- ==========================================
-- 1. Check for mismatched profiles (Auth exists but Account is missing)
SELECT u.id as auth_id,
    u.email as auth_email,
    a.id as account_id,
    a.role
FROM auth.users u
    LEFT JOIN public.accounts a ON u.id = a.id
WHERE u.email IN (
        'kommurahesh7674@gmail.com',
        'kommurahesh1212@gmail.com'
    );
-- 2. Check for Phone Conflicts
-- See if the same phone is registered to multiple IDs
SELECT phone,
    count(*),
    array_agg(id) as ids
FROM public.accounts
WHERE phone IS NOT NULL
    AND phone != ''
GROUP BY phone
HAVING count(*) > 1;
-- 3. Check Trigger Status
-- Ensure the trigger is active on auth.users
SELECT trigger_name,
    event_manipulation,
    action_statement,
    action_orientation
FROM information_schema.triggers
WHERE event_object_table = 'users'
    AND event_object_schema = 'auth';
-- 4. Check RLS Policies
-- If RLS is ON but policies are missing, you get a 406 error
SELECT tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename = 'accounts';
SELECT *
FROM pg_policies
WHERE tablename = 'accounts';
-- 5. RECOVERY: If RLS is broken, fix it
-- Uncomment and run the lines below if RLS seems to be the issue
-- ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "Users can view their own account" ON public.accounts;
-- CREATE POLICY "Users can view their own account" ON public.accounts FOR SELECT USING (auth.uid() = id);