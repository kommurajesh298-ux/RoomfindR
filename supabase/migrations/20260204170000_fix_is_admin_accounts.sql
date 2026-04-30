-- ==========================================
--  Fix is_admin to use accounts role
-- ==========================================
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.accounts
    WHERE id = auth.uid()
      AND role = 'admin'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
