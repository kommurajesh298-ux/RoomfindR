BEGIN;
CREATE OR REPLACE FUNCTION public.prevent_closed_booking_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_closed BOOLEAN;
    v_new_closed BOOLEAN;
BEGIN
    v_old_closed := public.is_booking_rent_cycle_closed(
        OLD.status::text,
        OLD.stay_status,
        OLD.booking_status,
        OLD.continue_status,
        OLD.vacate_date,
        OLD.rent_cycle_closed_at
    );

    v_new_closed := public.is_booking_rent_cycle_closed(
        NEW.status::text,
        NEW.stay_status,
        NEW.booking_status,
        NEW.continue_status,
        NEW.vacate_date,
        NEW.rent_cycle_closed_at
    );

    IF v_old_closed AND NOT v_new_closed THEN
        RAISE EXCEPTION
            'BOOKING_REOPEN_NOT_ALLOWED: closed bookings cannot be reopened; create a new booking.'
            USING ERRCODE = 'P0001',
                  DETAIL = format(
                      'booking_id=%s old_status=%s new_status=%s',
                      OLD.id,
                      COALESCE(OLD.status::text, ''),
                      COALESCE(NEW.status::text, '')
                  );
    END IF;

    IF v_old_closed THEN
        NEW.vacate_date := COALESCE(NEW.vacate_date, OLD.vacate_date, timezone('utc', now())::date);
        NEW.rent_cycle_closed_at := COALESCE(NEW.rent_cycle_closed_at, OLD.rent_cycle_closed_at, timezone('utc', now()));
        NEW.booking_status := COALESCE(NULLIF(NEW.booking_status, ''), OLD.booking_status, 'COMPLETED');
        NEW.continue_status := COALESCE(NULLIF(NEW.continue_status, ''), OLD.continue_status, 'exit_completed');
        NEW.portal_access := false;
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_closed_booking_reopen ON public.bookings;
CREATE TRIGGER trg_prevent_closed_booking_reopen
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_closed_booking_reopen();
WITH ranked_active AS (
    SELECT
        b.id,
        ROW_NUMBER() OVER (
            PARTITION BY b.customer_id
            ORDER BY b.created_at DESC, b.id DESC
        ) AS row_rank
    FROM public.bookings b
    WHERE NOT public.is_booking_rent_cycle_closed(
        b.status::text,
        b.stay_status,
        b.booking_status,
        b.continue_status,
        b.vacate_date,
        b.rent_cycle_closed_at
    )
),
duplicates AS (
    SELECT id
    FROM ranked_active
    WHERE row_rank > 1
)
UPDATE public.bookings b
SET status = 'checked-out',
    stay_status = 'vacated',
    booking_status = 'COMPLETED',
    continue_status = 'exit_completed',
    vacate_date = COALESCE(b.vacate_date, timezone('utc', now())::date),
    portal_access = false,
    next_due_date = NULL,
    rent_cycle_closed_at = COALESCE(b.rent_cycle_closed_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
FROM duplicates d
WHERE b.id = d.id;
NOTIFY pgrst, 'reload schema';
COMMIT;
