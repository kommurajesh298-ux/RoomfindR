BEGIN;

DO $$
BEGIN
    IF to_regclass('public.ratings') IS NULL OR to_regclass('public.properties') IS NULL THEN
        RAISE NOTICE 'ratings or properties table missing; skipping ratings hardening migration.';
        RETURN;
    END IF;
END $$;

-- Keep only the latest rating per property + user before adding the new unique constraint.
WITH ranked_duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY property_id, user_id
            ORDER BY created_at DESC NULLS LAST, id DESC
        ) AS rn
    FROM public.ratings
    WHERE property_id IS NOT NULL
      AND user_id IS NOT NULL
)
DELETE FROM public.ratings r
USING ranked_duplicates d
WHERE r.id = d.id
  AND d.rn > 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ratings_property_user_unique'
          AND conrelid = 'public.ratings'::regclass
    ) THEN
        ALTER TABLE public.ratings
            ADD CONSTRAINT ratings_property_user_unique UNIQUE (property_id, user_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ratings_property_created_at
    ON public.ratings(property_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.recompute_property_rating_summary(p_property_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_property_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.properties
    SET
        avg_rating = COALESCE((
            SELECT ROUND(AVG(r.rating)::numeric, 2)
            FROM public.ratings r
            WHERE r.property_id = p_property_id
        ), 0),
        total_ratings = COALESCE((
            SELECT COUNT(*)
            FROM public.ratings r
            WHERE r.property_id = p_property_id
        ), 0)
    WHERE id = p_property_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_property_rating_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recompute_property_rating_summary(OLD.property_id);
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
        PERFORM public.recompute_property_rating_summary(OLD.property_id);
    END IF;

    PERFORM public.recompute_property_rating_summary(NEW.property_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_rating_insert ON public.ratings;
DROP TRIGGER IF EXISTS after_rating_delete ON public.ratings;
DROP TRIGGER IF EXISTS ratings_sync_property_summary_trg ON public.ratings;

CREATE TRIGGER ratings_sync_property_summary_trg
AFTER INSERT OR UPDATE OR DELETE ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.sync_property_rating_summary();

UPDATE public.properties p
SET
    avg_rating = COALESCE(summary.avg_rating, 0),
    total_ratings = COALESCE(summary.total_ratings, 0)
FROM (
    SELECT
        property_id,
        ROUND(AVG(rating)::numeric, 2) AS avg_rating,
        COUNT(*)::integer AS total_ratings
    FROM public.ratings
    GROUP BY property_id
) AS summary
WHERE p.id = summary.property_id;

UPDATE public.properties
SET avg_rating = 0,
    total_ratings = 0
WHERE id NOT IN (
    SELECT DISTINCT property_id
    FROM public.ratings
    WHERE property_id IS NOT NULL
);

DROP POLICY IF EXISTS ratings_insert ON public.ratings;
CREATE POLICY ratings_insert
ON public.ratings
FOR INSERT
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.id = ratings.booking_id
          AND b.customer_id = auth.uid()
          AND lower(coalesce(b.status::text, '')) IN ('checked-out', 'checked_out', 'completed')
    )
);

DROP POLICY IF EXISTS ratings_update ON public.ratings;
CREATE POLICY ratings_update
ON public.ratings
FOR UPDATE
USING (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.id = ratings.booking_id
          AND b.customer_id = auth.uid()
          AND lower(coalesce(b.status::text, '')) IN ('checked-out', 'checked_out', 'completed')
    )
)
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.id = ratings.booking_id
          AND b.customer_id = auth.uid()
          AND lower(coalesce(b.status::text, '')) IN ('checked-out', 'checked_out', 'completed')
    )
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'properties'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.properties;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'ratings'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.ratings;
        END IF;
    END IF;
END $$;

COMMIT;
