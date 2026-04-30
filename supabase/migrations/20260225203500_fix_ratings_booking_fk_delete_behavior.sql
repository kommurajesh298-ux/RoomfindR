BEGIN;
DO $$
BEGIN
    IF to_regclass('public.ratings') IS NULL THEN
        RAISE NOTICE 'public.ratings does not exist; skipping ratings FK fix.';
        RETURN;
    END IF;

    IF to_regclass('public.bookings') IS NULL THEN
        RAISE NOTICE 'public.bookings does not exist; skipping ratings FK fix.';
        RETURN;
    END IF;
END $$;
-- Backfill missing booking_id where possible.
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
-- Remove ratings that cannot be tied to a booking.
DELETE FROM public.ratings
WHERE booking_id IS NULL;
-- Remove orphaned ratings referencing missing bookings.
DELETE FROM public.ratings r
WHERE r.booking_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = r.booking_id
  );
-- Replace any FK from ratings to bookings with ON DELETE CASCADE.
DO $$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.ratings'::regclass
          AND contype = 'f'
          AND confrelid = 'public.bookings'::regclass
    LOOP
        EXECUTE format('ALTER TABLE public.ratings DROP CONSTRAINT %I', v_fk.conname);
    END LOOP;

    ALTER TABLE public.ratings
        ADD CONSTRAINT ratings_booking_id_fkey
        FOREIGN KEY (booking_id)
        REFERENCES public.bookings(id)
        ON DELETE CASCADE;
END $$;
ALTER TABLE public.ratings
    ALTER COLUMN booking_id SET NOT NULL;
COMMIT;
