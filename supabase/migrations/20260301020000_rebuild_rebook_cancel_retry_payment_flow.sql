BEGIN;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER,
  ADD COLUMN IF NOT EXISTS cf_order_id TEXT,
  ADD COLUMN IF NOT EXISTS cf_payment_session_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_state TEXT,
  ADD COLUMN IF NOT EXISTS last_provider_check_at TIMESTAMPTZ;
UPDATE public.payments
SET cf_order_id = COALESCE(
  NULLIF(trim(cf_order_id), ''),
  NULLIF(trim(cashfree_order_id), ''),
  NULLIF(trim(provider_order_id), ''),
  NULLIF(trim(order_id), '')
)
WHERE COALESCE(trim(cf_order_id), '') = '';
UPDATE public.payments
SET cf_payment_session_id = COALESCE(
  NULLIF(trim(cf_payment_session_id), ''),
  NULLIF(trim(provider_session_id), '')
)
WHERE COALESCE(trim(cf_payment_session_id), '') = '';
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at ASC, id ASC) AS rn
  FROM public.payments
)
UPDATE public.payments p
SET attempt_number = ranked.rn
FROM ranked
WHERE p.id = ranked.id
  AND (p.attempt_number IS NULL OR p.attempt_number <= 0);
ALTER TABLE public.payments
  ALTER COLUMN attempt_number SET DEFAULT 1;
UPDATE public.payments
SET attempt_number = 1
WHERE attempt_number IS NULL OR attempt_number <= 0;
ALTER TABLE public.payments
  ALTER COLUMN attempt_number SET NOT NULL;
UPDATE public.payments
SET attempt_state = CASE
  WHEN lower(COALESCE(payment_status, status, '')) = 'created' THEN 'initiated'
  WHEN lower(COALESCE(payment_status, status, '')) IN ('pending', 'processing', 'authorized') THEN 'pending'
  WHEN lower(COALESCE(payment_status, status, '')) IN ('paid', 'completed', 'success', 'held', 'eligible', 'eligible_rejected', 'payout_pending', 'refunded') THEN 'success'
  WHEN lower(COALESCE(payment_status, status, '')) = 'cancelled' THEN 'cancelled'
  WHEN lower(COALESCE(payment_status, status, '')) IN ('expired', 'terminated') THEN 'expired'
  ELSE 'failed'
END
WHERE COALESCE(trim(attempt_state), '') = '';
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_attempt_state_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_attempt_state_check
  CHECK (attempt_state IN ('initiated', 'pending', 'success', 'failed', 'cancelled', 'expired'));
ALTER TABLE public.payments
  ALTER COLUMN attempt_state SET DEFAULT 'initiated';
UPDATE public.payments
SET attempt_state = 'initiated'
WHERE attempt_state IS NULL;
ALTER TABLE public.payments
  ALTER COLUMN attempt_state SET NOT NULL;
WITH open_attempts AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at DESC, id DESC) AS rn
  FROM public.payments
  WHERE attempt_state IN ('initiated', 'pending')
)
UPDATE public.payments p
SET
  status = 'failed',
  payment_status = 'failed',
  attempt_state = 'failed',
  failure_reason = COALESCE(NULLIF(trim(p.failure_reason), ''), 'Superseded by newer payment attempt'),
  updated_at = timezone('utc', now())
