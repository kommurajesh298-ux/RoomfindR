BEGIN;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS stay_type TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS selected_months INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_rent NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS valid_till DATE,
  ADD COLUMN IF NOT EXISTS booking_status TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS portal_access BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS extension_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS continue_status TEXT DEFAULT 'active';
UPDATE public.bookings
SET stay_type = COALESCE(stay_type, 'monthly'),
    selected_months = COALESCE(selected_months, 1)
WHERE stay_type IS NULL OR selected_months IS NULL;
UPDATE public.bookings
SET valid_till = COALESCE(
    valid_till,
    (start_date + ((COALESCE(selected_months, 1)) || ' months')::interval)::date
)
WHERE valid_till IS NULL AND start_date IS NOT NULL;
UPDATE public.bookings
SET total_rent = COALESCE(total_rent, monthly_rent * COALESCE(selected_months, 1))
WHERE total_rent IS NULL AND monthly_rent IS NOT NULL;
UPDATE public.bookings
SET portal_access = COALESCE(portal_access, true),
    booking_status = COALESCE(booking_status, 'ACTIVE');
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
    p_override BOOLEAN DEFAULT FALSE,
    p_stay_type TEXT DEFAULT NULL,
    p_selected_months INTEGER DEFAULT NULL,
    p_total_rent NUMERIC DEFAULT NULL,
    p_valid_till DATE DEFAULT NULL,
    p_booking_status TEXT DEFAULT NULL,
    p_portal_access BOOLEAN DEFAULT NULL,
    p_continue_status TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_id UUID;
    v_new_booking_id UUID;
    v_booking_key TEXT;
    v_capacity INTEGER;
    v_active_count INTEGER;
    v_selected_months INTEGER;
    v_valid_till DATE;
    v_total_rent NUMERIC;
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

    v_selected_months := COALESCE(p_selected_months, NULLIF(p_duration_months, 0), 1);
    v_valid_till := COALESCE(
        p_valid_till,
        (p_start_date + ((COALESCE(v_selected_months, 1)) || ' months')::interval)::date
    );
    v_total_rent := COALESCE(p_total_rent, p_monthly_rent * COALESCE(v_selected_months, 1));

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
        stay_type,
        selected_months,
        total_rent,
        valid_till,
        booking_status,
        portal_access,
        continue_status,
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
        COALESCE(p_stay_type, 'monthly'),
        v_selected_months,
        v_total_rent,
        v_valid_till,
        COALESCE(p_booking_status, 'ACTIVE'),
        COALESCE(p_portal_access, true),
        COALESCE(p_continue_status, 'active'),
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
CREATE OR REPLACE FUNCTION public.extend_booking_stay(
    p_booking_id UUID,
    p_add_months INTEGER,
    p_payment_type TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_valid DATE;
    v_start DATE;
    v_selected INTEGER;
BEGIN
    SELECT valid_till, start_date, selected_months
    INTO v_current_valid, v_start, v_selected
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF v_start IS NULL THEN
        RETURN;
    END IF;

    v_current_valid := COALESCE(v_current_valid, v_start);

    UPDATE public.bookings
    SET selected_months = COALESCE(v_selected, 0) + GREATEST(1, COALESCE(p_add_months, 1)),
        valid_till = (v_current_valid + ((GREATEST(1, COALESCE(p_add_months, 1))) || ' months')::interval)::date,
        total_rent = COALESCE(monthly_rent, 0) * (COALESCE(v_selected, 0) + GREATEST(1, COALESCE(p_add_months, 1))),
        payment_type = COALESCE(p_payment_type, payment_type),
        portal_access = true,
        booking_status = 'ACTIVE',
        continue_status = 'continued',
        extension_count = COALESCE(extension_count, 0) + 1,
        updated_at = NOW()
    WHERE id = p_booking_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.exit_booking_stay(
    p_booking_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.bookings
    SET booking_status = 'ENDING',
        continue_status = 'exit_requested',
        stay_status = 'vacate_requested',
        portal_access = true,
        updated_at = NOW()
    WHERE id = p_booking_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.expire_booking_stay(
    p_booking_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.bookings
    SET booking_status = 'EXPIRED',
        continue_status = COALESCE(continue_status, 'pending'),
        portal_access = false,
        updated_at = NOW()
    WHERE id = p_booking_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.extend_booking_stay(UUID, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exit_booking_stay(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_booking_stay(UUID) TO authenticated, service_role;
COMMIT;
