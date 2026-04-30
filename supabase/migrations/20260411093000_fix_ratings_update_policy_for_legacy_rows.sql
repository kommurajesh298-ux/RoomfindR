BEGIN;

DO $$
BEGIN
    IF to_regclass('public.ratings') IS NULL THEN
        RAISE NOTICE 'ratings table missing; skipping ratings update policy fix.';
        RETURN;
    END IF;
END $$;

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
          AND lower(coalesce(b.status::text, '')) IN ('checked-out', 'checked_out', 'completed')
    )
);

COMMIT;
