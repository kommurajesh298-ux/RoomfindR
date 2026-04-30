BEGIN;
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
    p_selected_days INTEGER DEFAULT NULL,
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
    v_stay_type TEXT;
    v_selected_months INTEGER;
    v_selected_days INTEGER;
    v_valid_till DATE;
    v_total_rent NUMERIC;
    v_existing_status TEXT;
    v_existing_stay_status TEXT;
    v_existing_booking_status TEXT;
    v_existing_continue_status TEXT;
    v_existing_vacate_date DATE;
    v_existing_cycle_closed_at TIMESTAMPTZ;
    v_existing_closed BOOLEAN;
BEGIN
    v_booking_key := NULLIF(trim(p_booking_key), '');
    IF v_booking_key IS NULL AND NULLIF(trim(COALESCE(p_transaction_id, '')), '') IS NOT NULL THEN
        v_booking_key := trim(p_transaction_id);
    END IF;

    -- Idempotency must never attach a new re-booking flow to an old closed/vacated booking.
    IF v_booking_key IS NOT NULL THEN
        SELECT
            id,
            status::text,
            stay_status,
            booking_status,
            continue_status,
            vacate_date,
            rent_cycle_closed_at
        INTO
            v_existing_id,
            v_existing_status,
            v_existing_stay_status,
            v_existing_booking_status,
            v_existing_continue_status,
            v_existing_vacate_date,
            v_existing_cycle_closed_at
        FROM public.bookings
        WHERE booking_key = v_booking_key
          AND customer_id = p_customer_id
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            v_existing_closed := public.is_booking_rent_cycle_closed(
                v_existing_status,
                v_existing_stay_status,
                v_existing_booking_status,
                v_existing_continue_status,
                v_existing_vacate_date,
                v_existing_cycle_closed_at
            );

            IF NOT v_existing_closed THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'booking_id', v_existing_id,
                    'idempotent', true
                );
            END IF;

            -- Closed booking with same key: rotate key so re-booking gets a brand new booking_id.
            v_booking_key := format('%s_rb_%s', v_booking_key, substr(md5(clock_timestamp()::text || random()::text), 1, 8));
        END IF;
    END IF;

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

    v_stay_type := lower(COALESCE(NULLIF(trim(p_stay_type), ''), 'monthly'));
    IF v_stay_type IN ('long term', 'long-term', 'longterm') THEN
        v_stay_type := 'long_term';
    ELSIF v_stay_type NOT IN ('monthly', 'long_term', 'days') THEN
        v_stay_type := 'monthly';
    END IF;

    IF v_stay_type = 'days' THEN
        v_selected_days := GREATEST(1, COALESCE(p_selected_days, p_end_date - p_start_date, 1));
        v_selected_months := GREATEST(1, CEIL(v_selected_days::numeric / 30.0)::INTEGER);
        v_valid_till := COALESCE(
            p_valid_till,
            p_end_date,
            (p_start_date + (v_selected_days || ' days')::interval)::date
        );
        v_total_rent := COALESCE(
            p_total_rent,
            ROUND((COALESCE(p_monthly_rent, 0) / 30.0 * v_selected_days)::numeric, 2)
        );
    ELSIF v_stay_type = 'long_term' THEN
        v_selected_days := NULL;
        v_selected_months := NULL;
        v_valid_till := NULL;
        v_total_rent := COALESCE(p_total_rent, COALESCE(p_monthly_rent, 0));
    ELSE
        v_selected_days := NULL;
        v_selected_months := GREATEST(1, COALESCE(p_selected_months, NULLIF(p_duration_months, 0), 1));
        v_valid_till := COALESCE(
            p_valid_till,
            p_end_date,
            (p_start_date + (v_selected_months || ' months')::interval)::date
        );
        v_total_rent := COALESCE(p_total_rent, COALESCE(p_monthly_rent, 0) * v_selected_months);
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
        stay_type,
        selected_months,
        selected_days,
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
        CASE WHEN v_stay_type = 'long_term' THEN NULL ELSE p_end_date END,
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
        v_stay_type,
        v_selected_months,
        v_selected_days,
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
        SELECT
            id,
            status::text,
            stay_status,
            booking_status,
            continue_status,
            vacate_date,
            rent_cycle_closed_at
        INTO
            v_existing_id,
            v_existing_status,
            v_existing_stay_status,
            v_existing_booking_status,
            v_existing_continue_status,
            v_existing_vacate_date,
            v_existing_cycle_closed_at
        FROM public.bookings
        WHERE booking_key = v_booking_key
          AND customer_id = p_customer_id
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            v_existing_closed := public.is_booking_rent_cycle_closed(
                v_existing_status,
                v_existing_stay_status,
                v_existing_booking_status,
                v_existing_continue_status,
                v_existing_vacate_date,
                v_existing_cycle_closed_at
            );
            IF NOT v_existing_closed THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'booking_id', v_existing_id,
                    'idempotent', true
                );
            END IF;
        END IF;
    END IF;
    RAISE;
WHEN OTHERS THEN
    RAISE;
END;
$$;
DO $$
DECLARE
    fn RECORD;
BEGIN
    FOR fn IN
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'create_booking_v4'
    LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION public.create_booking_v4(%s) TO authenticated, service_role',
            pg_get_function_identity_arguments(fn.oid)
        );
    END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
