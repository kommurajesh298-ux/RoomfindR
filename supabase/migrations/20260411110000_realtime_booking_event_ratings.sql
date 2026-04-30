BEGIN;

DO $$
BEGIN
    IF to_regclass('public.ratings') IS NULL
        OR to_regclass('public.bookings') IS NULL
        OR to_regclass('public.properties') IS NULL THEN
        RAISE NOTICE 'ratings, bookings, or properties table missing; skipping booking event ratings migration.';
        RETURN;
    END IF;
END $$;

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS checkin_rating_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS checkout_rating_submitted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.ratings
    ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE public.ratings
SET type = 'checkout'
WHERE type IS NULL
   OR btrim(type) = '';

ALTER TABLE public.ratings
    ALTER COLUMN type SET DEFAULT 'checkout';

ALTER TABLE public.ratings
    ALTER COLUMN type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ratings_type_check'
          AND conrelid = 'public.ratings'::regclass
    ) THEN
        ALTER TABLE public.ratings
            ADD CONSTRAINT ratings_type_check
            CHECK (type IN ('checkin', 'checkout'));
    END IF;
END $$;

WITH ranked_duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY booking_id, type
            ORDER BY created_at DESC NULLS LAST, id DESC
        ) AS rn
    FROM public.ratings
    WHERE booking_id IS NOT NULL
)
DELETE FROM public.ratings r
USING ranked_duplicates d
WHERE r.id = d.id
  AND d.rn > 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ratings_property_user_unique'
          AND conrelid = 'public.ratings'::regclass
    ) THEN
        ALTER TABLE public.ratings
            DROP CONSTRAINT ratings_property_user_unique;
    END IF;
END $$;

DROP INDEX IF EXISTS public.ratings_property_user_unique;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ratings_booking_type_unique'
          AND conrelid = 'public.ratings'::regclass
    ) THEN
        ALTER TABLE public.ratings
            ADD CONSTRAINT ratings_booking_type_unique UNIQUE (booking_id, type);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ratings_booking_type_created_at
    ON public.ratings(booking_id, type, created_at DESC);

CREATE OR REPLACE FUNCTION public.recompute_booking_rating_submission_flags(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_booking_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.bookings
    SET
        checkin_rating_submitted = EXISTS (
            SELECT 1
            FROM public.ratings r
            WHERE r.booking_id = p_booking_id
              AND r.type = 'checkin'
        ),
        checkout_rating_submitted = EXISTS (
            SELECT 1
            FROM public.ratings r
            WHERE r.booking_id = p_booking_id
              AND r.type = 'checkout'
        )
    WHERE id = p_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_booking_rating_submission_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recompute_booking_rating_submission_flags(OLD.booking_id);
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
        PERFORM public.recompute_booking_rating_submission_flags(OLD.booking_id);
    END IF;

    PERFORM public.recompute_booking_rating_submission_flags(NEW.booking_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ratings_sync_booking_flags_trg ON public.ratings;

CREATE TRIGGER ratings_sync_booking_flags_trg
AFTER INSERT OR UPDATE OR DELETE ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.sync_booking_rating_submission_flags();

UPDATE public.bookings b
SET
    checkin_rating_submitted = EXISTS (
        SELECT 1
        FROM public.ratings r
        WHERE r.booking_id = b.id
          AND r.type = 'checkin'
    ),
    checkout_rating_submitted = EXISTS (
        SELECT 1
        FROM public.ratings r
        WHERE r.booking_id = b.id
          AND r.type = 'checkout'
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
          AND (
              (
                  ratings.type = 'checkin'
                  AND lower(coalesce(b.status::text, '')) IN (
                      'checked-in',
                      'checked_in',
                      'checked-out',
                      'checked_out',
                      'completed'
                  )
              )
              OR (
                  ratings.type = 'checkout'
                  AND lower(coalesce(b.status::text, '')) IN (
                      'checked-out',
                      'checked_out',
                      'completed'
                  )
              )
          )
    )
);

DROP POLICY IF EXISTS ratings_update ON public.ratings;
CREATE POLICY ratings_update
ON public.ratings
FOR UPDATE
USING (
    user_id = auth.uid()
)
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.id = ratings.booking_id
          AND b.customer_id = auth.uid()
          AND (
              (
                  ratings.type = 'checkin'
                  AND lower(coalesce(b.status::text, '')) IN (
                      'checked-in',
                      'checked_in',
                      'checked-out',
                      'checked_out',
                      'completed'
                  )
              )
              OR (
                  ratings.type = 'checkout'
                  AND lower(coalesce(b.status::text, '')) IN (
                      'checked-out',
                      'checked_out',
                      'completed'
                  )
              )
          )
    )
);

COMMIT;
