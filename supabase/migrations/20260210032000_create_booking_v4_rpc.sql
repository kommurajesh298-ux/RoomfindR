BEGIN;
-- Ensure booking key + indexes exist
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_booking_key_unique
  ON public.bookings(booking_key)
  WHERE booking_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_room_id ON public.bookings(room_id);
-- Drop any older overloads to avoid ambiguity
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oidvectortypes(proargtypes) AS args
    FROM pg_proc
    WHERE proname = 'create_booking_v4'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.create_booking_v4(%s)', r.args);
  END LOOP;
END $$;
-- Booking creation RPC (idempotent + capacity-safe)
CREATE OR REPLACE FUNCTION public.create_booking_v4(
  p_property_id UUID,
  p_room_id UUID,
  p_customer_id UUID,
  p_owner_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_monthly_rent NUMERIC,
  p_advance_paid NUMERIC,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_room_number TEXT,
  p_payment_type TEXT,
  p_transaction_id TEXT,
  p_amount_paid NUMERIC,
  p_duration_months INTEGER,
  p_amount_due NUMERIC DEFAULT NULL,
  p_booking_key TEXT DEFAULT NULL,
  p_override BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_existing_id UUID;
  v_new_booking_id UUID;
  v_booking_key TEXT;
  v_capacity INTEGER;
  v_active_count INTEGER;
BEGIN
  v_booking_key := NULLIF(trim(p_booking_key), '');
  IF v_booking_key IS NULL AND NULLIF(trim(COALESCE(p_transaction_id, '')), '') IS NOT NULL THEN
    v_booking_key := trim(p_transaction_id);
  END IF;

  -- Idempotency: return existing booking
  IF v_booking_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE booking_key = v_booking_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_existing_id,
        'idempotent', true
      );
    END IF;
  END IF;

  -- Conflict check: block only if there is a PAID active stay.
  IF NOT p_override THEN
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND property_id = p_property_id
      AND vacate_date IS NULL
      AND lower(coalesce(payment_status::text, '')) = 'paid'
      AND lower(coalesce(status::text, '')) NOT IN (
        'checked-out',
        'checked_out',
        'cancelled',
        'cancelled_by_customer',
        'cancelled-by-customer',
        'rejected',
        'refunded',
        'vacated',
        'completed'
      )
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'ACTIVE_PG_BOOKING_EXISTS: You are already staying in this PG. Please vacate your current room before booking another one.';
    END IF;
  END IF;

  -- Capacity check (lock room row to prevent race conditions)
  IF p_room_id IS NOT NULL THEN
    SELECT capacity INTO v_capacity
    FROM public.rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF v_capacity IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;

    SELECT COUNT(*) INTO v_active_count
    FROM public.bookings
    WHERE room_id = p_room_id
      AND vacate_date IS NULL
      AND lower(coalesce(status::text, '')) NOT IN (
        'cancelled',
        'cancelled_by_customer',
        'cancelled-by-customer',
        'rejected',
        'refunded',
        'checked-out',
        'checked_out',
        'vacated',
        'completed'
      );

    IF v_active_count >= GREATEST(1, COALESCE(v_capacity, 1)) THEN
      RAISE EXCEPTION 'ROOM_FULL';
    END IF;
  END IF;

  INSERT INTO public.bookings (
    property_id,
    room_id,
    customer_id,
    owner_id,
    start_date,
    end_date,
    monthly_rent,
    advance_paid,
    amount_due,
    customer_name,
    customer_phone,
    customer_email,
    status,
    stay_status,
    room_number,
    payment_status,
    transaction_id,
    amount_paid,
    payment_type,
    commission_amount,
    booking_key,
    created_at,
    updated_at
  )
  VALUES (
    p_property_id,
    p_room_id,
    p_customer_id,
    p_owner_id,
    p_start_date,
    p_end_date,
    p_monthly_rent,
    p_advance_paid,
    COALESCE(p_amount_due, p_advance_paid, p_monthly_rent),
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    'payment_pending',
    'ongoing',
    p_room_number,
    'pending',
    p_transaction_id,
    p_amount_paid,
    p_payment_type,
    20.00,
    v_booking_key,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_new_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_new_booking_id
  );
EXCEPTION
WHEN unique_violation THEN
  IF v_booking_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE booking_key = v_booking_key
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_existing_id,
        'idempotent', true
      );
    END IF;
  END IF;
  RAISE;
WHEN OTHERS THEN
  RAISE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_booking_v4 TO authenticated, service_role;
-- Refresh PostgREST schema cache (so /rest/v1/rpc/create_booking_v4 is available)
NOTIFY pgrst, 'reload schema';
COMMIT;
