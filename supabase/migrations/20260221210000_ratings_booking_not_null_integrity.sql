-- Ensure ratings.booking_id is always populated and consistent.
-- Backfills legacy NULL values, deletes irreconcilable rows, and enforces non-null inserts.

BEGIN;
DO $$
BEGIN
    IF to_regclass('public.ratings') IS NULL THEN
        RAISE NOTICE 'public.ratings does not exist; skipping ratings integrity migration.';
        RETURN;
    END IF;
END $$;
-- 1) Backfill missing booking_id using latest matching booking by property + customer(user).
WITH ranked_matches AS (
    SELECT
        r.id AS rating_id,
        b.id AS booking_id,
        ROW_NUMBER() OVER (
            PARTITION BY r.id
            ORDER BY
                CASE
                    WHEN lower(coalesce(b.status::text, '')) IN ('checked-in', 'checked_in', 'completed', 'approved', 'confirmed') THEN 0
                    ELSE 1
                END,
                b.updated_at DESC NULLS LAST,
                b.created_at DESC NULLS LAST
        ) AS rn
    FROM public.ratings r
    JOIN public.bookings b
      ON b.property_id = r.property_id
     AND b.customer_id = r.user_id
    WHERE r.booking_id IS NULL
)
UPDATE public.ratings r
SET booking_id = m.booking_id
FROM ranked_matches m
WHERE r.id = m.rating_id
  AND m.rn = 1;
-- 2) Remove rows that still cannot be tied to a booking.
DELETE FROM public.ratings
WHERE booking_id IS NULL;
-- 3) Ensure FK exists and booking_id cannot be null.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ratings_booking_id_fkey'
          AND conrelid = 'public.ratings'::regclass
    ) THEN
        ALTER TABLE public.ratings
            ADD CONSTRAINT ratings_booking_id_fkey
            FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
    END IF;
END $$;
ALTER TABLE public.ratings
    ALTER COLUMN booking_id SET NOT NULL;
-- 4) Auto-fill booking_id on insert/update if omitted, then reject if still unresolved.
CREATE OR REPLACE FUNCTION public.fill_and_guard_rating_booking_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF NEW.booking_id IS NULL
       AND NEW.property_id IS NOT NULL
       AND NEW.user_id IS NOT NULL
    THEN
        SELECT b.id
        INTO NEW.booking_id
        FROM public.bookings b
        WHERE b.property_id = NEW.property_id
          AND b.customer_id = NEW.user_id
        ORDER BY
            CASE
                WHEN lower(coalesce(b.status::text, '')) IN ('checked-in', 'checked_in', 'completed', 'approved', 'confirmed') THEN 0
                ELSE 1
            END,
            b.updated_at DESC NULLS LAST,
            b.created_at DESC NULLS LAST
        LIMIT 1;
    END IF;

    IF NEW.booking_id IS NULL THEN
        RAISE EXCEPTION 'ratings.booking_id is required';
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ratings_fill_booking_id_trg ON public.ratings;
CREATE TRIGGER ratings_fill_booking_id_trg
BEFORE INSERT OR UPDATE ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.fill_and_guard_rating_booking_id();
COMMIT;
