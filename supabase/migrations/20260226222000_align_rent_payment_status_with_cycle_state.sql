BEGIN;
ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_rent_payment_status_check;
ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_rent_payment_status_check CHECK (
        rent_payment_status IN ('not_due', 'pending', 'paid', 'failed')
    );
ALTER TABLE public.bookings
    ALTER COLUMN rent_payment_status SET DEFAULT 'not_due';
-- Active bookings that are still inside the current paid cycle should not be marked pending.
UPDATE public.bookings b
SET rent_payment_status = 'not_due',
    updated_at = timezone('utc', now())
WHERE lower(COALESCE(b.rent_payment_status, '')) = 'pending'
  AND b.rent_cycle_closed_at IS NULL
  AND COALESCE(b.next_due_date, timezone('utc', now())::date + 1) > timezone('utc', now())::date
  AND lower(COALESCE(b.status::text, '')) NOT IN (
      'checked-out',
      'checked_out',
      'vacated',
      'completed',
      'cancelled',
      'cancelled_by_customer',
      'cancelled-by-customer',
      'rejected'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.booking_id = b.id
        AND lower(COALESCE(p.payment_type, '')) = 'rent'
  );
-- Ensure advance-payment trigger/updater keeps rent cycle state aligned.
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
                     rent_payment_status = CASE
                         WHEN rent_cycle_closed_at IS NULL
                              AND COALESCE(next_due_date, timezone(''utc'', now())::date + 1) > timezone(''utc'', now())::date
                              THEN ''not_due''
                         ELSE rent_payment_status
                     END,
                     updated_at = timezone(''utc'', now())
                 WHERE id = $3',
                v_payment_status_cast_type
            )
            USING v_booking_payment_state, v_advance_state, NEW.booking_id;
        ELSE
            UPDATE public.bookings
            SET payment_status = v_booking_payment_state,
                advance_payment_status = v_advance_state,
                rent_payment_status = CASE
                    WHEN rent_cycle_closed_at IS NULL
                         AND COALESCE(next_due_date, timezone('utc', now())::date + 1) > timezone('utc', now())::date
                         THEN 'not_due'
                    ELSE rent_payment_status
                END,
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
NOTIFY pgrst, 'reload schema';
COMMIT;
