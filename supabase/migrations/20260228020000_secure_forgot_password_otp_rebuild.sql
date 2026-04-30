BEGIN;
-- Remove any legacy/insecure password reset OTP tables.
DROP TABLE IF EXISTS public.reset_otps CASCADE;
DROP TABLE IF EXISTS public.password_resets CASCADE;
DROP TABLE IF EXISTS public.password_reset_codes CASCADE;
CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email ON public.password_reset_otps(email);
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email_created_at ON public.password_reset_otps(email, created_at DESC);
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny direct access to password_reset_otps" ON public.password_reset_otps;
CREATE POLICY "Deny direct access to password_reset_otps"
ON public.password_reset_otps
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
-- Service-only helper to map email -> auth.users.id without exposing auth schema directly.
CREATE OR REPLACE FUNCTION public.find_auth_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
BEGIN
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(COALESCE(email, '')) = v_email
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.find_auth_user_id_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_auth_user_id_by_email(TEXT) TO service_role;
-- Service-only helper to invalidate all auth sessions/tokens after password reset.
CREATE OR REPLACE FUNCTION public.invalidate_auth_sessions(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'auth'
      AND table_name = 'refresh_tokens'
  ) THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1' USING p_user_id;
    EXCEPTION WHEN undefined_column THEN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'auth'
          AND table_name = 'refresh_tokens'
          AND column_name = 'session_id'
      ) THEN
        EXECUTE '
          DELETE FROM auth.refresh_tokens rt
          USING auth.sessions s
          WHERE rt.session_id = s.id
            AND s.user_id = $1
        ' USING p_user_id;
      END IF;
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'auth'
      AND table_name = 'sessions'
  ) THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING p_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_auth_sessions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invalidate_auth_sessions(UUID) TO service_role;
COMMIT;
