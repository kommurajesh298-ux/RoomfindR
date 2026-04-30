-- Realtime Cashfree gateway (customer collections + admin refunds + owner payouts)
-- Canonical idempotent payment attempt model with webhook-driven finalization.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION public.cashfree_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.cashfree_generate_trace_id()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT replace(gen_random_uuid()::text, '-', '');
$$;
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount_total numeric(12, 2) NOT NULL CHECK (amount_total > 0),
  amount_advance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount_advance >= 0),
  commission_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  status text NOT NULL DEFAULT 'created' CHECK (
    status IN (
      'created',
      'checkout_started',
      'payment_pending',
      'paid',
      'packing',
      'out_for_delivery',
      'delivered',
      'cancelled',
      'refunded'
    )
  ),
  trace_id text NOT NULL DEFAULT public.cashfree_generate_trace_id(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_payment_attempt_id uuid,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  gateway_order_id text,
  gateway_payment_id text,
  gateway_payment_session_id text,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'upi',
  status text NOT NULL DEFAULT 'started' CHECK (
    status IN (
      'started',
      'gateway_initiated',
      'payment_pending',
      'success',
      'failed',
      'cancelled',
      'refunded'
    )
  ),
  webhook_verified boolean NOT NULL DEFAULT FALSE,
  webhook_event_id text,
  client_return_url text,
  trace_id text NOT NULL DEFAULT public.cashfree_generate_trace_id(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  failure_code text,
  failure_message text,
  cancel_reason text,
  gateway_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_latest_payment_attempt_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_latest_payment_attempt_fkey
      FOREIGN KEY (latest_payment_attempt_id)
      REFERENCES public.payment_attempts(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  gateway_refund_id text,
  idempotency_key text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'initiated', 'success', 'failed')
  ),
  webhook_verified boolean NOT NULL DEFAULT FALSE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trace_id text NOT NULL DEFAULT public.cashfree_generate_trace_id(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  admin_approved boolean NOT NULL DEFAULT FALSE,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payout_status text NOT NULL DEFAULT 'pending' CHECK (
    payout_status IN ('pending', 'initiated', 'success', 'failed')
  ),
  cashfree_payout_id text,
  idempotency_key text NOT NULL,
  trace_id text NOT NULL DEFAULT public.cashfree_generate_trace_id(),
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.cashfree_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('payments', 'settlements')),
  event_id text NOT NULL,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT FALSE,
  processed boolean NOT NULL DEFAULT FALSE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  processed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.payment_attempt_history (
  id bigserial PRIMARY KEY,
  payment_attempt_id uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.payment_realtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  event_type text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE CASCADE,
  refund_id uuid REFERENCES public.refunds(id) ON DELETE CASCADE,
  payout_id uuid REFERENCES public.payouts(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_trace_id_uk ON public.orders(trace_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_idempotency_key_uk ON public.payment_attempts(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_gateway_payment_id_uk
  ON public.payment_attempts(gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_active_per_order_uk
  ON public.payment_attempts(order_id)
  WHERE status IN ('started', 'gateway_initiated', 'payment_pending');
CREATE UNIQUE INDEX IF NOT EXISTS refunds_idempotency_key_uk ON public.refunds(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_gateway_refund_id_uk
  ON public.refunds(gateway_refund_id) WHERE gateway_refund_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payouts_idempotency_key_uk ON public.payouts(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payouts_cashfree_payout_id_uk
  ON public.payouts(cashfree_payout_id) WHERE cashfree_payout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cashfree_webhook_events_dedupe_uk
  ON public.cashfree_webhook_events(source, event_id);
CREATE INDEX IF NOT EXISTS orders_customer_status_idx ON public.orders(customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_owner_status_idx ON public.orders(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_attempts_order_idx ON public.payment_attempts(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_attempt_idx ON public.refunds(payment_attempt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payouts_owner_idx ON public.payouts(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_realtime_topic_idx ON public.payment_realtime_events(topic, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_realtime_customer_idx ON public.payment_realtime_events(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_realtime_owner_idx ON public.payment_realtime_events(owner_id, created_at DESC);
DROP TRIGGER IF EXISTS orders_updated_at_trg ON public.orders;
CREATE TRIGGER orders_updated_at_trg
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_set_updated_at();
DROP TRIGGER IF EXISTS payment_attempts_updated_at_trg ON public.payment_attempts;
CREATE TRIGGER payment_attempts_updated_at_trg
BEFORE UPDATE ON public.payment_attempts
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_set_updated_at();
DROP TRIGGER IF EXISTS refunds_updated_at_trg ON public.refunds;
CREATE TRIGGER refunds_updated_at_trg
BEFORE UPDATE ON public.refunds
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_set_updated_at();
DROP TRIGGER IF EXISTS payouts_updated_at_trg ON public.payouts;
CREATE TRIGGER payouts_updated_at_trg
BEFORE UPDATE ON public.payouts
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_set_updated_at();
CREATE OR REPLACE FUNCTION public.cashfree_sync_latest_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.orders
  SET latest_payment_attempt_id = NEW.id,
      updated_at = NOW()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_attempts_sync_latest_trg ON public.payment_attempts;
CREATE TRIGGER payment_attempts_sync_latest_trg
AFTER INSERT ON public.payment_attempts
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_sync_latest_attempt();
CREATE OR REPLACE FUNCTION public.cashfree_log_attempt_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.payment_attempt_history (
      payment_attempt_id,
      old_status,
      new_status,
      reason,
      changed_by,
      metadata
    )
    VALUES (
      NEW.id,
      NULL,
      NEW.status,
      'attempt_created',
      NEW.created_by,
      jsonb_build_object('source', 'insert')
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.payment_attempt_history (
      payment_attempt_id,
      old_status,
      new_status,
      reason,
      changed_by,
      metadata
    )
    VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      COALESCE(NEW.failure_message, NEW.cancel_reason, 'status_transition'),
      COALESCE(NEW.cancelled_by, NEW.created_by),
      jsonb_build_object(
        'webhook_verified', NEW.webhook_verified,
        'gateway_payment_id', NEW.gateway_payment_id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_attempts_history_trg ON public.payment_attempts;
CREATE TRIGGER payment_attempts_history_trg
AFTER INSERT OR UPDATE ON public.payment_attempts
FOR EACH ROW
EXECUTE FUNCTION public.cashfree_log_attempt_history();
CREATE OR REPLACE FUNCTION public.cashfree_is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_admin boolean := FALSE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.is_admin_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT EXISTS (
           SELECT 1
           FROM public.is_admin_accounts
           WHERE user_id = $1
             AND COALESCE(is_admin, TRUE) = TRUE
         )'
      INTO v_is_admin
      USING p_user_id;
      IF COALESCE(v_is_admin, FALSE) THEN
        RETURN TRUE;
      END IF;
    EXCEPTION
      WHEN undefined_column THEN
        BEGIN
          EXECUTE
            'SELECT EXISTS (
               SELECT 1
               FROM public.is_admin_accounts
               WHERE user_id = $1
             )'
          INTO v_is_admin
          USING p_user_id;
          IF COALESCE(v_is_admin, FALSE) THEN
            RETURN TRUE;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  IF to_regclass('public.admins') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT EXISTS (
           SELECT 1
           FROM public.admins
           WHERE id = $1 OR user_id = $1
         )'
      INTO v_is_admin
      USING p_user_id;
      IF COALESCE(v_is_admin, FALSE) THEN
        RETURN TRUE;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT EXISTS (
           SELECT 1
           FROM public.profiles
           WHERE id = $1
             AND LOWER(COALESCE(role, '''')) = ''admin''
         )'
      INTO v_is_admin
      USING p_user_id;
      IF COALESCE(v_is_admin, FALSE) THEN
        RETURN TRUE;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  RETURN FALSE;
END;
$$;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashfree_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_realtime_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_customer_insert ON public.orders;
CREATE POLICY orders_customer_insert
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = customer_id);
DROP POLICY IF EXISTS orders_customer_owner_admin_select ON public.orders;
CREATE POLICY orders_customer_owner_admin_select
ON public.orders
FOR SELECT
TO authenticated
USING (
  auth.uid() = customer_id
  OR auth.uid() = owner_id
  OR public.cashfree_is_admin(auth.uid())
);
DROP POLICY IF EXISTS payment_attempts_customer_owner_admin_select ON public.payment_attempts;
CREATE POLICY payment_attempts_customer_owner_admin_select
ON public.payment_attempts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = payment_attempts.order_id
      AND (
        o.customer_id = auth.uid()
        OR o.owner_id = auth.uid()
        OR public.cashfree_is_admin(auth.uid())
      )
  )
);
DROP POLICY IF EXISTS refunds_customer_owner_admin_select ON public.refunds;
CREATE POLICY refunds_customer_owner_admin_select
ON public.refunds
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payment_attempts pa
    JOIN public.orders o ON o.id = pa.order_id
    WHERE pa.id = refunds.payment_attempt_id
      AND (
        o.customer_id = auth.uid()
        OR o.owner_id = auth.uid()
        OR public.cashfree_is_admin(auth.uid())
      )
  )
);
DROP POLICY IF EXISTS payouts_owner_admin_select ON public.payouts;
CREATE POLICY payouts_owner_admin_select
ON public.payouts
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
);
DROP POLICY IF EXISTS webhook_events_admin_select ON public.cashfree_webhook_events;
CREATE POLICY webhook_events_admin_select
ON public.cashfree_webhook_events
FOR SELECT
TO authenticated
USING (public.cashfree_is_admin(auth.uid()));
DROP POLICY IF EXISTS payment_attempt_history_customer_owner_admin_select ON public.payment_attempt_history;
CREATE POLICY payment_attempt_history_customer_owner_admin_select
ON public.payment_attempt_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payment_attempts pa
    JOIN public.orders o ON o.id = pa.order_id
    WHERE pa.id = payment_attempt_history.payment_attempt_id
      AND (
        o.customer_id = auth.uid()
        OR o.owner_id = auth.uid()
        OR public.cashfree_is_admin(auth.uid())
      )
  )
);
DROP POLICY IF EXISTS payment_realtime_customer_owner_admin_select ON public.payment_realtime_events;
CREATE POLICY payment_realtime_customer_owner_admin_select
ON public.payment_realtime_events
FOR SELECT
TO authenticated
USING (
  customer_id = auth.uid()
  OR owner_id = auth.uid()
  OR public.cashfree_is_admin(auth.uid())
);
GRANT SELECT, INSERT ON public.orders TO authenticated;
GRANT SELECT ON public.payment_attempts TO authenticated;
GRANT SELECT ON public.refunds TO authenticated;
GRANT SELECT ON public.payouts TO authenticated;
GRANT SELECT ON public.payment_attempt_history TO authenticated;
GRANT SELECT ON public.cashfree_webhook_events TO authenticated;
GRANT SELECT ON public.payment_realtime_events TO authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_attempts;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.refunds;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payouts;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_realtime_events;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.payment_attempts REPLICA IDENTITY FULL;
ALTER TABLE public.refunds REPLICA IDENTITY FULL;
ALTER TABLE public.payouts REPLICA IDENTITY FULL;
ALTER TABLE public.payment_realtime_events REPLICA IDENTITY FULL;
