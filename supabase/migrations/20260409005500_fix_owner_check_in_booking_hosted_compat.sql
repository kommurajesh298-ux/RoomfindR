CREATE OR REPLACE FUNCTION public.owner_check_in_booking(
  p_booking_id UUID,
  p_room_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_owner_id UUID;
  v_customer_id UUID;
  v_property_id UUID;
  v_start_date DATE;
  v_current_cycle_start DATE;
  v_cycle_duration INTEGER;
  v_conflict_exists BOOLEAN := FALSE;
  v_settlement_id UUID;
  v_settlement_status TEXT;
  v_settlement_amount NUMERIC;
  v_settlement_payment_type TEXT;
  v_room_number TEXT;
  v_customer_name TEXT;
  v_currency TEXT;
  v_room_label TEXT;
  v_payout_label TEXT;
  v_payout_context TEXT;
  v_payout_amount_text TEXT;
  v_actor_role TEXT := lower(
    COALESCE(
      auth.jwt() -> 'user_metadata' ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    )
  );
  v_is_admin BOOLEAN := v_actor_role = 'admin';
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT owner_id, customer_id, property_id, start_date, current_cycle_start_date,
         COALESCE(cycle_duration_days, 30), room_number, customer_name, currency
    INTO v_owner_id, v_customer_id, v_property_id, v_start_date, v_current_cycle_start,
         v_cycle_duration, v_room_number, v_customer_name, v_currency
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_owner_id IS DISTINCT FROM v_actor AND NOT v_is_admin THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.customer_id = v_customer_id
      AND b.id <> p_booking_id
      AND b.vacate_date IS NULL
      AND lower(COALESCE(b.status::text, '')) IN ('checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
      AND b.property_id <> v_property_id
  ) INTO v_conflict_exists;

  IF v_conflict_exists THEN
    RAISE EXCEPTION 'STAY_CONFLICT';
  END IF;

  v_current_cycle_start := COALESCE(v_current_cycle_start, v_start_date, CURRENT_DATE);

  UPDATE public.bookings
  SET status = 'checked-in',
      stay_status = 'ongoing',
      current_cycle_start_date = v_current_cycle_start,
      next_due_date = v_current_cycle_start + GREATEST(1, COALESCE(v_cycle_duration, 30)),
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF p_room_id IS NOT NULL THEN
    PERFORM public.increment_room_occupancy(p_room_id);
  END IF;

  v_room_label := CASE
    WHEN COALESCE(NULLIF(trim(v_room_number), ''), '') <> '' THEN format('Room %s', trim(v_room_number))
    ELSE 'booking'
  END;

  INSERT INTO public.notifications (
    user_id, title, message, type, status, data, is_read
  )
  VALUES (
    v_customer_id,
    'Check-in confirmed',
    format('Check-in confirmed for %s.', v_room_label),
    'booking',
    'queued',
    jsonb_build_object('booking_id', p_booking_id, 'status', 'checked-in'),
    FALSE
  );

  SELECT s.id, s.status, COALESCE(s.net_payable, s.total_amount), s.payment_type
    INTO v_settlement_id, v_settlement_status, v_settlement_amount, v_settlement_payment_type
  FROM public.settlements s
  WHERE s.booking_id = p_booking_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_settlement_id IS NOT NULL AND upper(COALESCE(v_settlement_status, '')) IN ('COMPLETED', 'FAILED') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = v_owner_id
        AND lower(COALESCE(n.notification_type::text, n.type, '')) = CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'settlement_completed'
          ELSE 'settlement_failed'
        END
        AND COALESCE(n.data->>'settlement_id', '') = v_settlement_id::text
    ) THEN
      v_payout_label := CASE
        WHEN lower(COALESCE(v_settlement_payment_type, '')) IN ('monthly', 'rent') THEN 'Rent payout'
        ELSE 'Advance payout'
      END;
      v_payout_amount_text := CASE
        WHEN COALESCE(v_settlement_amount, 0) > 0 THEN format('%s %s', COALESCE(v_currency, 'INR'), trim(to_char(v_settlement_amount, 'FM9999999990D00')))
        ELSE NULL
      END;
      v_payout_context := concat_ws(', ', COALESCE(NULLIF(trim(v_customer_name), ''), 'Customer'), v_room_label);

      INSERT INTO public.notifications (
        user_id, title, message, type, notification_type, status, data, is_read
      )
      VALUES (
        v_owner_id,
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN v_payout_label || ' received'
          ELSE v_payout_label || ' failed'
        END,
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN format('%s of %s for %s received successfully.', v_payout_label, COALESCE(v_payout_amount_text, 'the amount'), v_payout_context)
          ELSE format('%s of %s for %s failed.', v_payout_label, COALESCE(v_payout_amount_text, 'the amount'), v_payout_context)
        END,
        'system',
        CASE
          WHEN upper(v_settlement_status) = 'COMPLETED' THEN 'settlement_completed'
          ELSE 'settlement_failed'
        END,
        'queued',
        jsonb_build_object('settlement_id', v_settlement_id),
        FALSE
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'checked-in');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.owner_check_in_booking(UUID, UUID) TO authenticated, service_role;
