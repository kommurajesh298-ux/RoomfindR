BEGIN;

CREATE OR REPLACE FUNCTION public.sync_booking_payment_status_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_payment_type TEXT := lower(coalesce(NEW.payment_type, ''));
    v_payment_state TEXT := lower(coalesce(NEW.payment_status, NEW.status, 'pending'));
    v_booking_payment_state TEXT;
    v_advance_state TEXT;
    v_rent_state TEXT;
    v_payment_status_cast_type TEXT;
BEGIN
    v_booking_payment_state := CASE
        WHEN v_payment_state IN ('paid', 'completed', 'success', 'paid_pending_owner_acceptance', 'authorized') THEN 'paid'
        WHEN v_payment_state = 'refunded' THEN 'refunded'
        WHEN v_payment_state IN ('failed', 'cancelled', 'expired', 'terminated') THEN 'failed'
        ELSE 'pending'
    END;

    v_advance_state := CASE
        WHEN v_booking_payment_state = 'paid' THEN 'paid'
        WHEN v_booking_payment_state = 'refunded' THEN 'refunded'
        WHEN v_booking_payment_state = 'failed' THEN 'failed'
        ELSE 'pending'
    END;

    v_rent_state := CASE
        WHEN v_booking_payment_state = 'paid' THEN 'paid'
        WHEN v_booking_payment_state = 'failed' THEN 'failed'
        WHEN v_booking_payment_state = 'refunded' THEN 'refunded'
        ELSE 'pending'
    END;

    SELECT
        CASE
            WHEN t.typtype = 'e' THEN format('%I.%I', tn.nspname, t.typname)
            ELSE NULL
        END
    INTO v_payment_status_cast_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'bookings'
      AND a.attname = 'payment_status'
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1;

    IF v_payment_type = 'advance' THEN
        IF v_payment_status_cast_type IS NOT NULL THEN
            EXECUTE format(
                'UPDATE public.bookings
                 SET payment_status = CAST($1 AS %s),
                     advance_payment_status = $2,
                     updated_at = timezone(''utc'', now())
                 WHERE id = $3',
                v_payment_status_cast_type
            )
            USING v_booking_payment_state, v_advance_state, NEW.booking_id;
        ELSE
            UPDATE public.bookings
            SET payment_status = v_booking_payment_state,
                advance_payment_status = v_advance_state,
                updated_at = timezone('utc', now())
            WHERE id = NEW.booking_id;
        END IF;
    ELSIF v_payment_type IN ('rent', 'monthly') THEN
        UPDATE public.bookings
        SET rent_payment_status = v_rent_state,
            updated_at = timezone('utc', now())
        WHERE id = NEW.booking_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_rent_cycle_on_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_payment public.payments%ROWTYPE;
    v_booking public.bookings%ROWTYPE;
    v_today DATE := timezone('utc', now())::date;
    v_cycle_start DATE;
    v_next_due DATE;
    v_cycle_end DATE;
    v_new_start DATE;
    v_new_next_due DATE;
    v_already_advanced BOOLEAN := FALSE;
