-- cashfree realtime payout/refund rebuild

BEGIN;
-- 1) Canonical columns on existing tables
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cashfree_order_id TEXT,
  ADD COLUMN IF NOT EXISTS cf_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_id TEXT,
  ADD COLUMN IF NOT EXISTS reference_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending';
UPDATE public.bookings
SET amount = COALESCE(amount, advance_amount, amount_due, advance_paid, 0)
WHERE amount IS NULL;
UPDATE public.bookings
SET verification_status = COALESCE(NULLIF(lower(trim(verification_status)), ''), 'pending');
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_verification_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'failed', 'skipped'));
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS cf_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_id TEXT,
  ADD COLUMN IF NOT EXISTS reference_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_allowed,
  DROP CONSTRAINT IF EXISTS payments_payment_status_allowed,
  DROP CONSTRAINT IF EXISTS payments_status_sync,
  DROP CONSTRAINT IF EXISTS payments_refund_status_check,
  DROP CONSTRAINT IF EXISTS payments_settlement_status_check,
  DROP CONSTRAINT IF EXISTS payments_verification_status_check;
UPDATE public.payments
SET cf_payment_id = COALESCE(NULLIF(trim(cf_payment_id), ''), NULLIF(trim(provider_payment_id), ''))
WHERE COALESCE(trim(cf_payment_id), '') = '';
UPDATE public.payments
SET payout_id = COALESCE(NULLIF(trim(payout_id), ''), NULLIF(trim(cashfree_payout_id), ''))
WHERE COALESCE(trim(payout_id), '') = '';
UPDATE public.payments
SET reference_id = COALESCE(
  NULLIF(trim(reference_id), ''),
  NULLIF(trim(payout_reference_id), ''),
  NULLIF(trim(provider_reference), ''),
  NULLIF(trim(refund_reference_id), '')
)
WHERE COALESCE(trim(reference_id), '') = '';
UPDATE public.payments
SET verification_status = COALESCE(NULLIF(lower(trim(verification_status)), ''), 'pending');
UPDATE public.payments
SET status = CASE
  WHEN lower(COALESCE(trim(status), '')) IN (
    'created','pending','processing','authorized','held','eligible','eligible_rejected',
    'payout_pending','paid','completed','success','refund_requested','refunded',
    'failed','cancelled','expired','terminated'
  ) THEN lower(trim(status))
  WHEN lower(COALESCE(trim(status), '')) = 'paid_pending_owner_acceptance' THEN 'held'
  WHEN lower(COALESCE(trim(status), '')) = 'eligible_for_admin_review' THEN 'eligible'
  WHEN lower(COALESCE(trim(status), '')) IN ('settled') THEN 'paid'
  WHEN lower(COALESCE(trim(status), '')) IN ('rejected') THEN 'eligible_rejected'
  ELSE 'pending'
END;
UPDATE public.payments
SET payment_status = CASE
  WHEN lower(COALESCE(trim(payment_status), '')) IN (
    'created','pending','processing','authorized','held','eligible','eligible_rejected',
    'payout_pending','paid','completed','success','refund_requested','refunded',
    'failed','cancelled','expired','terminated'
  ) THEN lower(trim(payment_status))
  WHEN lower(COALESCE(trim(payment_status), '')) = 'paid_pending_owner_acceptance' THEN 'held'
  WHEN lower(COALESCE(trim(payment_status), '')) = 'eligible_for_admin_review' THEN 'eligible'
  WHEN lower(COALESCE(trim(payment_status), '')) IN ('settled') THEN 'paid'
  WHEN lower(COALESCE(trim(payment_status), '')) IN ('rejected') THEN 'eligible_rejected'
  ELSE COALESCE(lower(NULLIF(trim(status), '')), 'pending')
END;
UPDATE public.payments
SET refund_status = CASE
  WHEN refund_status IN ('not_requested','pending','processing','partial','success','failed') THEN refund_status
  WHEN lower(COALESCE(trim(refund_status), '')) IN ('none','not_requested') THEN 'not_requested'
  WHEN lower(COALESCE(trim(refund_status), '')) IN ('requested','refund_requested') THEN 'processing'
  WHEN lower(COALESCE(trim(refund_status), '')) IN ('refunded','completed','success') THEN 'success'
  WHEN lower(COALESCE(trim(refund_status), '')) IN ('error','failed','failure') THEN 'failed'
  ELSE 'not_requested'
END;
UPDATE public.payments
SET settlement_status = CASE
  WHEN settlement_status IN (
    'pending','not_eligible','held','eligible','eligible_for_admin_review','payout_pending',
    'paid','settled','refund_requested','refunded','rejected','failed'
  ) THEN settlement_status
  WHEN lower(COALESCE(trim(settlement_status), '')) IN ('paid_pending_owner_acceptance') THEN 'held'
  WHEN lower(COALESCE(trim(settlement_status), '')) IN ('completed','success') THEN 'paid'
  WHEN lower(COALESCE(trim(settlement_status), '')) IN ('processing') THEN 'payout_pending'
  WHEN lower(COALESCE(trim(settlement_status), '')) IN ('requested','eligible_for_review') THEN 'eligible'
  WHEN lower(COALESCE(trim(settlement_status), '')) IN ('cancelled','terminated') THEN 'failed'
  ELSE 'pending'
