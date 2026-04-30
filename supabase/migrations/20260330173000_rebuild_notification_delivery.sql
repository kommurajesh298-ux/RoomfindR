BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'notification_status_enum'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumlabel = 'processing'
          AND enumtypid = 'notification_status_enum'::regtype
    ) THEN
        ALTER TYPE public.notification_status_enum ADD VALUE 'processing';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fcm_token TEXT NOT NULL,
    app TEXT NOT NULL DEFAULT 'customer' CHECK (app IN ('customer', 'owner', 'admin')),
    device_type TEXT NOT NULL DEFAULT 'android',
    platform TEXT NOT NULL DEFAULT 'android',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_devices_user_token_unique UNIQUE (user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id
    ON public.user_devices(user_id);

CREATE INDEX IF NOT EXISTS idx_user_devices_created_at
    ON public.user_devices(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_active
    ON public.user_devices(user_id, is_active);

INSERT INTO public.user_devices (
    user_id,
    fcm_token,
    app,
    device_type,
    platform,
    is_active,
    created_at,
    updated_at,
    last_seen_at
)
SELECT
    dt.user_id,
    dt.token,
    COALESCE(NULLIF(dt.app, ''), 'customer'),
    COALESCE(NULLIF(dt.platform, ''), 'android'),
    COALESCE(NULLIF(dt.platform, ''), 'android'),
    COALESCE(dt.status, 'active') = 'active',
    COALESCE(dt.created_at, NOW()),
    COALESCE(dt.updated_at, NOW()),
    COALESCE(dt.last_seen_at, NOW())
FROM public.device_tokens dt
ON CONFLICT (user_id, fcm_token)
DO UPDATE SET
    app = EXCLUDED.app,
    device_type = EXCLUDED.device_type,
    platform = EXCLUDED.platform,
    is_active = EXCLUDED.is_active,
    updated_at = NOW(),
    last_seen_at = EXCLUDED.last_seen_at;

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_devices_select ON public.user_devices;
CREATE POLICY user_devices_select
ON public.user_devices
FOR SELECT
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_devices_insert ON public.user_devices;
CREATE POLICY user_devices_insert
ON public.user_devices
FOR INSERT
WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_devices_update ON public.user_devices;
CREATE POLICY user_devices_update
ON public.user_devices
FOR UPDATE
USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_devices_delete ON public.user_devices;
CREATE POLICY user_devices_delete
ON public.user_devices
FOR DELETE
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_user_devices_updated_at ON public.user_devices;
CREATE TRIGGER update_user_devices_updated_at
BEFORE UPDATE ON public.user_devices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.trigger_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.status, 'queued') <> 'queued' THEN
        RETURN NEW;
    END IF;

    SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE NOTICE 'Missing supabase_url or service key for send-notification trigger';
        RETURN NEW;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/send-notification',
        headers := headers,
        body := jsonb_build_object(
            'notification_id', NEW.id
        )
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_push_trigger ON public.notifications;
CREATE TRIGGER notifications_push_trigger
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notification_push();

COMMIT;