BEGIN
    SELECT *
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
    END IF;

    IF lower(COALESCE(v_payment.payment_type, '')) NOT IN ('rent', 'monthly') THEN
        RAISE EXCEPTION 'PAYMENT_TYPE_NOT_RENT';
    END IF;

    IF lower(COALESCE(v_payment.payment_status, v_payment.status, '')) NOT IN ('paid', 'completed', 'success', 'authorized') THEN
        RAISE EXCEPTION 'RENT_PAYMENT_NOT_SETTLED';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_booking := public.ensure_booking_rent_cycle_state(v_payment.booking_id);

    SELECT *
    INTO v_booking
    FROM public.bookings
    WHERE id = v_payment.booking_id
    FOR UPDATE;

    v_already_advanced := lower(COALESCE(v_payment.metadata->>'cycle_advanced', 'false')) IN ('true', '1', 'yes');
    IF v_already_advanced THEN
        RETURN jsonb_build_object(
            'advanced', FALSE,
            'reason', 'already_advanced',
            'booking_id', v_booking.id,
            'payment_id', v_payment.id,
            'next_due_date', v_booking.next_due_date
        );
    END IF;

    IF v_booking.rent_cycle_closed_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'advanced', FALSE,
            'reason', 'cycle_closed',
            'booking_id', v_booking.id,
            'payment_id', v_payment.id
        );
    END IF;

    IF v_today < v_booking.next_due_date THEN
        RAISE EXCEPTION 'RENT_CYCLE_NOT_DUE';
    END IF;

    v_cycle_start := v_booking.current_cycle_start_date;
    v_next_due := v_booking.next_due_date;
    v_cycle_end := v_next_due;
    v_new_start := v_next_due;
    v_new_next_due := v_new_start + v_booking.cycle_duration_days;

    UPDATE public.bookings
    SET current_cycle_start_date = v_new_start,
        next_due_date = v_new_next_due,
        rent_payment_status = CASE
            WHEN v_new_next_due > v_today THEN 'not_due'
            ELSE 'paid'
        END,
        updated_at = timezone('utc', now())
    WHERE id = v_booking.id;

    UPDATE public.payments
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'cycle_covered_from', v_cycle_start::text,
            'cycle_covered_to', v_cycle_end::text,
            'cycle_start_date', v_cycle_start::text,
            'cycle_end_date', v_cycle_end::text,
            'cycle_duration_days', v_booking.cycle_duration_days,
            'next_due_date', v_next_due::text,
            'cycle_advanced', true,
            'cycle_advanced_at', timezone('utc', now()),
            'cycle_next_due_date', v_new_next_due::text
        ),
        updated_at = timezone('utc', now())
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
        'advanced', TRUE,
        'booking_id', v_booking.id,
        'payment_id', v_payment.id,
        'cycle_covered_from', v_cycle_start,
        'cycle_covered_to', v_cycle_end,
        'new_cycle_start_date', v_new_start,
        'new_next_due_date', v_new_next_due
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_due_rent_cycles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_today DATE := timezone('utc', now())::date;
    v_updated INTEGER := 0;
BEGIN
    UPDATE public.bookings
    SET rent_payment_status = CASE
            WHEN rent_cycle_closed_at IS NOT NULL
              OR lower(COALESCE(status::text, '')) IN ('checked-out', 'checked_out', 'vacated', 'completed', 'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'rejected', 'refunded')
                THEN COALESCE(rent_payment_status, 'not_due')
            WHEN COALESCE(next_due_date, v_today + 1) <= v_today
              AND lower(COALESCE(rent_payment_status, '')) <> 'failed'
                THEN 'pending'
            WHEN COALESCE(next_due_date, v_today + 1) > v_today
                THEN 'not_due'
            ELSE COALESCE(rent_payment_status, 'not_due')
        END,
        updated_at = timezone('utc', now())
    WHERE lower(COALESCE(status::text, '')) IN ('accepted', 'approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing')
      AND (
        (COALESCE(next_due_date, v_today + 1) <= v_today AND lower(COALESCE(rent_payment_status, '')) NOT IN ('pending', 'failed'))
        OR (COALESCE(next_due_date, v_today + 1) > v_today AND lower(COALESCE(rent_payment_status, '')) NOT IN ('not_due'))
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN COALESCE(v_updated, 0);
END;
$$;

SELECT public.sync_due_rent_cycles();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cron'
      AND p.proname = 'schedule'
  ) THEN
    BEGIN
      PERFORM cron.schedule(
        'sync-due-rent-cycles-every-30min',
        '*/30 * * * *',
        'SELECT public.sync_due_rent_cycles();'
      );
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN
        NULL;
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_cron schedule setup for sync_due_rent_cycles() due to insufficient privilege';
    END;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.sync_due_rent_cycles() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
