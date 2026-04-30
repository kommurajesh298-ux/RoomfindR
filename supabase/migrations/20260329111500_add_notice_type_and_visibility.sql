ALTER TABLE public.notices
ADD COLUMN IF NOT EXISTS type TEXT;

ALTER TABLE public.notices
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.owners(id) ON DELETE SET NULL;

ALTER TABLE public.notices
ADD COLUMN IF NOT EXISTS visible_to TEXT NOT NULL DEFAULT 'all';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notices_type_check'
    ) THEN
        ALTER TABLE public.notices
        ADD CONSTRAINT notices_type_check
        CHECK (type IN ('info', 'urgent', 'food', 'payment', 'rule', 'maintenance', 'festival'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notices_visible_to_check'
    ) THEN
        ALTER TABLE public.notices
        ADD CONSTRAINT notices_visible_to_check
        CHECK (visible_to IN ('all', 'owners', 'residents'));
    END IF;
END $$;

UPDATE public.notices
SET type = CASE lower(coalesce(priority, 'normal'))
    WHEN 'urgent' THEN 'urgent'
    WHEN 'high' THEN 'payment'
    WHEN 'low' THEN 'info'
    ELSE 'info'
END
WHERE type IS NULL;

ALTER TABLE public.notices
ALTER COLUMN type SET DEFAULT 'info';

ALTER TABLE public.notices
ALTER COLUMN type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notices_property_created_at
ON public.notices(property_id, created_at DESC);
