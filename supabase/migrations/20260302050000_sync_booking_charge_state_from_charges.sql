BEGIN;
CREATE OR REPLACE FUNCTION public.sync_booking_charge_columns_from_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state TEXT := lower(COALESCE(NEW.charge_status, NEW.status, ''));
  v_charge_type TEXT := lower(COALESCE(NEW.charge_type, ''));
  v_is_upfront BOOLEAN := COALESCE(NULLIF(v_charge_type, ''), 'advance') IN ('advance', 'full', 'booking', 'deposit');
  v_paid_like BOOLEAN := v_state IN (
    'paid',
    'success',
    'completed',
    'authorized',
    'held',
    'eligible',
    'payout_pending',
    'paid_pending_owner_acceptance'
  );
  v_failed_like BOOLEAN := v_state IN ('failed', 'cancelled', 'canceled', 'expired', 'terminated', 'rejected');
  v_amount NUMERIC := COALESCE(NEW.amount, 0);
BEGIN
  IF NEW.booking_id IS NULL OR NOT v_is_upfront THEN
    RETURN NEW;
  END IF;

  UPDATE public.bookings b
  SET
    charge_status = CASE
      WHEN v_paid_like THEN 'paid'
      WHEN v_failed_like THEN CASE WHEN lower(COALESCE(b.charge_status, '')) = 'paid' THEN b.charge_status ELSE 'failed' END
      ELSE CASE WHEN lower(COALESCE(b.charge_status, '')) = 'paid' THEN b.charge_status ELSE 'pending' END
    END,
    advance_charge_status = CASE
      WHEN v_paid_like THEN 'paid'
      WHEN v_failed_like THEN CASE WHEN lower(COALESCE(b.advance_charge_status, '')) = 'paid' THEN b.advance_charge_status ELSE 'failed' END
      ELSE CASE WHEN lower(COALESCE(b.advance_charge_status, '')) = 'paid' THEN b.advance_charge_status ELSE 'pending' END
    END,
    amount_paid = CASE
      WHEN v_paid_like THEN GREATEST(COALESCE(b.amount_paid, 0), COALESCE(b.advance_paid, 0), v_amount)
      ELSE b.amount_paid
    END,
    advance_paid = CASE
      WHEN v_paid_like THEN GREATEST(COALESCE(b.advance_paid, 0), v_amount)
      ELSE b.advance_paid
    END,
    payment_status = CASE
      WHEN v_paid_like THEN 'paid'
      WHEN v_failed_like AND lower(COALESCE(b.payment_status, '')) <> 'paid' THEN 'failed'
      ELSE b.payment_status
    END,
    updated_at = timezone('utc', now())
  WHERE b.id = NEW.booking_id;

  RETURN NEW;
END;
$$;
DO $$
BEGIN
  IF to_regclass('public.charges') IS NULL THEN
    RAISE NOTICE 'Skipping charge->booking sync migration because public.charges does not exist.';
  ELSE
    EXECUTE $q$
      WITH paid_upfront AS (
        SELECT
          c.booking_id,
          MAX(COALESCE(c.amount, 0)) AS paid_amount
        FROM public.charges c
        WHERE lower(COALESCE(c.charge_status, c.status, '')) IN (
          'paid',
          'success',
          'completed',
          'authorized',
          'held',
          'eligible',
          'payout_pending',
          'paid_pending_owner_acceptance'
        )
          AND COALESCE(NULLIF(lower(COALESCE(c.charge_type, '')), ''), 'advance') IN ('advance', 'full', 'booking', 'deposit')
        GROUP BY c.booking_id
      )
      UPDATE public.bookings b
      SET
        charge_status = 'paid',
        advance_charge_status = 'paid',
        payment_status = CASE
          WHEN lower(COALESCE(b.payment_status, '')) = 'paid' THEN b.payment_status
          ELSE 'paid'
        END,
        amount_paid = GREATEST(COALESCE(b.amount_paid, 0), COALESCE(b.advance_paid, 0), p.paid_amount),
        advance_paid = GREATEST(COALESCE(b.advance_paid, 0), p.paid_amount),
        updated_at = timezone('utc', now())
      FROM paid_upfront p
      WHERE b.id = p.booking_id
        AND (
          lower(COALESCE(b.charge_status, '')) <> 'paid'
          OR lower(COALESCE(b.advance_charge_status, '')) <> 'paid'
          OR COALESCE(b.amount_paid, 0) < p.paid_amount
          OR COALESCE(b.advance_paid, 0) < p.paid_amount
          OR lower(COALESCE(b.payment_status, '')) <> 'paid'
        );
    $q$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_booking_charge_columns_from_charge ON public.charges';

    EXECUTE $q$
      CREATE TRIGGER trg_sync_booking_charge_columns_from_charge
      AFTER INSERT OR UPDATE OF status, charge_status, charge_type, amount
      ON public.charges
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_booking_charge_columns_from_charge();
    $q$;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_booking_charge_columns_from_charge() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
