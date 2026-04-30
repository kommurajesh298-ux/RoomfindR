BEGIN;

CREATE TABLE IF NOT EXISTS public.fcm_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    app TEXT NOT NULL DEFAULT 'customer' CHECK (app IN ('customer', 'owner', 'admin')),
    device_type TEXT NOT NULL DEFAULT 'android',
    platform TEXT NOT NULL DEFAULT 'android',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fcm_tokens_user_token_unique UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id
    ON public.fcm_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_created_at
    ON public.fcm_tokens(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_active
    ON public.fcm_tokens(user_id, is_active);

INSERT INTO public.fcm_tokens (
    user_id,
    token,
    app,
    device_type,
    platform,
    is_active,
    created_at,
    updated_at,
    last_seen_at
)
SELECT
    ud.user_id,
    ud.fcm_token,
    COALESCE(NULLIF(ud.app, ''), 'customer'),
    COALESCE(NULLIF(ud.device_type, ''), 'android'),
    COALESCE(NULLIF(ud.platform, ''), 'android'),
    COALESCE(ud.is_active, TRUE),
    COALESCE(ud.created_at, NOW()),
    COALESCE(ud.updated_at, NOW()),
    COALESCE(ud.last_seen_at, NOW())
FROM public.user_devices ud
ON CONFLICT (user_id, token)
DO UPDATE SET
    app = EXCLUDED.app,
    device_type = EXCLUDED.device_type,
    platform = EXCLUDED.platform,
    is_active = EXCLUDED.is_active,
    updated_at = NOW(),
    last_seen_at = EXCLUDED.last_seen_at;

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fcm_tokens_select ON public.fcm_tokens;
CREATE POLICY fcm_tokens_select
ON public.fcm_tokens
FOR SELECT
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS fcm_tokens_insert ON public.fcm_tokens;
CREATE POLICY fcm_tokens_insert
ON public.fcm_tokens
FOR INSERT
WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS fcm_tokens_update ON public.fcm_tokens;
CREATE POLICY fcm_tokens_update
ON public.fcm_tokens
FOR UPDATE
USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS fcm_tokens_delete ON public.fcm_tokens;
CREATE POLICY fcm_tokens_delete
ON public.fcm_tokens
FOR DELETE
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_fcm_tokens_updated_at ON public.fcm_tokens;
CREATE TRIGGER update_fcm_tokens_updated_at
BEFORE UPDATE ON public.fcm_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;
