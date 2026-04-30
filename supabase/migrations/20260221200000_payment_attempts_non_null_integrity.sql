-- Ensure payment_attempts always map to a concrete payment + booking.
-- This removes orphan webhook rows and prevents future NULL linkage columns.

BEGIN;
-- 1) Backfill missing linkage/data from payments using available provider identifiers.
WITH candidate_match AS (
    SELECT
        pa.id AS payment_attempt_id,
        p.id AS payment_id,
        p.booking_id,
        p.provider_order_id,
        p.provider_payment_id,
        p.provider_session_id,
        p.idempotency_key,
        lower(coalesce(p.metadata ->> 'upi_method', p.metadata ->> 'upiMethod', '')) AS upi_method
    FROM public.payment_attempts pa
    JOIN LATERAL (
        SELECT p.*
        FROM public.payments p
        WHERE (pa.payment_id IS NOT NULL AND p.id = pa.payment_id)
           OR (pa.provider_order_id IS NOT NULL AND p.provider_order_id = pa.provider_order_id)
           OR (pa.provider_payment_id IS NOT NULL AND p.provider_payment_id = pa.provider_payment_id)
        ORDER BY p.created_at DESC
        LIMIT 1
    ) p ON TRUE
)
UPDATE public.payment_attempts pa
SET payment_id = COALESCE(pa.payment_id, m.payment_id),
    booking_id = COALESCE(pa.booking_id, m.booking_id),
    provider_order_id = COALESCE(pa.provider_order_id, m.provider_order_id),
    provider_payment_id = COALESCE(pa.provider_payment_id, m.provider_payment_id),
    provider_session_id = COALESCE(pa.provider_session_id, m.provider_session_id),
    idempotency_key = COALESCE(pa.idempotency_key, m.idempotency_key),
    upi_app = COALESCE(
        pa.upi_app,
        CASE
            WHEN m.upi_method LIKE '%phonepe%' THEN 'phonepe'
            WHEN m.upi_method LIKE '%paytm%' THEN 'paytm'
            WHEN m.upi_method LIKE '%gpay%' OR m.upi_method LIKE '%google%' THEN 'gpay'
            WHEN m.upi_method = '' THEN NULL
            ELSE m.upi_method
        END
    )
FROM candidate_match m
WHERE pa.id = m.payment_attempt_id;
-- 2) Remove orphan attempts that still cannot be tied to any payment/booking.
DELETE FROM public.payment_attempts
WHERE payment_id IS NULL
   OR booking_id IS NULL;
-- 3) Enforce linkage at write-time (insert/update) so nulls cannot reappear.
CREATE OR REPLACE FUNCTION public.fill_and_guard_payment_attempt_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_payment public.payments%ROWTYPE;
    v_upi_method TEXT;
BEGIN
    IF NEW.payment_id IS NULL
       OR NEW.booking_id IS NULL
       OR NEW.provider_session_id IS NULL
       OR NEW.idempotency_key IS NULL
       OR NEW.upi_app IS NULL
    THEN
        SELECT *
        INTO v_payment
        FROM public.payments p
        WHERE (NEW.payment_id IS NOT NULL AND p.id = NEW.payment_id)
           OR (NEW.provider_order_id IS NOT NULL AND p.provider_order_id = NEW.provider_order_id)
           OR (NEW.provider_payment_id IS NOT NULL AND p.provider_payment_id = NEW.provider_payment_id)
        ORDER BY p.created_at DESC
        LIMIT 1;

        IF FOUND THEN
            NEW.payment_id := COALESCE(NEW.payment_id, v_payment.id);
            NEW.booking_id := COALESCE(NEW.booking_id, v_payment.booking_id);
            NEW.provider_order_id := COALESCE(NEW.provider_order_id, v_payment.provider_order_id);
            NEW.provider_payment_id := COALESCE(NEW.provider_payment_id, v_payment.provider_payment_id);
            NEW.provider_session_id := COALESCE(NEW.provider_session_id, v_payment.provider_session_id);
            NEW.idempotency_key := COALESCE(NEW.idempotency_key, v_payment.idempotency_key);

            IF NEW.upi_app IS NULL THEN
                v_upi_method := lower(coalesce(v_payment.metadata ->> 'upi_method', v_payment.metadata ->> 'upiMethod', ''));
                NEW.upi_app := CASE
                    WHEN v_upi_method LIKE '%phonepe%' THEN 'phonepe'
                    WHEN v_upi_method LIKE '%paytm%' THEN 'paytm'
                    WHEN v_upi_method LIKE '%gpay%' OR v_upi_method LIKE '%google%' THEN 'gpay'
                    WHEN v_upi_method = '' THEN NULL
                    ELSE v_upi_method
                END;
            END IF;
        END IF;
    END IF;

    IF NEW.payment_id IS NULL OR NEW.booking_id IS NULL THEN
        RAISE EXCEPTION 'payment_attempts must include payment_id and booking_id';
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_attempts_fill_guard ON public.payment_attempts;
CREATE TRIGGER payment_attempts_fill_guard
BEFORE INSERT OR UPDATE ON public.payment_attempts
FOR EACH ROW
EXECUTE FUNCTION public.fill_and_guard_payment_attempt_links();
-- 4) Harden schema-level constraints.
ALTER TABLE public.payment_attempts
    ALTER COLUMN payment_id SET NOT NULL,
    ALTER COLUMN booking_id SET NOT NULL;
COMMIT;
