-- ==========================================
-- Rooms RLS Policies
-- ==========================================
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view rooms" ON public.rooms;
CREATE POLICY "Users can view rooms" ON public.rooms
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.properties
        WHERE properties.id = rooms.property_id
          AND (
              properties.status = 'published'
              OR properties.owner_id = auth.uid()
              OR public.is_admin(auth.uid())
          )
    )
);
DROP POLICY IF EXISTS "Owners can manage own property rooms" ON public.rooms;
CREATE POLICY "Owners can manage own property rooms" ON public.rooms
FOR ALL
USING (
    EXISTS (
        SELECT 1
        FROM public.properties
        WHERE properties.id = rooms.property_id
          AND properties.owner_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.properties
        WHERE properties.id = rooms.property_id
          AND properties.owner_id = auth.uid()
    )
);
