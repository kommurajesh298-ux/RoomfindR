BEGIN;
-- Disable automatic refunds (admin-only refunds)
DROP TRIGGER IF EXISTS bookings_refund_trigger ON public.bookings;
DROP TRIGGER IF EXISTS payments_refund_trigger ON public.payments;
-- Settlement preparation only (no payout execution)
CREATE OR REPLACE FUNCTION public.prepare_settlement_for_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_payment_amount NUMERIC;
    v_fee_pct NUMERIC;
    v_platform_fee NUMERIC;
    v_gross NUMERIC;
    v_net NUMERIC;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF lower(coalesce(v_booking.status::text, '')) NOT IN ('accepted','approved') THEN
        RETURN;
    END IF;

    SELECT amount INTO v_payment_amount
    FROM public.payments
    WHERE booking_id = p_booking_id
      AND status IN ('completed','success','authorized')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_payment_amount IS NULL THEN
        RETURN;
    END IF;

    v_gross := COALESCE(v_payment_amount, v_booking.amount_paid, v_booking.amount_due, v_booking.advance_paid, 0);

    SELECT value::numeric INTO v_fee_pct
    FROM public.config
    WHERE key = 'platform_fee_percentage';

    v_fee_pct := COALESCE(v_fee_pct, 0);
    v_platform_fee := ROUND((v_gross * v_fee_pct) / 100, 2);
    v_net := GREATEST(0, v_gross - v_platform_fee);

    INSERT INTO public.settlements (
        booking_id,
        owner_id,
        week_start_date,
        week_end_date,
        period_type,
        total_amount,
        platform_fee,
        net_payable,
        refunded_amount,
        status
    )
    VALUES (
        v_booking.id,
        v_booking.owner_id,
        v_booking.start_date,
        COALESCE(v_booking.end_date, v_booking.start_date),
        'WEEKLY',
        v_gross,
        v_platform_fee,
        v_net,
        0,
        'PENDING'
    )
    ON CONFLICT (booking_id) DO NOTHING;
END;
$$;
CREATE OR REPLACE FUNCTION public.trigger_booking_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF lower(coalesce(NEW.status::text, '')) IN ('accepted','approved') THEN
            PERFORM public.prepare_settlement_for_booking(NEW.id);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_settlement_trigger ON public.bookings;
CREATE TRIGGER bookings_settlement_trigger
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trigger_booking_settlement();
COMMIT;
