-- ==========================================
-- Food Menu RLS Policies
-- ==========================================
ALTER TABLE public.food_menu ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view food menu" ON public.food_menu;
CREATE POLICY "Users can view food menu" ON public.food_menu
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.properties
        WHERE properties.id = food_menu.property_id
          AND (
              properties.status = 'published'
              OR properties.owner_id = auth.uid()
              OR public.is_admin(auth.uid())
          )
    )
);
DROP POLICY IF EXISTS "Owners can manage own property food menu" ON public.food_menu;
CREATE POLICY "Owners can manage own property food menu" ON public.food_menu
FOR ALL
USING (
    EXISTS (
        SELECT 1
        FROM public.properties
        WHERE properties.id = food_menu.property_id
          AND properties.owner_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.properties
        WHERE properties.id = food_menu.property_id
          AND properties.owner_id = auth.uid()
    )
);