END;
UPDATE public.payments
SET verification_status = CASE
  WHEN verification_status IN ('pending', 'verified', 'failed', 'skipped') THEN verification_status
  WHEN lower(COALESCE(trim(verification_status), '')) IN ('true', 'ok', 'valid', 'success') THEN 'verified'
  WHEN lower(COALESCE(trim(verification_status), '')) IN ('false', 'invalid', 'error') THEN 'failed'
  ELSE 'pending'
END;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_allowed
  CHECK (
    lower(status) IN (
      'created','pending','processing','authorized','held','eligible','eligible_rejected',
      'payout_pending','paid','completed','success','refund_requested','refunded',
      'failed','cancelled','expired','terminated'
    )
  ),
  ADD CONSTRAINT payments_payment_status_allowed
  CHECK (
    lower(payment_status) IN (
      'created','pending','processing','authorized','held','eligible','eligible_rejected',
      'payout_pending','paid','completed','success','refund_requested','refunded',
      'failed','cancelled','expired','terminated'
    )
  ),
  ADD CONSTRAINT payments_status_sync CHECK (lower(status) = lower(payment_status)),
  ADD CONSTRAINT payments_refund_status_check
  CHECK (refund_status IN ('not_requested','pending','processing','partial','success','failed')),
  ADD CONSTRAINT payments_settlement_status_check
  CHECK (settlement_status IN (
    'pending','not_eligible','held','eligible','eligible_for_admin_review','payout_pending',
    'paid','settled','refund_requested','refunded','rejected','failed'
  )),
  ADD CONSTRAINT payments_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'failed', 'skipped'));
ALTER TABLE public.payments
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN payment_status SET DEFAULT 'pending',
  ALTER COLUMN refund_status SET DEFAULT 'not_requested',
  ALTER COLUMN verification_status SET DEFAULT 'pending';
DROP TRIGGER IF EXISTS trg_enforce_payment_success_requires_webhook ON public.payments;
DROP FUNCTION IF EXISTS public.enforce_payment_success_requires_webhook();
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_verification_status ON public.payments(verification_status);
CREATE INDEX IF NOT EXISTS idx_payments_reference_id ON public.payments(reference_id);
CREATE INDEX IF NOT EXISTS idx_payments_cf_payment_id ON public.payments(cf_payment_id);
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cashfree_order_id TEXT,
  ADD COLUMN IF NOT EXISTS cf_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS reference_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS bank_ref_no TEXT,
  ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS actioned_by UUID REFERENCES auth.users(id);
