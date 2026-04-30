-- ==========================================
-- 🔔 VERIFICATION NOTIFICATION ENGINE (v1.0)
-- Automates Owner Alerts on Status Change
-- ==========================================
-- 1. Notification Function
CREATE OR REPLACE FUNCTION notify_owner_verification_status() RETURNS TRIGGER AS $$ BEGIN -- 🟢 CASE: APPROVED
    IF (
        NEW.verification_status = 'approved'
        AND (
            OLD.verification_status IS NULL
            OR OLD.verification_status != 'approved'
        )
    )
    OR (
        NEW.verified = true
        AND OLD.verified = false
    ) THEN
INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        data
    )
VALUES (
        NEW.id,
        'Profile Verified! 🛡️',
        'Congratulations! Your owner profile has been approved by the admin. You can now list properties.',
        'system',
        jsonb_build_object('status', 'approved', 'owner_id', NEW.id)
    );
-- 🔴 CASE: REJECTED
ELSIF (
    NEW.verification_status = 'rejected'
    AND (
        OLD.verification_status IS NULL
        OR OLD.verification_status != 'rejected'
    )
) THEN
INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        data
    )
VALUES (
        NEW.id,
        'Verification Update 📝',
        'Your verification request was not approved. Please check your documents and contact support if needed.',
        'system',
        jsonb_build_object('status', 'rejected', 'owner_id', NEW.id)
    );
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. RESET TRIGGER
DROP TRIGGER IF EXISTS trigger_notify_owner_verification ON public.owners;
-- 3. APPLY TRIGGER
CREATE TRIGGER trigger_notify_owner_verification
AFTER
UPDATE ON public.owners FOR EACH ROW EXECUTE FUNCTION notify_owner_verification_status();
-- 4. VERIFY REGISTRATION (Optional: notify on signup too?)
-- We'll keep it simple for now as per user request for "after verify".