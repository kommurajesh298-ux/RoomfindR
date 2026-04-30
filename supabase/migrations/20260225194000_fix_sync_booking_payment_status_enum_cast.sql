-- Ensure booking payment status trigger works with enum-typed legacy columns.
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
        WHEN v_payment_state IN ('paid', 'completed', 'success', 'paid_pending_owner_acceptance') THEN 'paid'
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
    ELSIF v_payment_type = 'rent' THEN
        UPDATE public.bookings
        SET rent_payment_status = v_rent_state,
            updated_at = timezone('utc', now())
        WHERE id = NEW.booking_id;
    END IF;

    RETURN NEW;
END;
$$;
COMMIT;
