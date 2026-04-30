ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to settings" ON public.settings;
DROP POLICY IF EXISTS "Allow authenticated users to update settings" ON public.settings;
DROP POLICY IF EXISTS settings_public_site_read ON public.settings;
DROP POLICY IF EXISTS admin_settings_all ON public.settings;

CREATE POLICY settings_public_site_read
ON public.settings
FOR SELECT
USING (id = 'site');

CREATE POLICY admin_settings_all
ON public.settings
FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
