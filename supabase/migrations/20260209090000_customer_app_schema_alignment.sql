BEGIN;
-- Align properties schema with customer app expectations
ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS auto_offer JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS full_payment_discount JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_properties_tags ON public.properties USING GIN (tags);
-- Chat metadata needed by customer app features
ALTER TABLE public.chats
    ADD COLUMN IF NOT EXISTS muted_users UUID[] DEFAULT '{}'::uuid[],
    ADD COLUMN IF NOT EXISTS unread_counts JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS title TEXT;
COMMIT;
