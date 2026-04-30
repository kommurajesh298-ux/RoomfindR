BEGIN;

DO $$
BEGIN
    IF to_regclass('public.ratings') IS NULL
        OR to_regclass('public.bookings') IS NULL
        OR to_regclass('public.properties') IS NULL THEN
        RAISE NOTICE 'ratings, bookings, or properties table missing; skipping ratings booking integrity repair.';
        RETURN;
    END IF;
END $$;

WITH ranked_matches AS (
    SELECT
        r.id AS rating_id,
        b.id AS booking_id,
        ROW_NUMBER() OVER (
            PARTITION BY r.id
            ORDER BY
                CASE
                    WHEN lower(coalesce(r.type, 'checkout')) = 'checkin'
                        AND lower(coalesce(b.status::text, '')) IN (
                            'checked-in',
                            'checked_in',
                            'checked-out',
                            'checked_out',
                            'completed'
                        ) THEN 0
                    WHEN lower(coalesce(r.type, 'checkout')) = 'checkout'
                        AND lower(coalesce(b.status::text, '')) IN (
                            'checked-out',
                            'checked_out',
                            'completed'
                        ) THEN 0
                    WHEN lower(coalesce(b.status::text, '')) IN (
                        'checked-in',
                        'checked_in',
                        'checked-out',
                        'checked_out',
                        'completed',
                        'approved',
                        'confirmed'
                    ) THEN 1
                    ELSE 2
                END,
                abs(extract(epoch FROM (
                    coalesce(r.created_at, now()) - coalesce(b.updated_at, b.created_at, now())
                ))),
                b.updated_at DESC NULLS LAST,
                b.created_at DESC NULLS LAST,
                b.id DESC
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

DELETE FROM public.ratings
WHERE booking_id IS NULL;

DELETE FROM public.ratings r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = r.booking_id
);

UPDATE public.ratings r
SET
    property_id = b.property_id,
    user_id = b.customer_id
FROM public.bookings b
WHERE b.id = r.booking_id
  AND (
      r.property_id IS DISTINCT FROM b.property_id
      OR r.user_id IS DISTINCT FROM b.customer_id
  );

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ratings'
          AND column_name = 'owner_id'
    ) THEN
        UPDATE public.ratings r
        SET owner_id = b.owner_id
        FROM public.bookings b
        WHERE b.id = r.booking_id
          AND r.owner_id IS DISTINCT FROM b.owner_id;
    END IF;
END $$;

ALTER TABLE public.ratings
    ALTER COLUMN booking_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.fill_and_guard_rating_booking_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
BEGIN
    IF NEW.booking_id IS NULL
       AND NEW.property_id IS NOT NULL
       AND NEW.user_id IS NOT NULL THEN
        SELECT b.*
          INTO v_booking
        FROM public.bookings b
        WHERE b.property_id = NEW.property_id
          AND b.customer_id = NEW.user_id
        ORDER BY
            CASE
                WHEN lower(coalesce(NEW.type, 'checkout')) = 'checkin'
                    AND lower(coalesce(b.status::text, '')) IN (
                        'checked-in',
                        'checked_in',
                        'checked-out',
                        'checked_out',
                        'completed'
                    ) THEN 0
                WHEN lower(coalesce(NEW.type, 'checkout')) = 'checkout'
                    AND lower(coalesce(b.status::text, '')) IN (
                        'checked-out',
                        'checked_out',
                        'completed'
                    ) THEN 0
                WHEN lower(coalesce(b.status::text, '')) IN (
                    'checked-in',
                    'checked_in',
                    'checked-out',
                    'checked_out',
                    'completed',
                    'approved',
                    'confirmed'
                ) THEN 1
                ELSE 2
            END,
            abs(extract(epoch FROM (
                coalesce(NEW.created_at, now()) - coalesce(b.updated_at, b.created_at, now())
            ))),
            b.updated_at DESC NULLS LAST,
            b.created_at DESC NULLS LAST,
            b.id DESC
        LIMIT 1;

        NEW.booking_id := v_booking.id;
    ELSE
        SELECT b.*
          INTO v_booking
        FROM public.bookings b
        WHERE b.id = NEW.booking_id;
    END IF;

    IF NEW.booking_id IS NULL OR v_booking.id IS NULL THEN
        RAISE EXCEPTION 'ratings.booking_id is required';
    END IF;

    IF NEW.property_id IS NOT NULL AND NEW.property_id IS DISTINCT FROM v_booking.property_id THEN
        RAISE EXCEPTION 'ratings.property_id must match booking.property_id';
    END IF;

    IF NEW.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM v_booking.customer_id THEN
        RAISE EXCEPTION 'ratings.user_id must match booking.customer_id';
    END IF;

    NEW.property_id := v_booking.property_id;
    NEW.user_id := v_booking.customer_id;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ratings'
          AND column_name = 'owner_id'
    ) THEN
        NEW.owner_id := v_booking.owner_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ratings_fill_booking_id_trg ON public.ratings;
CREATE TRIGGER ratings_fill_booking_id_trg
BEFORE INSERT OR UPDATE ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.fill_and_guard_rating_booking_id();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bookings'
          AND column_name = 'checkin_rating_submitted'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bookings'
          AND column_name = 'checkout_rating_submitted'
    ) THEN
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
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'properties'
          AND column_name = 'avg_rating'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'properties'
          AND column_name = 'total_ratings'
    ) THEN
        UPDATE public.properties p
        SET
            avg_rating = coalesce(summary.avg_rating, 0),
            total_ratings = coalesce(summary.total_ratings, 0)
        FROM (
            SELECT
                property_id,
                round(avg(rating)::numeric, 2) AS avg_rating,
                count(*)::integer AS total_ratings
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
    END IF;
END $$;

COMMIT;
