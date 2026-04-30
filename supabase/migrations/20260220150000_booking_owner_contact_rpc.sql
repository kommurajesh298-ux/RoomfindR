-- Expose minimal owner contact details to booking participants (customer/owner/admin)
-- without relaxing global owners table RLS.

CREATE OR REPLACE FUNCTION public.get_booking_owner_contact(p_booking_id UUID)
RETURNS TABLE (
    owner_id UUID,
    name TEXT,
    email TEXT,
    phone TEXT,
    avatar_url TEXT,
    verified BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking RECORD;
BEGIN
    IF p_booking_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT b.owner_id, b.customer_id
    INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF NOT (
        auth.uid() = v_booking.owner_id
        OR auth.uid() = v_booking.customer_id
        OR public.is_admin(auth.uid())
    ) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    SELECT
        o.id AS owner_id,
        COALESCE(NULLIF(o.name, ''), 'Property Owner') AS name,
        COALESCE(o.email, '') AS email,
        COALESCE(o.phone, '') AS phone,
        NULL::TEXT AS avatar_url,
        COALESCE(o.verified, FALSE) AS verified
    FROM public.owners o
    WHERE o.id = v_booking.owner_id
    LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_booking_owner_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_owner_contact(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_owner_contact(UUID) TO service_role;
