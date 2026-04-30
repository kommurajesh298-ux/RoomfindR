ALTER TABLE IF EXISTS public.owner_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.owner_bank_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.owner_bank_verification_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_bank_accounts_owner_select ON public.owner_bank_accounts;
CREATE POLICY owner_bank_accounts_owner_select
  ON public.owner_bank_accounts
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS owner_bank_accounts_admin_select ON public.owner_bank_accounts;
CREATE POLICY owner_bank_accounts_admin_select
  ON public.owner_bank_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS owner_bank_verification_owner_select ON public.owner_bank_verification;
CREATE POLICY owner_bank_verification_owner_select
  ON public.owner_bank_verification
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS owner_bank_verification_admin_select ON public.owner_bank_verification;
CREATE POLICY owner_bank_verification_admin_select
  ON public.owner_bank_verification
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS owner_bank_verification_history_owner_select ON public.owner_bank_verification_history;
CREATE POLICY owner_bank_verification_history_owner_select
  ON public.owner_bank_verification_history
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS owner_bank_verification_history_admin_select ON public.owner_bank_verification_history;
CREATE POLICY owner_bank_verification_history_admin_select
  ON public.owner_bank_verification_history
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
