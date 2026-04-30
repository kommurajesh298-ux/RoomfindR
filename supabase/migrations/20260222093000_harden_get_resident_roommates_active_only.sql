BEGIN;
-- Restrict resident roommate visibility to active-in-house stays only.
-- This prevents approved/pending bookings from being treated as active residents.
CREATE OR REPLACE FUNCTION public.get_resident_roommates(
  p_property_id UUID
) RETURNS TABLE (
  booking_id UUID,
  customer_id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  status TEXT,
  room_id UUID,
  room_number TEXT,
  property_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_authorized BOOLEAN := FALSE;
BEGIN
  IF v_actor IS NOT NULL THEN
    IF public.is_admin(v_actor) THEN
      v_authorized := TRUE;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM properties p
        WHERE p.id = p_property_id
          AND p.owner_id = v_actor
      ) INTO v_authorized;

      IF NOT v_authorized THEN
        SELECT EXISTS (
          SELECT 1
          FROM bookings b
          WHERE b.property_id = p_property_id
            AND b.customer_id = v_actor
            AND b.vacate_date IS NULL
            AND lower(replace(coalesce(b.status::text, ''), '_', '-')) IN (
              'checked-in',
              'active',
              'ongoing',
              'vacate-requested'
            )
        ) INTO v_authorized;
      END IF;
    END IF;

    IF NOT v_authorized THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.customer_id,
    b.customer_name,
    b.customer_phone,
    b.status::TEXT,
    b.room_id,
    b.room_number,
    b.property_id
  FROM bookings b
  WHERE b.property_id = p_property_id
    AND b.vacate_date IS NULL
    AND lower(replace(coalesce(b.status::text, ''), '_', '-')) IN (
      'checked-in',
      'active',
      'ongoing',
      'vacate-requested'
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_resident_roommates(UUID) TO authenticated, service_role;
COMMIT;
