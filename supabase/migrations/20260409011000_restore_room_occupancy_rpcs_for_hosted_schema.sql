CREATE OR REPLACE FUNCTION public.increment_room_occupancy(room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
BEGIN
  UPDATE public.rooms
  SET booked_count = COALESCE(booked_count, 0) + 1,
      is_available = CASE
        WHEN COALESCE(booked_count, 0) + 1 >= COALESCE(capacity, 0) AND COALESCE(capacity, 0) > 0 THEN FALSE
        ELSE TRUE
      END
  WHERE id = room_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_room_occupancy(room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
BEGIN
  UPDATE public.rooms
  SET booked_count = GREATEST(0, COALESCE(booked_count, 0) - 1),
      is_available = TRUE
  WHERE id = room_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.increment_room_occupancy(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_room_occupancy(UUID) TO authenticated, service_role;
