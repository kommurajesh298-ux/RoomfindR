-- ==========================================
-- STEP 1: IDENTIFY THE CONFLICT
-- ==========================================
-- This shows you WHO currently owns your phone number in the database.
SELECT id,
    email,
    phone,
    role
FROM public.accounts
WHERE phone = '7674962641'
    OR phone = '+917674962641';
-- ==========================================
-- STEP 2: CLEAR THE CONFLICT (If old/unused)
-- ==========================================
-- If the email above is an old test account, run this to clear it:
-- DELETE FROM public.accounts WHERE phone = '7674962641';
-- ==========================================
-- STEP 3: FIX RLS POLICIES
-- ==========================================
-- Your policies use "uid()", but the standard is "auth.uid()". 
-- Let's synchronize them for absolute reliability.
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own account" ON public.accounts;
CREATE POLICY "Users can view own account" ON public.accounts FOR
SELECT USING (
        auth.uid() = id
        OR is_admin()
    );
DROP POLICY IF EXISTS "Users can update own account" ON public.accounts;
CREATE POLICY "Users can update own account" ON public.accounts FOR
UPDATE USING (auth.uid() = id);
-- ==========================================
-- STEP 4: VERIFY TRIGGER IS ACTIVE
-- ==========================================
-- Run this to see if the trigger is definitely there
SELECT trigger_name
FROM information_schema.triggers
WHERE event_object_table = 'users'
    AND event_object_schema = 'auth';