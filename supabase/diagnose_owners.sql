-- DIAGNOSTIC: OWNER VERIFICATION STATUS
-- Run this in Supabase SQL Editor to check why Admin updates might fail
-- 1. Check Table Structure & Constraints
SELECT column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'owners';
-- 2. Check RLS Status
SELECT relname,
    relrowsecurity
FROM pg_class
WHERE relname = 'owners';
-- 3. Check Policies
SELECT *
FROM pg_policies
WHERE tablename = 'owners';
-- 4. Check Current Owner Status (poojakommu)
-- Search by email from the screenshot
SELECT id,
    name,
    email,
    verified,
    verification_status
FROM owners
WHERE email = 'kommurahesh88862@gmail.com';
-- 5. TEST: Manually approve (if you can)
-- UPDATE owners SET verified = true, verification_status = 'approved' WHERE email = 'kommurahesh88862@gmail.com';