FROM open_attempts o
WHERE p.id = o.id
  AND o.rn > 1
  AND lower(COALESCE(p.status, '')) NOT IN ('paid', 'completed', 'success', 'refunded');
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_cf_order_id_unique
  ON public.payments(cf_order_id)
  WHERE cf_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_attempt_state
  ON public.payments(attempt_state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_single_active_attempt_per_booking
  ON public.payments(booking_id)
  WHERE attempt_state IN ('initiated', 'pending');
CREATE OR REPLACE FUNCTION public.sync_payment_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.status, '') = '' THEN
    NEW.status := COALESCE(NEW.payment_status, 'pending');
  END IF;

  IF COALESCE(NEW.payment_status, '') = '' THEN
    NEW.payment_status := COALESCE(NEW.status, 'pending');
  END IF;

  IF COALESCE(NEW.refund_status, '') = '' THEN
    NEW.refund_status := 'not_requested';
  END IF;

  NEW.status := lower(NEW.status);
  NEW.payment_status := lower(NEW.payment_status);
  NEW.refund_status := lower(NEW.refund_status);

  IF NEW.order_id IS NULL THEN
    NEW.order_id := COALESCE(NEW.cf_order_id, NEW.cashfree_order_id, NEW.provider_order_id);
  END IF;

  IF NEW.cf_order_id IS NULL THEN
    NEW.cf_order_id := COALESCE(NEW.order_id, NEW.cashfree_order_id, NEW.provider_order_id);
  END IF;

  IF NEW.cashfree_order_id IS NULL THEN
    NEW.cashfree_order_id := COALESCE(NEW.cf_order_id, NEW.order_id, NEW.provider_order_id);
  END IF;

  IF NEW.provider_order_id IS NULL THEN
    NEW.provider_order_id := COALESCE(NEW.cf_order_id, NEW.order_id, NEW.cashfree_order_id);
  END IF;

  IF NEW.order_id IS NULL THEN
    NEW.order_id := COALESCE(NEW.cf_order_id, NEW.cashfree_order_id, NEW.provider_order_id);
  END IF;

  IF NEW.cf_payment_session_id IS NULL THEN
    NEW.cf_payment_session_id := NEW.provider_session_id;
  END IF;

  IF NEW.provider_session_id IS NULL THEN
    NEW.provider_session_id := NEW.cf_payment_session_id;
  END IF;

  IF NEW.provider_reference IS NULL THEN
    NEW.provider_reference := NEW.cashfree_payout_id;
  END IF;

  IF NEW.cashfree_payout_id IS NULL THEN
    NEW.cashfree_payout_id := NEW.provider_reference;
  END IF;

  IF NEW.payout_status IS NOT NULL THEN
    NEW.payout_status := lower(NEW.payout_status);
  END IF;

  IF NEW.attempt_number IS NULL OR NEW.attempt_number <= 0 THEN
    NEW.attempt_number := 1;
  END IF;

  IF COALESCE(NEW.attempt_state, '') = '' THEN
    NEW.attempt_state := CASE
      WHEN NEW.status = 'created' THEN 'initiated'
      WHEN NEW.status IN ('pending', 'processing', 'authorized') THEN 'pending'
      WHEN NEW.status = 'cancelled' THEN 'cancelled'
      WHEN NEW.status IN ('expired', 'terminated') THEN 'expired'
      WHEN NEW.status IN ('paid', 'completed', 'success', 'held', 'eligible', 'eligible_rejected', 'payout_pending', 'refunded') THEN 'success'
      ELSE 'failed'
    END;
  END IF;

  NEW.attempt_state := lower(NEW.attempt_state);

  IF NEW.status = 'created' THEN
    NEW.attempt_state := 'initiated';
  ELSIF NEW.status IN ('pending', 'processing', 'authorized') THEN
    NEW.attempt_state := 'pending';
  ELSIF NEW.status = 'cancelled' THEN
    NEW.attempt_state := 'cancelled';
  ELSIF NEW.status IN ('expired', 'terminated') THEN
    NEW.attempt_state := 'expired';
  ELSIF NEW.status IN ('paid', 'completed', 'success', 'held', 'eligible', 'eligible_rejected', 'payout_pending', 'refunded') THEN
    NEW.attempt_state := 'success';
  ELSIF NEW.status IN ('failed', 'rejected') THEN
    NEW.attempt_state := 'failed';
  END IF;

  IF NEW.attempt_state NOT IN ('initiated', 'pending', 'success', 'failed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'INVALID_ATTEMPT_STATE';
  END IF;

  IF NEW.refund_status = 'success' THEN
    NEW.status := 'refunded';
    NEW.payment_status := 'refunded';
    NEW.attempt_state := 'success';
    IF NEW.refunded_at IS NULL THEN
      NEW.refunded_at := timezone('utc', now());
    END IF;
  END IF;

  IF NEW.status = 'refunded' THEN
    NEW.refund_status := 'success';
    NEW.attempt_state := 'success';
    IF NEW.refunded_at IS NULL THEN
      NEW.refunded_at := timezone('utc', now());
    END IF;
  END IF;

  IF NEW.attempt_state IN ('success', 'failed', 'cancelled', 'expired') THEN
    NEW.last_provider_check_at := COALESCE(NEW.last_provider_check_at, timezone('utc', now()));
  END IF;

  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.start_payment_attempt_v3(
  p_booking_id UUID,
  p_payment_type TEXT,
  p_amount NUMERIC,
  p_user_id UUID DEFAULT NULL,
  p_hostel_id UUID DEFAULT NULL,
  p_destination TEXT DEFAULT NULL,
  p_rent_cycle_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_payment_method TEXT DEFAULT 'upi'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_attempt INTEGER;
  v_type TEXT := lower(COALESCE(trim(p_payment_type), 'advance'));
  v_destination TEXT;
  v_rent_cycle_id TEXT := NULLIF(trim(COALESCE(p_rent_cycle_id, '')), '');
  v_order_id TEXT;
  v_idempotency TEXT;
  v_prefix TEXT;
  v_terminal_booking BOOLEAN;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_ID_REQUIRED';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  IF v_type NOT IN ('advance', 'rent') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TYPE';
  END IF;

  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  v_terminal_booking := lower(COALESCE(v_booking.booking_status, v_booking.status::text, '')) IN (
    'cancelled',
    'cancelled_by_customer',
    'rejected',
    'checked_out',
    'completed',
    'vacated',
    'expired'
  );

  IF v_terminal_booking THEN
    RAISE EXCEPTION 'BOOKING_NOT_ACTIVE_FOR_PAYMENT';
  END IF;

  IF v_type = 'rent' AND v_rent_cycle_id IS NULL THEN
    RAISE EXCEPTION 'RENT_CYCLE_REQUIRED';
  END IF;

  UPDATE public.payments
  SET
    status = 'failed',
    payment_status = 'failed',
    attempt_state = 'failed',
    failure_reason = COALESCE(NULLIF(trim(failure_reason), ''), 'Superseded by newer payment attempt'),
    updated_at = timezone('utc', now())
  WHERE booking_id = p_booking_id
    AND attempt_state IN ('initiated', 'pending')
    AND lower(COALESCE(status, '')) NOT IN ('paid', 'completed', 'success', 'refunded');

  SELECT COALESCE(MAX(attempt_number), 0) + 1
  INTO v_attempt
  FROM public.payments
  WHERE booking_id = p_booking_id;

  v_prefix := CASE WHEN v_type = 'rent' THEN 'rent' ELSE 'adv' END;
  v_order_id := format(
    '%s_%s_%s_%s',
    v_prefix,
    substr(replace(p_booking_id::text, '-', ''), 1, 10),
    extract(epoch from clock_timestamp())::bigint,
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
  );
  v_order_id := substr(v_order_id, 1, 50);
  v_idempotency := format('payment_attempt:%s:%s:%s', p_booking_id, v_attempt, v_order_id);

  v_destination := CASE
    WHEN v_type = 'rent' THEN 'owner_direct'
    ELSE 'admin_account'
  END;

  INSERT INTO public.payments (
    booking_id,
    user_id,
    hostel_id,
    payment_type,
    amount,
    status,
    payment_status,
    attempt_state,
    attempt_number,
    order_id,
    cf_order_id,
    cashfree_order_id,
    provider_order_id,
    idempotency_key,
    verification_source,
    destination,
    settlement_status,
    payout_status,
    rent_commission,
    payment_method,
    rent_cycle_id,
    metadata
  ) VALUES (
    p_booking_id,
    p_user_id,
    p_hostel_id,
    v_type,
    round(p_amount::numeric, 2),
    'created',
    'created',
    'initiated',
    v_attempt,
    v_order_id,
    v_order_id,
    v_order_id,
    v_order_id,
    v_idempotency,
    'system',
    v_destination,
    'pending',
    'pending',
    CASE WHEN v_type = 'rent' THEN 0 ELSE 0 END,
    COALESCE(NULLIF(trim(p_payment_method), ''), 'upi'),
    CASE WHEN v_type = 'rent' THEN v_rent_cycle_id ELSE NULL END,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'attempt_number', v_attempt,
      'attempt_state', 'initiated',
      'created_via', 'start_payment_attempt_v3'
    )
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'order_id', v_order_id,
    'cf_order_id', v_order_id,
    'attempt_number', v_attempt,
    'idempotency_key', v_idempotency
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_payment_attempt_gateway_created_v3(
  p_payment_id UUID,
  p_payment_session_id TEXT,
  p_provider_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ID_REQUIRED';
  END IF;

  IF COALESCE(trim(p_payment_session_id), '') = '' THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_REQUIRED';
  END IF;

  UPDATE public.payments
  SET
    provider_session_id = trim(p_payment_session_id),
    cf_payment_session_id = trim(p_payment_session_id),
    status = 'pending',
    payment_status = 'pending',
    attempt_state = 'pending',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'provider_order_create', COALESCE(p_provider_payload, '{}'::jsonb),
      'provider_session_set_at', timezone('utc', now())
    ),
    updated_at = timezone('utc', now())
  WHERE id = p_payment_id
    AND attempt_state IN ('initiated', 'pending')
    AND lower(COALESCE(status, '')) IN ('created', 'pending', 'processing', 'authorized')
  RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ATTEMPT_SUPERSEDED_OR_FINALIZED';
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'order_id', COALESCE(v_payment.cf_order_id, v_payment.order_id, v_payment.cashfree_order_id, v_payment.provider_order_id),
    'payment_session_id', v_payment.cf_payment_session_id,
    'status', v_payment.status,
    'attempt_state', v_payment.attempt_state
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_payment_attempt_not_paid_v3(
  p_payment_id UUID,
  p_state TEXT DEFAULT 'failed',
  p_reason TEXT DEFAULT NULL,
  p_provider_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_state TEXT := lower(COALESCE(NULLIF(trim(p_state), ''), 'failed'));
  v_status TEXT;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ID_REQUIRED';
  END IF;

  IF v_state NOT IN ('failed', 'cancelled', 'expired') THEN
    v_state := 'failed';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF lower(COALESCE(v_payment.status, '')) IN ('paid', 'completed', 'success', 'refunded')
     OR lower(COALESCE(v_payment.attempt_state, '')) = 'success' THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'booking_id', v_payment.booking_id,
      'status', v_payment.status,
      'attempt_state', v_payment.attempt_state,
      'unchanged', true
    );
  END IF;

  v_status := CASE
    WHEN v_state = 'cancelled' THEN 'cancelled'
    WHEN v_state = 'expired' THEN 'expired'
    ELSE 'failed'
  END;

  UPDATE public.payments
  SET
    status = v_status,
    payment_status = v_status,
    attempt_state = v_state,
    verification_source = 'system',
    failure_reason = COALESCE(NULLIF(trim(p_reason), ''), failure_reason, 'Payment not completed'),
    last_provider_check_at = timezone('utc', now()),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'provider_verification', COALESCE(p_provider_payload, '{}'::jsonb),
      'last_non_paid_state', v_state,
      'last_non_paid_at', timezone('utc', now())
    ),
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  UPDATE public.bookings
  SET
    payment_status = CASE
      WHEN lower(COALESCE(payment_status, '')) = 'paid' THEN payment_status
      ELSE 'failed'
    END,
    advance_payment_status = CASE
      WHEN lower(COALESCE(v_payment.payment_type, '')) = 'advance'
           AND lower(COALESCE(advance_payment_status, '')) <> 'paid' THEN 'failed'
      ELSE advance_payment_status
    END,
    rent_payment_status = CASE
      WHEN lower(COALESCE(v_payment.payment_type, '')) = 'rent'
           AND lower(COALESCE(rent_payment_status, '')) <> 'paid' THEN 'failed'
      ELSE rent_payment_status
    END,
    verification_status = CASE
      WHEN verification_status = 'verified' THEN verification_status
      ELSE 'failed'
    END,
    updated_at = timezone('utc', now())
  WHERE id = v_payment.booking_id;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'status', v_payment.status,
    'attempt_state', v_payment.attempt_state
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_payment_attempt_v3(UUID, TEXT, NUMERIC, UUID, UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_attempt_gateway_created_v3(UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_attempt_not_paid_v3(UUID, TEXT, TEXT, JSONB) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.run_payment_expiry_verification()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url TEXT;
  service_key TEXT;
  headers JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  SELECT value INTO supabase_url FROM public.config WHERE key = 'supabase_url';
  SELECT value INTO service_key FROM public.config WHERE key = 'supabase_service_role_key';

  IF supabase_url IS NULL OR service_key IS NULL THEN
    RETURN;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || service_key
  );

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/payment-expiry-cron',
    headers := headers,
    body := jsonb_build_object(
      'trigger', 'pg_cron',
      'limit', 200
    )
  );
END;
$$;
DO $$
DECLARE
  v_job_id INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'payment-expiry-cron-every-5m';

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'payment-expiry-cron-every-5m',
      '*/5 * * * *',
      'SELECT public.run_payment_expiry_verification();'
    );
  END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
