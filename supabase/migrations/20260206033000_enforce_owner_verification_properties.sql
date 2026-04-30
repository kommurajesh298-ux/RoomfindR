BEGIN;
-- Helper: verify owner approval without RLS recursion
CREATE OR REPLACE FUNCTION public.is_owner_verified(owner_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.owners o
    WHERE o.id = owner_uuid
      AND (o.verified IS TRUE OR o.verification_status = 'approved')
  );
$$;
-- Enforce owner verification at the data layer
CREATE OR REPLACE FUNCTION public.enforce_owner_verification_on_properties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' AND NOT public.is_owner_verified(NEW.owner_id) THEN
    RAISE EXCEPTION 'Owner is not verified to publish properties' USING ERRCODE = '45000';
  END IF;

  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := NOW();
  ELSIF NEW.status IS DISTINCT FROM 'published' THEN
    NEW.published_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS properties_owner_verification_guard ON public.properties;
CREATE TRIGGER properties_owner_verification_guard
BEFORE INSERT OR UPDATE OF status, owner_id ON public.properties
FOR EACH ROW
EXECUTE FUNCTION public.enforce_owner_verification_on_properties();
-- Reset any published properties owned by unverified owners
UPDATE public.properties
SET status = 'draft',
    published_at = NULL
WHERE status = 'published'
  AND NOT public.is_owner_verified(owner_id);
-- Properties RLS (customers should only see verified + published)
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS properties_public_read ON public.properties;
DROP POLICY IF EXISTS properties_owner_insert ON public.properties;
DROP POLICY IF EXISTS properties_owner_update ON public.properties;
DROP POLICY IF EXISTS properties_owner_delete ON public.properties;
DROP POLICY IF EXISTS "Anyone can view published properties" ON public.properties;
DROP POLICY IF EXISTS "Owners can create properties" ON public.properties;
DROP POLICY IF EXISTS "Owners can update own properties" ON public.properties;
DROP POLICY IF EXISTS "Owners can delete own properties" ON public.properties;
DROP POLICY IF EXISTS admin_properties_all ON public.properties;
CREATE POLICY admin_properties_all ON public.properties
FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY properties_public_read ON public.properties
FOR SELECT
USING (
  (status = 'published' AND public.is_owner_verified(owner_id))
  OR owner_id = auth.uid()
  OR public.is_admin(auth.uid())
);
CREATE POLICY properties_owner_insert ON public.properties
FOR INSERT
WITH CHECK (
  owner_id = auth.uid()
  AND (public.is_owner() OR public.is_admin(auth.uid()))
  AND (status IS DISTINCT FROM 'published' OR public.is_owner_verified(owner_id))
);
CREATE POLICY properties_owner_update ON public.properties
FOR UPDATE
USING (
  owner_id = auth.uid()
  OR public.is_admin(auth.uid())
)
WITH CHECK (
  (owner_id = auth.uid() OR public.is_admin(auth.uid()))
  AND (status IS DISTINCT FROM 'published' OR public.is_owner_verified(owner_id))
);
CREATE POLICY properties_owner_delete ON public.properties
FOR DELETE
USING (
  owner_id = auth.uid()
  OR public.is_admin(auth.uid())
);
-- Rooms: hide for unverified owners even if property is published
DROP POLICY IF EXISTS "Users can view rooms" ON public.rooms;
CREATE POLICY "Users can view rooms" ON public.rooms
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.properties
    WHERE properties.id = rooms.property_id
      AND (
        (properties.status = 'published' AND public.is_owner_verified(properties.owner_id))
        OR properties.owner_id = auth.uid()
        OR public.is_admin(auth.uid())
      )
  )
);
-- Food menu: hide for unverified owners even if property is published
DROP POLICY IF EXISTS "Users can view food menu" ON public.food_menu;
CREATE POLICY "Users can view food menu" ON public.food_menu
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.properties
    WHERE properties.id = food_menu.property_id
      AND (
        (properties.status = 'published' AND public.is_owner_verified(properties.owner_id))
        OR properties.owner_id = auth.uid()
        OR public.is_admin(auth.uid())
      )
  )
);
COMMIT;
