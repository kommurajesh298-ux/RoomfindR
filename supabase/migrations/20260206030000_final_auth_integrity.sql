-- ==========================================
-- 🛡️ FINAL AUTH INTEGRITY CHECK & REPAIR
-- Run this in your Supabase SQL Editor
-- ==========================================
-- 1. Ensure handle_new_user is DEFINER and Bulletproof
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
    auth AS $$ BEGIN -- SELF-CLEANING: Remove orphaned records that would cause 409 conflicts
    BEGIN
DELETE FROM public.accounts
WHERE id != NEW.id
    AND (
        (
            email IS NOT NULL
            AND email = NEW.email
        )
        OR (
            phone IS NOT NULL
            AND (
                phone = NEW.phone
                OR phone = REPLACE(NEW.phone, '+91', '')
                OR CONCAT('+91', phone) = NEW.phone
            )
        )
    )
    AND id NOT IN (
        SELECT id
        FROM auth.users
    );
EXCEPTION
WHEN OTHERS THEN -- Swallow ALL errors to ensure OTP is always sent
RAISE WARNING 'Cleanup failed in handle_new_user: %',
SQLERRM;
END;
-- RETURN NEW is mandatory for triggers to allow the insert
RETURN NEW;
END;
$$;
-- 2. Re-attach trigger (drop first to avoid duplicates)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- 3. Verify check_user_exists is DEFINER
ALTER FUNCTION public.check_user_exists(TEXT, TEXT) SECURITY DEFINER;
-- 4. Verify repair_my_profile is DEFINER
ALTER FUNCTION public.repair_my_profile() SECURITY DEFINER;
-- 5. Status Check
SELECT proname as function_name,
    prosecdef as is_security_definer
FROM pg_proc
WHERE proname IN (
        'handle_new_user',
        'check_user_exists',
        'repair_my_profile'
    );