UPDATE public.payouts
SET status = COALESCE(NULLIF(lower(trim(status)), ''),
  CASE lower(COALESCE(payout_status, 'pending'))
    WHEN 'success' THEN 'paid'
    WHEN 'processing' THEN 'processing'
    WHEN 'failed' THEN 'failed'
    ELSE 'pending'
  END
)
WHERE status IS NULL OR trim(status) = '';
UPDATE public.payouts
SET reference_id = COALESCE(NULLIF(trim(reference_id), ''), NULLIF(trim(payout_reference_id), ''))
WHERE COALESCE(trim(reference_id), '') = '';
UPDATE public.payouts
SET verification_status = COALESCE(NULLIF(lower(trim(verification_status)), ''), 'pending');
ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE public.payouts
  ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('pending','payout_requested','processing','paid','failed','rejected'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_idempotency_key ON public.payouts(idempotency_key)
WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payouts_status_v2 ON public.payouts(status);
-- 2) Clean tables for refunds/settlements/webhooks/admin audit
CREATE TABLE IF NOT EXISTS public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'refund_requested' CHECK (status IN ('refund_requested','processing','refunded','failed','cancelled')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  cashfree_order_id TEXT,
  cf_payment_id TEXT,
  payout_id TEXT,
  reference_id TEXT,
  refund_id TEXT,
  idempotency_key TEXT NOT NULL,
  reason TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','failed','skipped')),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_event_id TEXT,
  requested_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_idempotency_key ON public.refunds(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_refund_id ON public.refunds(refund_id)
WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON public.refunds(payment_id);
CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','held','eligible','payout_pending','paid','refund_requested','refunded','rejected','failed')),
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  cashfree_order_id TEXT,
  cf_payment_id TEXT,
  payout_id TEXT,
  reference_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','failed','skipped')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_payment_unique ON public.settlements(payment_id);
CREATE INDEX IF NOT EXISTS idx_settlements_booking_id ON public.settlements(booking_id);
CREATE INDEX IF NOT EXISTS idx_settlements_owner_id ON public.settlements(owner_id);
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  cashfree_order_id TEXT,
  cf_payment_id TEXT,
  payout_id TEXT,
  reference_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','failed','skipped')),
  idempotency_key TEXT,
  provider_event_id TEXT,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address INET,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_logs_idempotency_key ON public.webhook_logs(idempotency_key)
WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_logs_source_created_at ON public.webhook_logs(source, created_at DESC);
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  status TEXT NOT NULL DEFAULT 'success',
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  cashfree_order_id TEXT,
  cf_payment_id TEXT,
  payout_id TEXT,
  reference_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','failed','skipped')),
  ip_address INET,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_actor_created_at ON public.admin_actions(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON public.admin_actions(target_type, target_id);
-- 3) Replace legacy RPCs with strict v2 flow
DROP FUNCTION IF EXISTS public.reserve_advance_payout(UUID);
DROP FUNCTION IF EXISTS public.apply_advance_payout_result(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.mark_advance_refunded(UUID, TEXT, TEXT);
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
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF v_booking.owner_id IS DISTINCT FROM v_actor AND NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE booking_id = p_booking_id
    AND payment_type = 'advance'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ADVANCE_PAYMENT_NOT_FOUND'; END IF;
  IF lower(COALESCE(v_payment.status, 'pending')) NOT IN ('held','eligible','eligible_rejected','payout_pending','paid') THEN
    RAISE EXCEPTION 'ADVANCE_NOT_HELD';
  END IF;

  UPDATE public.payments
  SET
    status = CASE WHEN lower(status) IN ('held','eligible_rejected') THEN 'eligible' ELSE status END,
    payment_status = CASE WHEN lower(payment_status) IN ('held','eligible_rejected') THEN 'eligible' ELSE payment_status END,
    settlement_status = 'eligible',
    payout_status = CASE WHEN lower(COALESCE(payout_status, 'pending')) = 'success' THEN payout_status ELSE 'pending' END,
    verification_status = CASE WHEN verification_status IN ('failed','verified') THEN verification_status ELSE 'verified' END,
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  UPDATE public.bookings
  SET
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
    'verified', jsonb_build_object('source','owner_accept_booking_v2')
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
GRANT EXECUTE ON FUNCTION public.owner_accept_booking_v2(UUID) TO authenticated;
CREATE OR REPLACE FUNCTION public.reserve_advance_payout_v2(
  p_payment_id UUID DEFAULT NULL,
  p_booking_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
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
  v_booking public.bookings%ROWTYPE;
  v_payout public.payouts%ROWTYPE;
  v_idempotency TEXT;
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
  IF lower(COALESCE(v_payment.status, 'pending')) IN ('paid','refunded') THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_FINALIZED';
  END IF;
  IF lower(COALESCE(v_payment.status, 'pending')) NOT IN ('eligible','eligible_rejected','payout_pending') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_ELIGIBLE';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_payment.booking_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF COALESCE(v_booking.owner_accept_status, FALSE) = FALSE THEN
    RAISE EXCEPTION 'OWNER_ACCEPTANCE_REQUIRED';
  END IF;

  SELECT * INTO v_payout FROM public.payouts WHERE payment_id = v_payment.id FOR UPDATE;

  IF FOUND AND lower(COALESCE(v_payout.status, 'pending')) IN ('payout_requested','processing') THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'payment_id', v_payment.id,
      'booking_id', v_payment.booking_id,
      'owner_id', v_booking.owner_id,
      'amount', v_payment.amount,
      'payout_row_id', v_payout.id,
      'idempotency_key', v_payout.idempotency_key,
      'payout_status', v_payout.status
    );
  END IF;

  v_idempotency := COALESCE(v_payout.idempotency_key, gen_random_uuid()::text);

  INSERT INTO public.payouts(
    id, booking_id, payment_id, owner_id,
    status, payout_status, amount,
    cashfree_order_id, cf_payment_id,
    payout_id, reference_id, payout_reference_id,
    verification_status, idempotency_key,
    request_payload, actioned_by
  )
  VALUES (
    COALESCE(v_payout.id, gen_random_uuid()),
    v_payment.booking_id, v_payment.id, v_booking.owner_id,
    'payout_requested', 'processing', COALESCE(v_payment.amount, 0),
    v_payment.cashfree_order_id, v_payment.cf_payment_id,
    v_payment.payout_id, v_payment.reference_id, v_payment.reference_id,
    'pending', v_idempotency,
    jsonb_build_object('reason', p_reason, 'requested_by', v_actor, 'requested_at', timezone('utc', now()), 'ip', p_ip),
    v_actor
  )
  ON CONFLICT (payment_id)
  DO UPDATE SET
    status = 'payout_requested',
    payout_status = 'processing',
    amount = EXCLUDED.amount,
    owner_id = EXCLUDED.owner_id,
    cashfree_order_id = EXCLUDED.cashfree_order_id,
    cf_payment_id = EXCLUDED.cf_payment_id,
    verification_status = 'pending',
    idempotency_key = COALESCE(public.payouts.idempotency_key, EXCLUDED.idempotency_key),
    request_payload = public.payouts.request_payload || EXCLUDED.request_payload,
    actioned_by = v_actor,
    updated_at = timezone('utc', now())
  RETURNING * INTO v_payout;

  UPDATE public.payments
  SET
    status = 'payout_pending',
    payment_status = 'payout_pending',
    settlement_status = 'payout_pending',
    payout_status = 'processing',
    verification_status = 'pending',
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id;

  UPDATE public.bookings
  SET
    settlement_status = 'payout_pending',
    admin_confirm_status = FALSE,
    verification_status = 'pending',
    updated_at = timezone('utc', now())
  WHERE id = v_payment.booking_id;

  INSERT INTO public.settlements(
    booking_id, payment_id, owner_id, status, amount,
    cashfree_order_id, cf_payment_id, payout_id, reference_id,
    verification_status, metadata
  )
  VALUES (
    v_payment.booking_id, v_payment.id, v_booking.owner_id,
    'payout_pending', COALESCE(v_payment.amount, 0),
    v_payment.cashfree_order_id, v_payment.cf_payment_id,
    v_payment.payout_id, v_payment.reference_id,
    'pending', jsonb_build_object('source', 'reserve_advance_payout_v2')
  )
  ON CONFLICT (payment_id)
  DO UPDATE SET
    status = 'payout_pending',
    amount = EXCLUDED.amount,
    verification_status = 'pending',
    updated_at = timezone('utc', now());

  RETURN jsonb_build_object(
    'duplicate', false,
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'owner_id', v_booking.owner_id,
    'amount', v_payment.amount,
    'payout_row_id', v_payout.id,
    'idempotency_key', v_payout.idempotency_key,
    'payout_status', v_payout.status
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_advance_payout_v2(UUID, UUID, UUID, TEXT, TEXT) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reject_advance_payout_v2(
  p_payment_id UUID DEFAULT NULL,
  p_booking_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
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
  IF lower(COALESCE(v_payment.status, 'pending')) IN ('paid','refunded') THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_FINALIZED';
  END IF;

  UPDATE public.payments
  SET
    status = 'eligible_rejected',
    payment_status = 'eligible_rejected',
    settlement_status = 'rejected',
    payout_status = 'failed',
    verification_status = 'verified',
    failure_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Payout rejected by admin'),
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id;

  UPDATE public.bookings
  SET settlement_status = 'rejected', verification_status = 'verified', updated_at = timezone('utc', now())
  WHERE id = v_payment.booking_id;

  UPDATE public.payouts
  SET status = 'rejected', payout_status = 'failed', verification_status = 'verified',
      failure_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Payout rejected by admin'),
      actioned_by = v_actor, updated_at = timezone('utc', now())
  WHERE payment_id = v_payment.id;

  UPDATE public.settlements
  SET status = 'rejected', verification_status = 'verified', updated_at = timezone('utc', now())
  WHERE payment_id = v_payment.id;

  RETURN jsonb_build_object('payment_id', v_payment.id, 'booking_id', v_payment.booking_id, 'status', 'rejected');
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_advance_payout_v2(UUID, UUID, UUID, TEXT, TEXT) TO authenticated, service_role;
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
  IF lower(COALESCE(v_payment.status, 'pending')) NOT IN ('held','paid') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_REFUNDABLE';
  END IF;

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
CREATE OR REPLACE FUNCTION public.record_refund_provider_request_v2(
  p_refund_row_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_provider_refund_id TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_provider_status TEXT DEFAULT NULL,
  p_api_response JSONB DEFAULT '{}'::jsonb,
  p_failure_reason TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(p_actor_id, auth.uid());
  v_refund public.refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_refund_status TEXT := 'processing';
  v_prev_payment_status TEXT := 'held';
  v_prev_settlement_status TEXT := 'held';
  v_is_failure BOOLEAN := FALSE;
  v_safe_ip INET := NULL;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF NOT public.is_admin(v_actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  IF p_refund_row_id IS NULL THEN RAISE EXCEPTION 'REFUND_ROW_ID_REQUIRED'; END IF;

  SELECT * INTO v_refund
  FROM public.refunds
  WHERE id = p_refund_row_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_NOT_FOUND'; END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = v_refund.payment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;

  IF COALESCE(NULLIF(trim(p_ip), ''), '') <> '' THEN
    BEGIN
      v_safe_ip := p_ip::inet;
    EXCEPTION WHEN OTHERS THEN
      v_safe_ip := NULL;
    END;
  END IF;

  v_is_failure := lower(COALESCE(p_provider_status, '')) LIKE '%fail%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%reject%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%cancel%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%error%';

  v_refund_status := CASE WHEN v_is_failure THEN 'failed' ELSE 'processing' END;

  UPDATE public.refunds
  SET
    refund_id = COALESCE(NULLIF(trim(p_provider_refund_id), ''), refund_id),
    reference_id = COALESCE(NULLIF(trim(p_reference_id), ''), NULLIF(trim(p_provider_refund_id), ''), reference_id),
    status = v_refund_status,
    verification_status = CASE WHEN v_is_failure THEN 'failed' ELSE 'pending' END,
    response_payload = response_payload
      || COALESCE(p_api_response, '{}'::jsonb)
      || jsonb_strip_nulls(
        jsonb_build_object(
          'provider_status', p_provider_status,
          'failure_reason', p_failure_reason,
          'recorded_at', timezone('utc', now())
        )
      ),
    updated_at = timezone('utc', now())
  WHERE id = v_refund.id
  RETURNING * INTO v_refund;

  IF v_is_failure THEN
    v_prev_payment_status := lower(COALESCE(v_refund.request_payload->>'previous_payment_status', 'held'));
    v_prev_settlement_status := lower(COALESCE(v_refund.request_payload->>'previous_settlement_status', 'held'));

    UPDATE public.payments
    SET
      status = CASE WHEN v_prev_payment_status = 'paid' THEN 'paid' ELSE 'held' END,
      payment_status = CASE WHEN v_prev_payment_status = 'paid' THEN 'paid' ELSE 'held' END,
      refund_status = 'failed',
      settlement_status = CASE WHEN v_prev_settlement_status IN ('held','eligible','paid') THEN v_prev_settlement_status ELSE 'held' END,
      reference_id = COALESCE(v_refund.reference_id, reference_id),
      verification_status = 'failed',
      failure_reason = COALESCE(NULLIF(trim(p_failure_reason), ''), 'Refund provider request failed'),
      updated_at = timezone('utc', now())
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    UPDATE public.bookings
    SET
      settlement_status = CASE WHEN v_prev_settlement_status IN ('held','eligible','paid') THEN v_prev_settlement_status ELSE 'held' END,
      reference_id = COALESCE(v_refund.reference_id, reference_id),
      verification_status = 'failed',
      updated_at = timezone('utc', now())
    WHERE id = v_payment.booking_id;

    UPDATE public.settlements
    SET
      status = CASE WHEN v_prev_settlement_status IN ('held','eligible','paid') THEN v_prev_settlement_status ELSE 'held' END,
      reference_id = COALESCE(v_refund.reference_id, reference_id),
      verification_status = 'failed',
      updated_at = timezone('utc', now())
    WHERE payment_id = v_payment.id;
  ELSE
    UPDATE public.payments
    SET
      status = 'refund_requested',
      payment_status = 'refund_requested',
      refund_status = 'processing',
      settlement_status = 'refund_requested',
      reference_id = COALESCE(v_refund.reference_id, reference_id),
      verification_status = 'pending',
      updated_at = timezone('utc', now())
    WHERE id = v_payment.id;

    UPDATE public.bookings
    SET
      settlement_status = 'refund_requested',
      reference_id = COALESCE(v_refund.reference_id, reference_id),
      verification_status = 'pending',
      updated_at = timezone('utc', now())
    WHERE id = v_payment.booking_id;

    UPDATE public.settlements
    SET
      status = 'refund_requested',
      reference_id = COALESCE(v_refund.reference_id, reference_id),
      verification_status = 'pending',
      updated_at = timezone('utc', now())
    WHERE payment_id = v_payment.id;
  END IF;

  INSERT INTO public.admin_actions(
    actor_id,
    action_type,
    target_type,
    target_id,
    status,
    amount,
    cashfree_order_id,
    cf_payment_id,
    reference_id,
    verification_status,
    ip_address,
    request_payload,
    response_payload
  )
  VALUES (
    v_actor,
    'REFUND_PROVIDER_REQUEST',
    'refund',
    v_refund.id,
    CASE WHEN v_is_failure THEN 'failed' ELSE 'processing' END,
    COALESCE(v_refund.amount, 0),
    v_refund.cashfree_order_id,
    v_refund.cf_payment_id,
    COALESCE(v_refund.reference_id, p_reference_id, p_provider_refund_id),
    CASE WHEN v_is_failure THEN 'failed' ELSE 'pending' END,
    v_safe_ip,
    jsonb_strip_nulls(
      jsonb_build_object(
        'provider_refund_id', p_provider_refund_id,
        'provider_status', p_provider_status
      )
    ),
    COALESCE(p_api_response, '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'refund_row_id', v_refund.id,
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'status', v_refund.status,
    'refund_id', v_refund.refund_id,
    'reference_id', v_refund.reference_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_refund_provider_request_v2(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.apply_payment_webhook_v2(
  p_order_id TEXT,
  p_cf_payment_id TEXT,
  p_provider_status TEXT,
  p_event_id TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_is_success BOOLEAN := FALSE;
  v_is_failure BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE cashfree_order_id = p_order_id
     OR provider_order_id = p_order_id
     OR order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;

  v_is_success := lower(COALESCE(p_provider_status, '')) LIKE '%success%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%paid%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%complete%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%captured%';

  v_is_failure := lower(COALESCE(p_provider_status, '')) LIKE '%fail%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%cancel%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%expire%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%terminate%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%reject%';

  IF v_is_success THEN
    IF lower(COALESCE(v_payment.payment_type, 'advance')) = 'advance' THEN
      UPDATE public.payments
      SET status = 'held', payment_status = 'held', settlement_status = 'held', payout_status = 'pending',
          cf_payment_id = COALESCE(NULLIF(trim(p_cf_payment_id), ''), cf_payment_id),
          verification_status = 'verified', verification_source = 'webhook',
          webhook_event_id = COALESCE(NULLIF(trim(p_event_id), ''), webhook_event_id),
          webhook_verified_at = timezone('utc', now()), failure_reason = NULL, updated_at = timezone('utc', now())
      WHERE id = v_payment.id;

      UPDATE public.bookings
      SET payment_status = 'paid', advance_payment_status = 'paid', settlement_status = 'held',
          cf_payment_id = COALESCE(cf_payment_id, p_cf_payment_id),
          verification_status = 'verified', updated_at = timezone('utc', now())
      WHERE id = v_payment.booking_id;

      UPDATE public.settlements
      SET status = 'held', cf_payment_id = COALESCE(cf_payment_id, p_cf_payment_id), verification_status = 'verified', updated_at = timezone('utc', now())
      WHERE payment_id = v_payment.id;
    ELSE
      UPDATE public.payments
      SET status = 'paid', payment_status = 'paid', settlement_status = 'paid', payout_status = 'success',
          cf_payment_id = COALESCE(NULLIF(trim(p_cf_payment_id), ''), cf_payment_id),
          verification_status = 'verified', verification_source = 'webhook',
          webhook_event_id = COALESCE(NULLIF(trim(p_event_id), ''), webhook_event_id),
          webhook_verified_at = timezone('utc', now()), failure_reason = NULL, updated_at = timezone('utc', now())
      WHERE id = v_payment.id;

      UPDATE public.bookings
      SET rent_payment_status = 'paid', cf_payment_id = COALESCE(cf_payment_id, p_cf_payment_id),
          verification_status = 'verified', updated_at = timezone('utc', now())
      WHERE id = v_payment.booking_id;

      UPDATE public.settlements
      SET status = 'paid', cf_payment_id = COALESCE(cf_payment_id, p_cf_payment_id), verification_status = 'verified', updated_at = timezone('utc', now())
      WHERE payment_id = v_payment.id;
    END IF;
  ELSIF v_is_failure AND lower(COALESCE(v_payment.status, 'pending')) NOT IN ('paid','refunded') THEN
    UPDATE public.payments
    SET status = 'failed', payment_status = 'failed', verification_status = 'verified',
        verification_source = 'webhook', webhook_event_id = COALESCE(NULLIF(trim(p_event_id), ''), webhook_event_id),
        webhook_verified_at = timezone('utc', now()), failure_reason = COALESCE(failure_reason, 'Payment failed via webhook'),
        updated_at = timezone('utc', now())
    WHERE id = v_payment.id;
  END IF;

  RETURN jsonb_build_object('payment_id', v_payment.id, 'booking_id', v_payment.booking_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_payment_webhook_v2(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.apply_payout_webhook_v2(
  p_payout_id TEXT,
  p_reference_id TEXT,
  p_provider_status TEXT,
  p_bank_ref_no TEXT DEFAULT NULL,
  p_event_id TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.payouts%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_success BOOLEAN;
  v_failure BOOLEAN;
BEGIN
  SELECT * INTO v_payout
  FROM public.payouts
  WHERE (COALESCE(NULLIF(trim(p_payout_id), ''), '__none__') <> '__none__' AND payout_id = p_payout_id)
     OR (COALESCE(NULLIF(trim(p_reference_id), ''), '__none__') <> '__none__' AND reference_id = p_reference_id)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PAYOUT_NOT_FOUND'; END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = v_payout.payment_id
  FOR UPDATE;

  v_success := lower(COALESCE(p_provider_status, '')) LIKE '%success%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%paid%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%complete%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%processed%';

  v_failure := lower(COALESCE(p_provider_status, '')) LIKE '%fail%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%reject%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%cancel%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%error%';

  UPDATE public.payouts
  SET
    payout_id = COALESCE(NULLIF(trim(p_payout_id), ''), payout_id),
    reference_id = COALESCE(NULLIF(trim(p_reference_id), ''), reference_id),
    payout_reference_id = COALESCE(NULLIF(trim(p_reference_id), ''), payout_reference_id),
    bank_ref_no = COALESCE(NULLIF(trim(p_bank_ref_no), ''), bank_ref_no),
    provider_status = COALESCE(NULLIF(trim(p_provider_status), ''), provider_status),
    response_payload = response_payload || COALESCE(p_payload, '{}'::jsonb),
    status = CASE WHEN v_success THEN 'paid' WHEN v_failure THEN 'failed' ELSE 'processing' END,
    payout_status = CASE WHEN v_success THEN 'success' WHEN v_failure THEN 'failed' ELSE 'processing' END,
    verification_status = CASE WHEN v_success OR v_failure THEN 'verified' ELSE 'pending' END,
    failure_reason = CASE WHEN v_failure THEN COALESCE(failure_reason, 'Payout failed from webhook') ELSE NULL END,
    processed_at = CASE WHEN v_success THEN timezone('utc', now()) ELSE processed_at END,
    updated_at = timezone('utc', now())
  WHERE id = v_payout.id
  RETURNING * INTO v_payout;

  IF v_success THEN
    UPDATE public.payments
    SET status = CASE WHEN lower(status) = 'refunded' THEN 'refunded' ELSE 'paid' END,
        payment_status = CASE WHEN lower(payment_status) = 'refunded' THEN 'refunded' ELSE 'paid' END,
        settlement_status = CASE WHEN lower(status) = 'refunded' THEN 'refunded' ELSE 'paid' END,
        payout_status = 'success',
        payout_id = COALESCE(v_payout.payout_id, payout_id),
        reference_id = COALESCE(v_payout.reference_id, reference_id),
        verification_status = 'verified',
        failure_reason = NULL,
        updated_at = timezone('utc', now())
    WHERE id = v_payment.id;

    UPDATE public.bookings
    SET settlement_status = CASE WHEN lower(COALESCE(v_payment.status, '')) = 'refunded' THEN 'refunded' ELSE 'paid' END,
        payout_id = COALESCE(v_payout.payout_id, payout_id),
        reference_id = COALESCE(v_payout.reference_id, reference_id),
        verification_status = 'verified',
        admin_confirm_status = TRUE,
        updated_at = timezone('utc', now())
    WHERE id = v_payment.booking_id;

    UPDATE public.settlements
    SET status = CASE WHEN lower(COALESCE(v_payment.status, '')) = 'refunded' THEN 'refunded' ELSE 'paid' END,
        payout_id = COALESCE(v_payout.payout_id, payout_id),
        reference_id = COALESCE(v_payout.reference_id, reference_id),
        verification_status = 'verified', updated_at = timezone('utc', now())
    WHERE payment_id = v_payment.id;
  ELSIF v_failure AND lower(COALESCE(v_payment.status, 'pending')) NOT IN ('paid','refunded') THEN
    UPDATE public.payments
    SET status = 'eligible', payment_status = 'eligible', settlement_status = 'eligible',
        payout_status = 'failed', verification_status = 'verified',
        failure_reason = COALESCE(failure_reason, 'Payout failed from webhook'),
        updated_at = timezone('utc', now())
    WHERE id = v_payment.id;

    UPDATE public.bookings
    SET settlement_status = 'eligible', verification_status = 'verified', updated_at = timezone('utc', now())
    WHERE id = v_payment.booking_id;

    UPDATE public.settlements
    SET status = 'eligible', verification_status = 'verified', updated_at = timezone('utc', now())
    WHERE payment_id = v_payment.id;
  END IF;

  RETURN jsonb_build_object('payment_id', v_payment.id, 'booking_id', v_payment.booking_id, 'payout_row_id', v_payout.id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_payout_webhook_v2(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.apply_refund_webhook_v2(
  p_refund_id TEXT,
  p_reference_id TEXT,
  p_provider_status TEXT,
  p_event_id TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_total_refunded NUMERIC := 0;
  v_is_success BOOLEAN;
  v_is_failure BOOLEAN;
  v_prev_status TEXT;
  v_prev_settlement TEXT;
  v_is_full BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_refund
  FROM public.refunds
  WHERE (COALESCE(NULLIF(trim(p_refund_id), ''), '__none__') <> '__none__' AND refund_id = p_refund_id)
     OR (COALESCE(NULLIF(trim(p_reference_id), ''), '__none__') <> '__none__' AND reference_id = p_reference_id)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_NOT_FOUND'; END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = v_refund.payment_id
  FOR UPDATE;

  v_is_success := lower(COALESCE(p_provider_status, '')) LIKE '%success%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%complete%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%processed%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%refunded%';

  v_is_failure := lower(COALESCE(p_provider_status, '')) LIKE '%fail%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%reject%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%cancel%'
    OR lower(COALESCE(p_provider_status, '')) LIKE '%error%';

  UPDATE public.refunds
  SET refund_id = COALESCE(NULLIF(trim(p_refund_id), ''), refund_id),
      reference_id = COALESCE(NULLIF(trim(p_reference_id), ''), NULLIF(trim(p_refund_id), ''), reference_id),
      response_payload = response_payload || COALESCE(p_payload, '{}'::jsonb),
      webhook_event_id = COALESCE(NULLIF(trim(p_event_id), ''), webhook_event_id),
      status = CASE WHEN v_is_success THEN 'refunded' WHEN v_is_failure THEN 'failed' ELSE 'processing' END,
      verification_status = CASE WHEN v_is_success OR v_is_failure THEN 'verified' ELSE 'pending' END,
      processed_at = CASE WHEN v_is_success THEN timezone('utc', now()) ELSE processed_at END,
      updated_at = timezone('utc', now())
  WHERE id = v_refund.id
  RETURNING * INTO v_refund;

  IF v_is_success THEN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_refunded
    FROM public.refunds
    WHERE payment_id = v_payment.id
      AND status = 'refunded';

    v_is_full := (v_total_refunded + 0.01) >= COALESCE(v_payment.amount, 0);

    IF v_is_full THEN
      UPDATE public.payments
      SET status = 'refunded', payment_status = 'refunded', refund_status = 'success', settlement_status = 'refunded',
          verification_status = 'verified', reference_id = COALESCE(v_refund.reference_id, reference_id),
          refunded_at = COALESCE(refunded_at, timezone('utc', now())), failure_reason = NULL, updated_at = timezone('utc', now())
      WHERE id = v_payment.id;

      UPDATE public.bookings
      SET payment_status = 'refunded', advance_payment_status = 'refunded', settlement_status = 'refunded',
          reference_id = COALESCE(v_refund.reference_id, reference_id), verification_status = 'verified', updated_at = timezone('utc', now())
      WHERE id = v_payment.booking_id;

      UPDATE public.settlements
      SET status = 'refunded', reference_id = COALESCE(v_refund.reference_id, reference_id), verification_status = 'verified', updated_at = timezone('utc', now())
      WHERE payment_id = v_payment.id;
    ELSE
      v_prev_status := lower(COALESCE(v_refund.request_payload->>'previous_payment_status', 'held'));
      v_prev_settlement := lower(COALESCE(v_refund.request_payload->>'previous_settlement_status', 'held'));

      UPDATE public.payments
      SET status = CASE WHEN v_prev_status = 'paid' THEN 'paid' ELSE 'held' END,
          payment_status = CASE WHEN v_prev_status = 'paid' THEN 'paid' ELSE 'held' END,
          refund_status = 'partial',
          settlement_status = CASE WHEN v_prev_settlement IN ('held','eligible','paid') THEN v_prev_settlement ELSE 'held' END,
          verification_status = 'verified', reference_id = COALESCE(v_refund.reference_id, reference_id), failure_reason = NULL,
          updated_at = timezone('utc', now())
      WHERE id = v_payment.id;
    END IF;
  ELSIF v_is_failure THEN
    v_prev_status := lower(COALESCE(v_refund.request_payload->>'previous_payment_status', 'held'));
    v_prev_settlement := lower(COALESCE(v_refund.request_payload->>'previous_settlement_status', 'held'));

    UPDATE public.payments
    SET status = CASE WHEN v_prev_status = 'paid' THEN 'paid' ELSE 'held' END,
        payment_status = CASE WHEN v_prev_status = 'paid' THEN 'paid' ELSE 'held' END,
        refund_status = 'failed',
        settlement_status = CASE WHEN v_prev_settlement IN ('held','eligible','paid') THEN v_prev_settlement ELSE 'held' END,
        verification_status = 'verified', failure_reason = COALESCE(failure_reason, 'Refund failed from webhook'),
        updated_at = timezone('utc', now())
    WHERE id = v_payment.id;
  END IF;

  RETURN jsonb_build_object('refund_row_id', v_refund.id, 'payment_id', v_payment.id, 'booking_id', v_payment.booking_id, 'full_refund', v_is_full);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_refund_webhook_v2(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
-- 4) RLS + realtime for new tables
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refunds_select ON public.refunds;
DROP POLICY IF EXISTS refunds_admin_write ON public.refunds;
CREATE POLICY refunds_select ON public.refunds
FOR SELECT
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = refunds.booking_id
      AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid())
  )
);
CREATE POLICY refunds_admin_write ON public.refunds
FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS settlements_select ON public.settlements;
DROP POLICY IF EXISTS settlements_admin_write ON public.settlements;
CREATE POLICY settlements_select ON public.settlements
FOR SELECT
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = settlements.booking_id
      AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid())
  )
);
CREATE POLICY settlements_admin_write ON public.settlements
FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS webhook_logs_select_admin ON public.webhook_logs;
DROP POLICY IF EXISTS webhook_logs_admin_write ON public.webhook_logs;
CREATE POLICY webhook_logs_select_admin ON public.webhook_logs FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY webhook_logs_admin_write ON public.webhook_logs FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_actions_select_admin ON public.admin_actions;
DROP POLICY IF EXISTS admin_actions_admin_write ON public.admin_actions;
CREATE POLICY admin_actions_select_admin ON public.admin_actions FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY admin_actions_admin_write ON public.admin_actions FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.payouts REPLICA IDENTITY FULL;
ALTER TABLE public.refunds REPLICA IDENTITY FULL;
ALTER TABLE public.settlements REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'refunds'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.refunds; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'settlements'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.settlements; END IF;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
