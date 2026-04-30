BEGIN;
ALTER TABLE public.rooms
DROP CONSTRAINT IF EXISTS rooms_booked_count_within_capacity;
ALTER TABLE public.rooms
ADD CONSTRAINT rooms_booked_count_within_capacity
CHECK (
  COALESCE(booked_count, 0) >= 0
  AND COALESCE(booked_count, 0) <= GREATEST(1, COALESCE(capacity, 1))
) NOT VALID;
ALTER TABLE public.rooms
VALIDATE CONSTRAINT rooms_booked_count_within_capacity;
CREATE OR REPLACE FUNCTION public.recalculate_room_occupancy(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity INTEGER;
  v_property_id UUID;
  v_active_count INTEGER := 0;
  v_booked_count INTEGER := 0;
  v_room_rows INTEGER := 0;
BEGIN
  IF p_room_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    GREATEST(1, COALESCE(r.capacity, 1)),
    r.property_id
  INTO v_capacity, v_property_id
  FROM public.rooms r
  WHERE r.id = p_room_id
  LIMIT 1;

  IF v_capacity IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_active_count
  FROM public.bookings b
  WHERE b.room_id = p_room_id
    AND b.vacate_date IS NULL
    AND NOT (
      lower(COALESCE(b.status::TEXT, '')) IN (
        'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded',
        'checked-out', 'checked_out', 'vacated', 'completed', 'expired', 'failed', 'payment_failed'
      )
      OR lower(COALESCE(b.booking_status::TEXT, '')) IN (
        'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded',
        'checked-out', 'checked_out', 'vacated', 'completed', 'expired', 'failed', 'payment_failed'
      )
      OR lower(COALESCE(b.stay_status::TEXT, '')) IN (
        'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded',
        'checked-out', 'checked_out', 'vacated', 'completed', 'expired', 'failed', 'payment_failed'
      )
      OR lower(COALESCE(b.continue_status::TEXT, '')) IN (
        'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded',
        'checked-out', 'checked_out', 'vacated', 'completed', 'expired', 'failed', 'payment_failed'
      )
    )
    AND (
      lower(COALESCE(b.status::TEXT, '')) IN (
        'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested', 'vacate-requested'
      )
      OR lower(COALESCE(b.booking_status::TEXT, '')) IN (
        'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested', 'vacate-requested'
      )
      OR lower(COALESCE(b.stay_status::TEXT, '')) IN (
        'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested', 'vacate-requested'
      )
      OR lower(COALESCE(b.continue_status::TEXT, '')) IN (
        'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested', 'vacate-requested'
      )
    );

  v_booked_count := LEAST(GREATEST(0, COALESCE(v_active_count, 0)), v_capacity);

  UPDATE public.rooms
  SET
    booked_count = v_booked_count,
    is_available = (v_booked_count < v_capacity)
  WHERE id = p_room_id;

  IF v_property_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_room_rows
  FROM public.rooms
  WHERE property_id = v_property_id;

  IF COALESCE(v_room_rows, 0) = 0 THEN
    UPDATE public.properties
    SET
      rooms_available = 0,
      total_rooms = 0
    WHERE id = v_property_id;
    RETURN;
  END IF;

  UPDATE public.properties p
  SET
    rooms_available = stats.total_available,
    total_rooms = stats.total_capacity
  FROM (
    SELECT
      r.property_id,
      COALESCE(SUM(GREATEST(1, COALESCE(r.capacity, 1))), 0)::INTEGER AS total_capacity,
      COALESCE(SUM(
        GREATEST(
          0,
          GREATEST(1, COALESCE(r.capacity, 1)) - LEAST(
            GREATEST(0, COALESCE(r.booked_count, 0)),
            GREATEST(1, COALESCE(r.capacity, 1))
          )
        )
      ), 0)::INTEGER AS total_available
    FROM public.rooms r
    WHERE r.property_id = v_property_id
    GROUP BY r.property_id
  ) stats
  WHERE p.id = stats.property_id;
END;
$$;
DO $$
DECLARE
  v_room_id UUID;
BEGIN
  FOR v_room_id IN (SELECT id FROM public.rooms) LOOP
    PERFORM public.recalculate_room_occupancy(v_room_id);
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.recalculate_room_occupancy(UUID) TO authenticated, service_role;
COMMIT;
