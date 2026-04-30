BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_refund_request_v2(
  p_payment_id UUID DEFAULT NULL,
  p_booking_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_refund_amount NUMERIC DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(p_actor_id, auth.uid());
  v_payment public.payments%ROWTYPE;
  v_open_refund public.refunds%ROWTYPE;
  v_already_refunded NUMERIC := 0;
  v_refundable NUMERIC := 0;
  v_request_amount NUMERIC := 0;
  v_refund public.refunds%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF NOT public.is_admin(v_actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  ELSE
    SELECT * INTO v_payment
    FROM public.payments
    WHERE booking_id = p_booking_id AND payment_type = 'advance'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;

  -- Duplicate-click guard first: if an open refund exists, return deterministic duplicate payload.
  SELECT * INTO v_open_refund
  FROM public.refunds
  WHERE payment_id = v_payment.id
    AND status IN ('refund_requested','processing')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'payment_id', v_payment.id,
      'booking_id', v_payment.booking_id,
      'refund_row_id', v_open_refund.id,
      'idempotency_key', v_open_refund.idempotency_key,
      'amount', v_open_refund.amount
    );
  END IF;

  IF lower(COALESCE(v_payment.status, 'pending')) NOT IN ('held','paid') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_REFUNDABLE';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_already_refunded
  FROM public.refunds
  WHERE payment_id = v_payment.id
    AND status = 'refunded';

  v_refundable := GREATEST(COALESCE(v_payment.amount, 0) - v_already_refunded, 0);
  IF v_refundable <= 0 THEN RAISE EXCEPTION 'REFUND_NOT_ALLOWED'; END IF;

  v_request_amount := round(COALESCE(p_refund_amount, v_refundable)::numeric, 2);
  IF v_request_amount <= 0 OR v_request_amount > v_refundable THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  INSERT INTO public.refunds(
    booking_id, payment_id, status, amount,
    cashfree_order_id, cf_payment_id, payout_id, reference_id,
    idempotency_key, reason, verification_status, request_payload, requested_by
  )
  VALUES (
    v_payment.booking_id, v_payment.id, 'refund_requested', v_request_amount,
    v_payment.cashfree_order_id, v_payment.cf_payment_id, v_payment.payout_id, v_payment.reference_id,
    gen_random_uuid()::text,
    COALESCE(NULLIF(trim(p_reason), ''), 'Admin initiated refund'),
    'pending',
    jsonb_build_object(
      'previous_payment_status', v_payment.status,
      'previous_settlement_status', v_payment.settlement_status,
      'requested_by', v_actor,
      'requested_at', timezone('utc', now()),
      'ip', p_ip
    ),
    v_actor
  )
  RETURNING * INTO v_refund;

  UPDATE public.payments
  SET
    status = 'refund_requested',
    payment_status = 'refund_requested',
    refund_status = 'processing',
    settlement_status = 'refund_requested',
    verification_status = 'pending',
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id;

  UPDATE public.bookings
  SET settlement_status = 'refund_requested', verification_status = 'pending', updated_at = timezone('utc', now())
  WHERE id = v_payment.booking_id;

  UPDATE public.settlements
  SET status = 'refund_requested', verification_status = 'pending', updated_at = timezone('utc', now())
  WHERE payment_id = v_payment.id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'refund_row_id', v_refund.id,
    'idempotency_key', v_refund.idempotency_key,
    'amount', v_refund.amount,
    'cashfree_order_id', v_refund.cashfree_order_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_refund_request_v2(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated, service_role;
COMMIT;
