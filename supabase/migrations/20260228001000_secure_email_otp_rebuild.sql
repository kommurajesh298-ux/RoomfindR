BEGIN;
-- Remove insecure/legacy OTP tables if they exist.
DROP TABLE IF EXISTS public.email_otp_codes CASCADE;
DROP TABLE IF EXISTS public.otp_codes CASCADE;
DROP TABLE IF EXISTS public.user_otps CASCADE;
DROP TABLE IF EXISTS public.otps CASCADE;
CREATE TABLE IF NOT EXISTS public.email_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_email_otps_email ON public.email_otps(email);
CREATE INDEX IF NOT EXISTS idx_email_otps_email_created_at ON public.email_otps(email, created_at DESC);
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny direct access to email_otps" ON public.email_otps;
CREATE POLICY "Deny direct access to email_otps"
ON public.email_otps
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
COMMIT;
