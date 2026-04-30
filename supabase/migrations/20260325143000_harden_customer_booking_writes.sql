ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers can create bookings" ON public.bookings;
DROP POLICY IF EXISTS bookings_insert ON public.bookings;
DROP POLICY IF EXISTS "System can create payments" ON public.payments;
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payments_update ON public.payments;
DROP POLICY IF EXISTS payments_related_insert ON public.payments;

CREATE OR REPLACE FUNCTION public.guard_customer_booking_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF v_actor IS NULL OR public.is_admin(v_actor) OR OLD.owner_id = v_actor THEN
        RETURN NEW;
    END IF;

    IF OLD.customer_id IS DISTINCT FROM v_actor THEN
        RETURN NEW;
    END IF;

    IF (
        to_jsonb(NEW) - ARRAY['status', 'stay_status', 'vacate_date', 'updated_at']::text[]
    ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['status', 'stay_status', 'vacate_date', 'updated_at']::text[]
    ) THEN
        RAISE EXCEPTION 'Customers cannot modify booking pricing, ownership, payment, or review fields directly'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'payment_pending'
       AND NEW.stay_status IS NOT DISTINCT FROM OLD.stay_status
       AND NEW.vacate_date IS NOT DISTINCT FROM OLD.vacate_date THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'vacate_requested'
       AND NEW.stay_status = 'vacate_requested'
       AND NEW.vacate_date IS NOT DISTINCT FROM OLD.vacate_date THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Customers cannot apply this booking state change directly'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_customer_booking_updates_trg ON public.bookings;
CREATE TRIGGER guard_customer_booking_updates_trg
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.guard_customer_booking_updates();
