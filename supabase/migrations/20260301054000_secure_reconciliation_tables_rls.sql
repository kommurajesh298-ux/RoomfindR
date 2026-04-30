BEGIN;
ALTER TABLE IF EXISTS public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reconciliation_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reconciliation_runs_select_admin ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_select_admin
ON public.reconciliation_runs
FOR SELECT
USING (
  public.is_admin(auth.uid())
  OR auth.role() = 'service_role'
);
DROP POLICY IF EXISTS reconciliation_runs_admin_write ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_admin_write
ON public.reconciliation_runs
FOR ALL
USING (
  public.is_admin(auth.uid())
  OR auth.role() = 'service_role'
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR auth.role() = 'service_role'
);
DROP POLICY IF EXISTS reconciliation_issues_select_admin ON public.reconciliation_issues;
CREATE POLICY reconciliation_issues_select_admin
ON public.reconciliation_issues
FOR SELECT
USING (
  public.is_admin(auth.uid())
  OR auth.role() = 'service_role'
);
DROP POLICY IF EXISTS reconciliation_issues_admin_write ON public.reconciliation_issues;
CREATE POLICY reconciliation_issues_admin_write
ON public.reconciliation_issues
FOR ALL
USING (
  public.is_admin(auth.uid())
  OR auth.role() = 'service_role'
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR auth.role() = 'service_role'
);
COMMIT;
