BEGIN;
UPDATE public.bookings
SET booking_status = 'COMPLETED',
    continue_status = 'exit_completed',
    rent_cycle_closed_at = COALESCE(rent_cycle_closed_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
WHERE (
    vacate_date IS NOT NULL
    OR lower(COALESCE(status::text, '')) IN ('checked-out', 'checked_out', 'completed', 'vacated')
    OR lower(COALESCE(stay_status, '')) = 'vacated'
)
AND (
    COALESCE(booking_status, '') IS DISTINCT FROM 'COMPLETED'
    OR COALESCE(continue_status, '') IS DISTINCT FROM 'exit_completed'
    OR rent_cycle_closed_at IS NULL
);
UPDATE public.bookings
SET cycle_duration_days = GREATEST(1, COALESCE(cycle_duration_days, 30)),
    current_cycle_start_date = COALESCE(
        current_cycle_start_date,
        check_in_date,
        start_date,
        timezone('utc', now())::date
    ),
    next_due_date = COALESCE(
        next_due_date,
        COALESCE(current_cycle_start_date, check_in_date, start_date, timezone('utc', now())::date)
            + GREATEST(1, COALESCE(cycle_duration_days, 30))
    ),
    updated_at = timezone('utc', now())
WHERE cycle_duration_days IS NULL
   OR cycle_duration_days <= 0
   OR current_cycle_start_date IS NULL
   OR next_due_date IS NULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
