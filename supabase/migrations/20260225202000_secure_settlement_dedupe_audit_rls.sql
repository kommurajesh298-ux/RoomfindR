BEGIN;
ALTER TABLE public.settlement_dedupe_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_dedupe_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_dedupe_audit_admin_read ON public.settlement_dedupe_audit;
CREATE POLICY settlement_dedupe_audit_admin_read
ON public.settlement_dedupe_audit
FOR SELECT
USING (public.is_admin(auth.uid()));
COMMIT;
