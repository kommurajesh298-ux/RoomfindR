BEGIN;
CREATE OR REPLACE FUNCTION public.owner_accept_booking_v2(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_status_lower TEXT;
  v_payment_state TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.owner_id IS DISTINCT FROM v_actor AND NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_status_lower := lower(COALESCE(v_booking.status::TEXT, ''));
  IF v_status_lower IN ('rejected', 'cancelled', 'refunded', 'checked-out', 'checked_out', 'completed') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE booking_id = p_booking_id
    AND payment_type = 'advance'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADVANCE_PAYMENT_NOT_FOUND';
  END IF;

  v_payment_state := lower(COALESCE(v_payment.payment_status, v_payment.status, 'pending'));
  IF v_payment_state NOT IN (
    'held',
    'eligible',
    'eligible_rejected',
    'payout_pending',
    'paid',
    'completed',
    'success',
    'authorized',
    'paid_pending_owner_acceptance'
  ) THEN
    RAISE EXCEPTION 'ADVANCE_NOT_HELD';
  END IF;

  UPDATE public.payments
  SET
    status = CASE
      WHEN lower(status) IN ('held', 'eligible_rejected', 'paid_pending_owner_acceptance') THEN 'eligible'
      ELSE status
    END,
    payment_status = CASE
      WHEN lower(payment_status) IN ('held', 'eligible_rejected', 'paid_pending_owner_acceptance') THEN 'eligible'
      ELSE payment_status
    END,
    settlement_status = 'eligible',
    payout_status = CASE WHEN lower(COALESCE(payout_status, 'pending')) = 'success' THEN payout_status ELSE 'pending' END,
    verification_status = CASE WHEN verification_status IN ('failed', 'verified') THEN verification_status ELSE 'verified' END,
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  UPDATE public.bookings
  SET
    status = CASE
      WHEN lower(COALESCE(status::TEXT, '')) IN ('approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
        THEN status
      ELSE 'approved'
    END,
    booking_status = CASE
      WHEN lower(COALESCE(booking_status, '')) IN ('approved', 'accepted', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
        THEN booking_status
      ELSE 'approved'
    END,
    owner_accept_status = TRUE,
    settlement_status = 'eligible',
    amount = COALESCE(amount, v_payment.amount, advance_amount, amount_due, advance_paid, 0),
    cashfree_order_id = COALESCE(cashfree_order_id, v_payment.cashfree_order_id),
    cf_payment_id = COALESCE(cf_payment_id, v_payment.cf_payment_id),
    payout_id = COALESCE(payout_id, v_payment.payout_id),
    reference_id = COALESCE(reference_id, v_payment.reference_id),
    verification_status = 'verified',
    updated_at = timezone('utc', now())
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  INSERT INTO public.settlements(
    booking_id, payment_id, owner_id, status, amount,
    cashfree_order_id, cf_payment_id, payout_id, reference_id,
    verification_status, metadata
  )
  VALUES (
    v_payment.booking_id, v_payment.id, v_booking.owner_id, 'eligible', COALESCE(v_payment.amount, 0),
    v_payment.cashfree_order_id, v_payment.cf_payment_id, v_payment.payout_id, v_payment.reference_id,
    'verified', jsonb_build_object('source', 'owner_accept_booking_v2')
  )
  ON CONFLICT (payment_id)
  DO UPDATE SET
    status = 'eligible',
    amount = EXCLUDED.amount,
    cashfree_order_id = EXCLUDED.cashfree_order_id,
    cf_payment_id = EXCLUDED.cf_payment_id,
    payout_id = EXCLUDED.payout_id,
    reference_id = EXCLUDED.reference_id,
    verification_status = 'verified',
    updated_at = timezone('utc', now());

  RETURN v_booking;
END;
$$;
GRANT EXECUTE ON FUNCTION public.owner_accept_booking_v2(UUID) TO authenticated, service_role;
COMMIT;
