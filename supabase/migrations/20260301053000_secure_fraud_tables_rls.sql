BEGIN;
ALTER TABLE IF EXISTS public.fraud_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fraud_ip_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fraud_logs_deny_direct_access ON public.fraud_logs;
CREATE POLICY fraud_logs_deny_direct_access
ON public.fraud_logs
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
DROP POLICY IF EXISTS fraud_ip_activity_deny_direct_access ON public.fraud_ip_activity;
CREATE POLICY fraud_ip_activity_deny_direct_access
ON public.fraud_ip_activity
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
REVOKE ALL ON TABLE public.fraud_logs FROM anon, authenticated;
REVOKE ALL ON TABLE public.fraud_ip_activity FROM anon, authenticated;
COMMIT;
