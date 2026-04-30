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
    v_booking public.bookings%ROWTYPE;
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

        SELECT *
        INTO v_booking
        FROM public.bookings
        WHERE id = NEW.booking_id
        LIMIT 1;

        IF FOUND THEN
            INSERT INTO public.rent (
                transaction_id,
                booking_id,
                owner_id,
                customer_id,
                amount,
                payment_status,
                cashfree_order_id,
                cf_payment_id,
                metadata,
                created_at,
                updated_at
            )
            VALUES (
                NEW.id,
                NEW.booking_id,
                v_booking.owner_id,
                COALESCE(NEW.customer_id, v_booking.customer_id),
                COALESCE(NEW.amount, 0),
                CASE
                    WHEN v_rent_state = 'paid' THEN 'success'
                    WHEN v_rent_state = 'refunded' THEN 'refunded'
                    WHEN v_rent_state = 'failed' THEN 'failed'
                    ELSE 'pending'
                END,
                NULLIF(trim(COALESCE(NEW.provider_order_id, '')), ''),
                NULLIF(trim(COALESCE(NEW.provider_payment_id, '')), ''),
                COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
                    'payment_id', NEW.id,
                    'payment_type', COALESCE(NEW.payment_type, 'monthly'),
                    'month', COALESCE(NEW.metadata->>'month', NEW.metadata->'client_context'->>'month'),
                    'source', 'payment_trigger'
                ),
                COALESCE(NEW.created_at, timezone('utc', now())),
                timezone('utc', now())
            )
            ON CONFLICT (transaction_id) DO UPDATE
            SET booking_id = EXCLUDED.booking_id,
                owner_id = EXCLUDED.owner_id,
                customer_id = EXCLUDED.customer_id,
                amount = EXCLUDED.amount,
                payment_status = EXCLUDED.payment_status,
                cashfree_order_id = EXCLUDED.cashfree_order_id,
                cf_payment_id = EXCLUDED.cf_payment_id,
                metadata = COALESCE(public.rent.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                updated_at = timezone('utc', now());
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

INSERT INTO public.rent (
    transaction_id,
    booking_id,
    owner_id,
    customer_id,
    amount,
    payment_status,
    cashfree_order_id,
    cf_payment_id,
    metadata,
    created_at,
    updated_at
)
SELECT
    p.id,
    p.booking_id,
    b.owner_id,
    COALESCE(p.customer_id, b.customer_id),
    COALESCE(p.amount, 0),
    CASE
        WHEN lower(COALESCE(p.payment_status, p.status, 'pending')) IN ('paid', 'completed', 'success', 'authorized') THEN 'success'
        WHEN lower(COALESCE(p.payment_status, p.status, 'pending')) = 'refunded' THEN 'refunded'
        WHEN lower(COALESCE(p.payment_status, p.status, 'pending')) IN ('failed', 'cancelled', 'expired', 'terminated') THEN 'failed'
        ELSE 'pending'
    END,
    NULLIF(trim(COALESCE(p.provider_order_id, '')), ''),
    NULLIF(trim(COALESCE(p.provider_payment_id, '')), ''),
    COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
        'payment_id', p.id,
        'payment_type', COALESCE(p.payment_type, 'monthly'),
        'month', COALESCE(p.metadata->>'month', p.metadata->'client_context'->>'month'),
        'source', 'payments_backfill'
    ),
    COALESCE(p.created_at, timezone('utc', now())),
    timezone('utc', now())
FROM public.payments p
JOIN public.bookings b
  ON b.id = p.booking_id
WHERE lower(COALESCE(p.payment_type, '')) IN ('rent', 'monthly')
ON CONFLICT (transaction_id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    owner_id = EXCLUDED.owner_id,
    customer_id = EXCLUDED.customer_id,
    amount = EXCLUDED.amount,
    payment_status = EXCLUDED.payment_status,
    cashfree_order_id = EXCLUDED.cashfree_order_id,
    cf_payment_id = EXCLUDED.cf_payment_id,
    metadata = COALESCE(public.rent.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = timezone('utc', now());

COMMIT;
