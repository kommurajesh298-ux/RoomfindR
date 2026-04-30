BEGIN;

DO $$
BEGIN
    IF to_regclass('public.ratings') IS NULL
        OR to_regclass('public.bookings') IS NULL
        OR to_regclass('public.properties') IS NULL
        OR to_regclass('public.owners') IS NULL THEN
        RAISE NOTICE 'ratings, bookings, properties, or owners table missing; skipping owner ratings hardening migration.';
        RETURN;
    END IF;
END $$;

ALTER TABLE public.ratings
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE;

UPDATE public.ratings r
SET owner_id = b.owner_id
FROM public.bookings b
WHERE b.id = r.booking_id
  AND (
      r.owner_id IS NULL
      OR r.owner_id IS DISTINCT FROM b.owner_id
  );

UPDATE public.ratings r
SET owner_id = p.owner_id
FROM public.properties p
WHERE r.owner_id IS NULL
  AND p.id = r.property_id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.ratings
        WHERE owner_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Unable to backfill ratings.owner_id for all rows';
    END IF;
END $$;

ALTER TABLE public.ratings
    ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ratings_owner_created_at
    ON public.ratings(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ratings_owner_property_created_at
    ON public.ratings(owner_id, property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ratings_owner_rating_created_at
    ON public.ratings(owner_id, rating, created_at DESC);

CREATE OR REPLACE FUNCTION public.sync_rating_owner_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking_owner_id UUID;
    v_booking_property_id UUID;
    v_booking_customer_id UUID;
    v_property_owner_id UUID;
BEGIN
    IF NEW.booking_id IS NOT NULL THEN
        SELECT b.owner_id, b.property_id, b.customer_id
          INTO v_booking_owner_id, v_booking_property_id, v_booking_customer_id
        FROM public.bookings b
        WHERE b.id = NEW.booking_id;

        IF v_booking_owner_id IS NULL THEN
            RAISE EXCEPTION 'Rating booking % is missing or invalid', NEW.booking_id;
        END IF;

        NEW.owner_id := v_booking_owner_id;
        NEW.property_id := COALESCE(NEW.property_id, v_booking_property_id);
        NEW.user_id := COALESCE(NEW.user_id, v_booking_customer_id);
        RETURN NEW;
    END IF;

    IF NEW.property_id IS NOT NULL THEN
        SELECT p.owner_id
          INTO v_property_owner_id
        FROM public.properties p
        WHERE p.id = NEW.property_id;

        IF v_property_owner_id IS NULL THEN
            RAISE EXCEPTION 'Rating property % is missing or invalid', NEW.property_id;
        END IF;

        NEW.owner_id := v_property_owner_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ratings_sync_owner_context_trg ON public.ratings;

CREATE TRIGGER ratings_sync_owner_context_trg
BEFORE INSERT OR UPDATE OF booking_id, property_id, user_id
ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.sync_rating_owner_context();

DROP POLICY IF EXISTS ratings_select ON public.ratings;
CREATE POLICY ratings_select
ON public.ratings
FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR owner_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM public.properties p
        WHERE p.id = ratings.property_id
          AND p.status = 'published'
    )
);

COMMIT;
