-- ==========================================
-- 🛡️ HARDEN AUTH TRIGGERS
-- Prevents 500 Errors during signup by cleaning orphaned
-- records in public.accounts before processing new users.
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN -- 🛡️ SELF-CLEANING: Delete ORPHANED records in accounts that conflict with the new user's email/phone
    -- This MUST run here to prevent 500 Errors during signup (OTP delivery).
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
WHEN OTHERS THEN -- Swallow cleanup errors to ensure OTP is always sent
END;
-- 🛡️ LAZY REGISTRATION: We do NOT insert into public.accounts here.
-- The profile will be created by repair_my_profile() after the user 
-- successfully verifies their OTP and logs in.
RETURN NEW;
END;
$$;
