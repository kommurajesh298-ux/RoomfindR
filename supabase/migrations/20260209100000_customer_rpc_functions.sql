BEGIN;
-- Provide a parameterized admin helper used by RLS policies
-- Note: avoid changing parameter names to prevent CREATE OR REPLACE errors.
DO $$
DECLARE
    argname TEXT;
    args_text TEXT;
BEGIN
    SELECT
        COALESCE((p.proargnames)[1], 'uid'),
        pg_get_function_arguments(p.oid)
    INTO argname, args_text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'is_admin'
      AND p.pronargs = 1
    ORDER BY p.oid DESC
    LIMIT 1;

    IF argname IS NULL OR argname = '' THEN
        argname := 'uid';
    END IF;

    -- Preserve existing parameter defaults (if any) to avoid
    -- "cannot remove parameter defaults from existing function".
    IF args_text IS NULL OR btrim(args_text) = '' THEN
        args_text := format('%I UUID DEFAULT auth.uid()', argname);
    END IF;

    EXECUTE format($sql$
        CREATE OR REPLACE FUNCTION public.is_admin(%s) RETURNS BOOLEAN
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path = public AS $fn$
        BEGIN
            IF %I IS NULL THEN
                RETURN FALSE;
            END IF;

            RETURN EXISTS (
                SELECT 1
                FROM public.accounts
                WHERE id = %I
                  AND role = 'admin'
            );
        END;
        $fn$;
    $sql$, args_text, argname, argname);
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated, service_role;
-- Cancel booking (v2) with authorization checks
CREATE OR REPLACE FUNCTION public.cancel_booking_v2(
  p_booking_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_booking bookings%ROWTYPE;
  v_actor UUID := auth.uid();
  v_status TEXT;
BEGIN
  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_actor IS NOT NULL THEN
    IF NOT (v_actor = v_booking.customer_id OR v_actor = v_booking.owner_id OR public.is_admin(v_actor)) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;
  END IF;

  v_status := lower(COALESCE(v_booking.status::text, ''));
  IF v_status IN ('cancelled','cancelled_by_customer','cancelled-by-customer','rejected','checked-out','checked_out','completed','refunded') THEN
    RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', v_booking.status);
  END IF;

  UPDATE bookings
  SET status = 'cancelled',
      cancelled_at = NOW(),
      rejection_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled by user'),
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'cancelled');
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_booking_v2(UUID, TEXT) TO authenticated, service_role;
-- Get roommates (safe bridge for client)
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
                AND (
              b.status IS NULL
              OR lower(replace(b.status::text, '_', '-')) IN (
                'requested',
                'pending',
                'payment-pending',
                'approved',
                'accepted',
                'confirmed',
                'checked-in',
                'active',
                'paid',
                'vacate-requested'
              )
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
    AND (
      b.status IS NULL
      OR lower(replace(b.status::text, '_', '-')) IN (
        'requested',
        'pending',
        'payment-pending',
        'approved',
        'accepted',
        'confirmed',
        'checked-in',
        'active',
        'paid',
        'vacate-requested'
      )
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_resident_roommates(UUID) TO authenticated, service_role;
COMMIT;
