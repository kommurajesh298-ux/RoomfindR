BEGIN;
-- Avoid net.http_post OOM errors by switching to lightweight NOTIFY.
CREATE OR REPLACE FUNCTION public.trigger_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM 'queued' THEN
        RETURN NEW;
    END IF;

    -- Emit a lightweight signal instead of making an HTTP call inside the trigger.
    PERFORM pg_notify('notifications_dispatch', NEW.id::text);

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Never block the insert due to notification dispatch issues.
        RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notifications_push_trigger ON public.notifications;
CREATE TRIGGER notifications_push_trigger
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notification_push();
COMMIT;
