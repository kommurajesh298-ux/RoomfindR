BEGIN;
-- =============================================================
-- 1) Account freeze + fraud score controls
-- =============================================================
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS frozen_reason TEXT,
  ADD COLUMN IF NOT EXISTS fraud_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fraud_score_updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now());
CREATE INDEX IF NOT EXISTS idx_accounts_is_frozen ON public.accounts(is_frozen);
CREATE INDEX IF NOT EXISTS idx_accounts_fraud_score ON public.accounts(fraud_score DESC);
CREATE TABLE IF NOT EXISTS public.fraud_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (
    signal_type IN (
      'failed_payments_10m',
      'refunds_24h',
      'shared_ip',
      'immediate_payout_request',
      'manual_freeze',
      'manual_unfreeze'
    )
  ),
  signal_score INTEGER NOT NULL CHECK (signal_score > 0),
  total_score INTEGER NOT NULL CHECK (total_score >= 0),
  window_key TEXT,
  ip_address INET,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_fraud_logs_account_created_at ON public.fraud_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_logs_signal_type ON public.fraud_logs(signal_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_logs_ip_address ON public.fraud_logs(ip_address, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_logs_dedupe_window
  ON public.fraud_logs(account_id, signal_type, window_key)
  WHERE window_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.fraud_ip_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_fraud_ip_activity_ip_created_at
  ON public.fraud_ip_activity(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_ip_activity_account_created_at
  ON public.fraud_ip_activity(account_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.raise_admin_alert(
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'system',
  p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, data)
  SELECT id, p_title, p_message, p_type, COALESCE(p_data, '{}'::jsonb)
  FROM public.accounts
  WHERE role = 'admin';
END;
$$;
CREATE OR REPLACE FUNCTION public.record_fraud_signal(
  p_account_id UUID,
  p_signal_type TEXT,
  p_signal_score INTEGER,
  p_window_key TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.accounts%ROWTYPE;
  v_existing public.fraud_logs%ROWTYPE;
  v_total INTEGER;
  v_now TIMESTAMPTZ := timezone('utc', now());
BEGIN
  IF p_account_id IS NULL OR p_signal_score IS NULL OR p_signal_score <= 0 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'INVALID_INPUT');
  END IF;

  SELECT *
  INTO v_account
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'ACCOUNT_NOT_FOUND');
  END IF;

  IF p_window_key IS NOT NULL AND p_window_key <> '' THEN
    SELECT *
    INTO v_existing
    FROM public.fraud_logs
    WHERE account_id = p_account_id
      AND signal_type = p_signal_type
      AND window_key = p_window_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'recorded', false,
        'duplicate', true,
        'score', COALESCE(v_account.fraud_score, 0),
        'is_frozen', COALESCE(v_account.is_frozen, false)
      );
    END IF;
  END IF;

  v_total := COALESCE(v_account.fraud_score, 0) + p_signal_score;

  UPDATE public.accounts
  SET
    fraud_score = v_total,
    fraud_score_updated_at = v_now,
    is_frozen = CASE WHEN v_total >= 80 THEN TRUE ELSE is_frozen END,
    frozen_at = CASE
      WHEN v_total >= 80 AND COALESCE(is_frozen, false) = false THEN v_now
      ELSE frozen_at
    END,
    frozen_reason = CASE
      WHEN v_total >= 80 AND COALESCE(is_frozen, false) = false THEN 'Fraud score threshold reached'
      ELSE frozen_reason
    END
  WHERE id = p_account_id;

  INSERT INTO public.fraud_logs (
    account_id,
    signal_type,
    signal_score,
    total_score,
    window_key,
    ip_address,
    context,
    created_at
  ) VALUES (
    p_account_id,
    p_signal_type,
    p_signal_score,
    v_total,
    NULLIF(p_window_key, ''),
    p_ip_address,
    COALESCE(p_context, '{}'::jsonb),
    v_now
  );

  IF v_total >= 80 AND COALESCE(v_account.is_frozen, false) = false THEN
    PERFORM public.raise_admin_alert(
      'Account Frozen (Fraud)',
      format('Account %s has been frozen. Risk score: %s', p_account_id, v_total),
      'fraud',
      jsonb_build_object(
        'account_id', p_account_id,
        'fraud_score', v_total,
        'signal_type', p_signal_type
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'recorded', true,
    'score', v_total,
    'is_frozen', v_total >= 80 OR COALESCE(v_account.is_frozen, false)
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.evaluate_failed_payment_fraud(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed_count INTEGER := 0;
  v_window_key TEXT;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'CUSTOMER_REQUIRED');
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_failed_count
  FROM public.payments p
  JOIN public.bookings b ON b.id = p.booking_id
  WHERE b.customer_id = p_customer_id
    AND lower(COALESCE(p.payment_status, p.status, '')) IN ('failed', 'cancelled', 'terminated')
    AND COALESCE(p.updated_at, p.created_at) >= timezone('utc', now()) - interval '10 minutes';

  IF v_failed_count < 5 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'THRESHOLD_NOT_REACHED', 'count', v_failed_count);
  END IF;

  v_window_key := format('failed10m:%s', floor(extract(epoch from timezone('utc', now())) / 600)::BIGINT);

  RETURN public.record_fraud_signal(
    p_customer_id,
    'failed_payments_10m',
    25,
    v_window_key,
    NULL,
    jsonb_build_object('failed_count', v_failed_count, 'window', '10m')
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.evaluate_refund_fraud(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund_count INTEGER := 0;
  v_window_key TEXT;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'CUSTOMER_REQUIRED');
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_refund_count
  FROM public.refunds r
  JOIN public.bookings b ON b.id = r.booking_id
  WHERE b.customer_id = p_customer_id
    AND lower(COALESCE(r.status, '')) IN ('refund_requested', 'processing', 'refunded', 'success')
    AND COALESCE(r.updated_at, r.created_at) >= timezone('utc', now()) - interval '24 hours';

  IF v_refund_count < 3 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'THRESHOLD_NOT_REACHED', 'count', v_refund_count);
  END IF;

  v_window_key := format('refund24h:%s', floor(extract(epoch from timezone('utc', now())) / 86400)::BIGINT);

  RETURN public.record_fraud_signal(
    p_customer_id,
    'refunds_24h',
    30,
    v_window_key,
    NULL,
    jsonb_build_object('refund_count', v_refund_count, 'window', '24h')
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.record_ip_activity(
  p_account_id UUID,
  p_ip_address INET,
  p_event_type TEXT DEFAULT 'activity'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_distinct_accounts INTEGER := 0;
  v_window_key TEXT;
BEGIN
  IF p_account_id IS NULL OR p_ip_address IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'INVALID_INPUT');
  END IF;

  INSERT INTO public.fraud_ip_activity (account_id, ip_address, event_type)
  VALUES (p_account_id, p_ip_address, COALESCE(NULLIF(trim(p_event_type), ''), 'activity'));

  SELECT COUNT(DISTINCT account_id)::INTEGER
  INTO v_distinct_accounts
  FROM public.fraud_ip_activity
  WHERE ip_address = p_ip_address
    AND created_at >= timezone('utc', now()) - interval '24 hours';

  IF v_distinct_accounts < 3 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'THRESHOLD_NOT_REACHED', 'distinct_accounts', v_distinct_accounts);
  END IF;

  v_window_key := format(
    'sharedip:%s:%s',
    p_ip_address::TEXT,
    floor(extract(epoch from timezone('utc', now())) / 86400)::BIGINT
  );

  RETURN public.record_fraud_signal(
    p_account_id,
    'shared_ip',
    40,
    v_window_key,
    p_ip_address,
    jsonb_build_object(
      'distinct_accounts_24h', v_distinct_accounts,
      'event_type', COALESCE(NULLIF(trim(p_event_type), ''), 'activity')
    )
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.evaluate_immediate_payout_fraud(
  p_owner_id UUID,
  p_payment_id UUID,
  p_booking_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_created_at TIMESTAMPTZ;
  v_minutes_since_payment NUMERIC;
  v_window_key TEXT;
BEGIN
  IF p_owner_id IS NULL OR p_payment_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'INVALID_INPUT');
  END IF;

  SELECT created_at
  INTO v_payment_created_at
  FROM public.payments
  WHERE id = p_payment_id;

  IF v_payment_created_at IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'PAYMENT_NOT_FOUND');
  END IF;

  v_minutes_since_payment := extract(epoch FROM (timezone('utc', now()) - v_payment_created_at)) / 60.0;

  IF v_minutes_since_payment > 10 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'NOT_IMMEDIATE', 'minutes_since_payment', v_minutes_since_payment);
  END IF;

  v_window_key := format('immediate_payout:%s', p_payment_id::TEXT);

  RETURN public.record_fraud_signal(
    p_owner_id,
    'immediate_payout_request',
    20,
    v_window_key,
    NULL,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'booking_id', p_booking_id,
      'minutes_since_payment', round(v_minutes_since_payment::NUMERIC, 2)
    )
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.assert_account_not_frozen(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.accounts%ROWTYPE;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_REQUIRED';
  END IF;

  SELECT *
  INTO v_account
  FROM public.accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;

  IF COALESCE(v_account.is_frozen, false) THEN
    RAISE EXCEPTION 'ACCOUNT_FROZEN';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.raise_admin_alert(TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fraud_signal(UUID, TEXT, INTEGER, TEXT, INET, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_failed_payment_fraud(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_refund_fraud(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_ip_activity(UUID, INET, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_immediate_payout_fraud(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_account_not_frozen(UUID) TO authenticated, service_role;
-- =============================================================
-- 2) Minimal double-entry ledger (payment, payout, refund, commission)
-- =============================================================
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE TABLE IF NOT EXISTS ledger.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
INSERT INTO ledger.accounts (code, name, account_type, is_system)
VALUES
  ('cash_escrow', 'Cash Escrow', 'asset', TRUE),
  ('customer_payable', 'Customer Payable', 'liability', TRUE),
  ('commission_revenue', 'Commission Revenue', 'revenue', TRUE)
ON CONFLICT (code) DO NOTHING;
CREATE TABLE IF NOT EXISTS ledger.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('payment_success', 'payout_success', 'refund_success', 'commission_deduction')),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  description TEXT,
  entry_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_journal_source_event
  ON ledger.journal_entries(source_table, source_id, entry_type);
CREATE TABLE IF NOT EXISTS ledger.ledger_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES ledger.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES ledger.accounts(id) ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_journal_id ON ledger.ledger_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_account_id ON ledger.ledger_lines(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_lines_unique_side_account
  ON ledger.ledger_lines(journal_entry_id, side, account_id);
CREATE OR REPLACE FUNCTION ledger.validate_journal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_journal_id UUID := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  v_debit NUMERIC(12,2);
  v_credit NUMERIC(12,2);
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN side = 'debit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN side = 'credit' THEN amount ELSE 0 END), 0)
  INTO v_debit, v_credit
  FROM ledger.ledger_lines
  WHERE journal_entry_id = v_journal_id;

  IF abs(v_debit - v_credit) >= 0.01 THEN
    RAISE EXCEPTION 'LEDGER_IMBALANCED_JOURNAL:%', v_journal_id;
  END IF;

  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_journal_balance ON ledger.ledger_lines;
CREATE CONSTRAINT TRIGGER trg_validate_journal_balance
AFTER INSERT OR UPDATE OR DELETE ON ledger.ledger_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger.validate_journal_balance();
CREATE OR REPLACE FUNCTION ledger.record_payment_success(p_payment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_journal_id UUID;
  v_amount NUMERIC(12,2);
  v_cash_account UUID;
  v_payable_account UUID;
BEGIN
  SELECT COALESCE(p.amount, 0)
  INTO v_amount
  FROM public.payments p
  WHERE p.id = p_payment_id;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO ledger.journal_entries (entry_type, source_table, source_id, description, metadata)
  VALUES (
    'payment_success',
    'payments',
    p_payment_id,
    'Payment success (webhook-verified)',
    jsonb_build_object('payment_id', p_payment_id, 'amount', v_amount)
  )
  ON CONFLICT (source_table, source_id, entry_type)
  DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO v_journal_id;

  SELECT id INTO v_cash_account FROM ledger.accounts WHERE code = 'cash_escrow';
  SELECT id INTO v_payable_account FROM ledger.accounts WHERE code = 'customer_payable';

  INSERT INTO ledger.ledger_lines (journal_entry_id, account_id, side, amount, description)
  VALUES
    (v_journal_id, v_cash_account, 'debit', v_amount, 'Cash received'),
    (v_journal_id, v_payable_account, 'credit', v_amount, 'Customer payable created')
  ON CONFLICT (journal_entry_id, side, account_id)
  DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description;

  RETURN v_journal_id;
END;
$$;
CREATE OR REPLACE FUNCTION ledger.record_payout_success(p_payout_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_payout RECORD;
  v_payout_journal UUID;
  v_commission_journal UUID;
  v_cash_account UUID;
  v_payable_account UUID;
  v_commission_account UUID;
  v_commission NUMERIC(12,2);
  v_net NUMERIC(12,2);
BEGIN
  SELECT
    p.id,
    p.payment_id,
    p.booking_id,
    COALESCE(p.amount, pay.amount, 0)::NUMERIC(12,2) AS gross_amount,
    GREATEST(COALESCE(b.commission_amount, 0), 0)::NUMERIC(12,2) AS commission_amount
  INTO v_payout
  FROM public.payouts p
  LEFT JOIN public.payments pay ON pay.id = p.payment_id
  LEFT JOIN public.bookings b ON b.id = p.booking_id
  WHERE p.id = p_payout_id;

  IF NOT FOUND OR COALESCE(v_payout.gross_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_commission := LEAST(COALESCE(v_payout.commission_amount, 0), v_payout.gross_amount);
  v_net := round((v_payout.gross_amount - v_commission)::NUMERIC, 2);

  SELECT id INTO v_cash_account FROM ledger.accounts WHERE code = 'cash_escrow';
  SELECT id INTO v_payable_account FROM ledger.accounts WHERE code = 'customer_payable';
  SELECT id INTO v_commission_account FROM ledger.accounts WHERE code = 'commission_revenue';

  IF v_commission > 0 THEN
    INSERT INTO ledger.journal_entries (entry_type, source_table, source_id, description, metadata)
    VALUES (
      'commission_deduction',
      'payouts',
      p_payout_id,
      'Commission deduction at settlement',
      jsonb_build_object('payout_id', p_payout_id, 'commission', v_commission)
    )
    ON CONFLICT (source_table, source_id, entry_type)
    DO UPDATE SET description = EXCLUDED.description
    RETURNING id INTO v_commission_journal;

    INSERT INTO ledger.ledger_lines (journal_entry_id, account_id, side, amount, description)
    VALUES
      (v_commission_journal, v_payable_account, 'debit', v_commission, 'Reduce payable by commission'),
      (v_commission_journal, v_commission_account, 'credit', v_commission, 'Commission revenue recognized')
    ON CONFLICT (journal_entry_id, side, account_id)
    DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description;
  END IF;

  IF v_net > 0 THEN
    INSERT INTO ledger.journal_entries (entry_type, source_table, source_id, description, metadata)
    VALUES (
      'payout_success',
      'payouts',
      p_payout_id,
      'Payout success',
      jsonb_build_object('payout_id', p_payout_id, 'net_amount', v_net)
    )
    ON CONFLICT (source_table, source_id, entry_type)
    DO UPDATE SET description = EXCLUDED.description
    RETURNING id INTO v_payout_journal;

    INSERT INTO ledger.ledger_lines (journal_entry_id, account_id, side, amount, description)
    VALUES
      (v_payout_journal, v_payable_account, 'debit', v_net, 'Reduce payable to customer ledger'),
      (v_payout_journal, v_cash_account, 'credit', v_net, 'Cash outflow to owner')
    ON CONFLICT (journal_entry_id, side, account_id)
    DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description;
  END IF;

  RETURN COALESCE(v_payout_journal, v_commission_journal);
END;
$$;
CREATE OR REPLACE FUNCTION ledger.record_refund_success(p_refund_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_journal_id UUID;
  v_amount NUMERIC(12,2);
  v_cash_account UUID;
  v_payable_account UUID;
BEGIN
  SELECT COALESCE(r.amount, 0)::NUMERIC(12,2)
  INTO v_amount
  FROM public.refunds r
  WHERE r.id = p_refund_id;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO ledger.journal_entries (entry_type, source_table, source_id, description, metadata)
  VALUES (
    'refund_success',
    'refunds',
    p_refund_id,
    'Refund success',
    jsonb_build_object('refund_id', p_refund_id, 'amount', v_amount)
  )
  ON CONFLICT (source_table, source_id, entry_type)
  DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO v_journal_id;

  SELECT id INTO v_cash_account FROM ledger.accounts WHERE code = 'cash_escrow';
  SELECT id INTO v_payable_account FROM ledger.accounts WHERE code = 'customer_payable';

  INSERT INTO ledger.ledger_lines (journal_entry_id, account_id, side, amount, description)
  VALUES
    (v_journal_id, v_payable_account, 'debit', v_amount, 'Reduce payable due to refund'),
    (v_journal_id, v_cash_account, 'credit', v_amount, 'Cash outflow for refund')
  ON CONFLICT (journal_entry_id, side, account_id)
  DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description;

  RETURN v_journal_id;
END;
$$;
-- Triggers that attach ledger postings to verified outcomes.
CREATE OR REPLACE FUNCTION public.trg_ledger_payment_success()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_new_status TEXT := lower(COALESCE(NEW.payment_status, NEW.status, ''));
  v_old_status TEXT := lower(COALESCE(OLD.payment_status, OLD.status, ''));
BEGIN
  IF lower(COALESCE(NEW.verification_status, 'pending')) = 'verified'
     AND v_new_status IN ('paid', 'success', 'completed')
     AND v_old_status NOT IN ('paid', 'success', 'completed') THEN
    PERFORM ledger.record_payment_success(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ledger_payment_success ON public.payments;
CREATE TRIGGER trg_ledger_payment_success
AFTER INSERT OR UPDATE OF status, payment_status, verification_status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_payment_success();
CREATE OR REPLACE FUNCTION public.trg_ledger_payout_success()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_new_status TEXT := lower(COALESCE(NEW.status, NEW.payout_status, ''));
  v_old_status TEXT := lower(COALESCE(OLD.status, OLD.payout_status, ''));
BEGIN
  IF lower(COALESCE(NEW.verification_status, 'pending')) = 'verified'
     AND v_new_status IN ('paid', 'success')
     AND v_old_status NOT IN ('paid', 'success') THEN
    PERFORM ledger.record_payout_success(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ledger_payout_success ON public.payouts;
CREATE TRIGGER trg_ledger_payout_success
AFTER INSERT OR UPDATE OF status, payout_status, verification_status ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_payout_success();
CREATE OR REPLACE FUNCTION public.trg_ledger_refund_success()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_new_status TEXT := lower(COALESCE(NEW.status, ''));
  v_old_status TEXT := lower(COALESCE(OLD.status, ''));
BEGIN
  IF lower(COALESCE(NEW.verification_status, 'pending')) = 'verified'
     AND v_new_status IN ('refunded', 'success')
     AND v_old_status NOT IN ('refunded', 'success') THEN
    PERFORM ledger.record_refund_success(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ledger_refund_success ON public.refunds;
CREATE TRIGGER trg_ledger_refund_success
AFTER INSERT OR UPDATE OF status, verification_status ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_refund_success();
-- =============================================================
-- 3) Reconciliation tables and helpers (daily cron target)
-- =============================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_reconciliation_status_check'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_reconciliation_status_check
      CHECK (reconciliation_status IN ('pending', 'clean', 'issue'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payouts_reconciliation_status_check'
  ) THEN
    ALTER TABLE public.payouts
      ADD CONSTRAINT payouts_reconciliation_status_check
      CHECK (reconciliation_status IN ('pending', 'clean', 'issue'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refunds_reconciliation_status_check'
  ) THEN
    ALTER TABLE public.refunds
      ADD CONSTRAINT refunds_reconciliation_status_check
      CHECK (reconciliation_status IN ('pending', 'clean', 'issue'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_payments_reconciliation_status ON public.payments(reconciliation_status, reconciled_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_reconciliation_status ON public.payouts(reconciliation_status, reconciled_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_reconciliation_status ON public.refunds(reconciliation_status, reconciled_at DESC);
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_scope TEXT NOT NULL DEFAULT 'daily' CHECK (run_scope IN ('daily', 'manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  completed_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by TEXT NOT NULL DEFAULT 'cron'
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_started_at
  ON public.reconciliation_runs(started_at DESC);
CREATE TABLE IF NOT EXISTS public.reconciliation_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('payment', 'payout', 'refund')),
  entity_id UUID,
  provider_reference TEXT,
  issue_type TEXT NOT NULL,
  db_amount NUMERIC(12,2),
  provider_amount NUMERIC(12,2),
  db_status TEXT,
  provider_status TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_issues_entity
  ON public.reconciliation_issues(entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_issues_resolved
  ON public.reconciliation_issues(resolved, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_issue_unique_open
  ON public.reconciliation_issues(
    entity_type,
    COALESCE(entity_id::TEXT, ''),
    COALESCE(provider_reference, ''),
    issue_type
  )
  WHERE resolved = FALSE;
CREATE OR REPLACE FUNCTION public.start_reconciliation_run(
  p_run_scope TEXT DEFAULT 'daily',
  p_triggered_by TEXT DEFAULT 'cron'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
BEGIN
  INSERT INTO public.reconciliation_runs (run_scope, status, triggered_by)
  VALUES (
    CASE WHEN p_run_scope IN ('daily', 'manual') THEN p_run_scope ELSE 'daily' END,
    'running',
    COALESCE(NULLIF(trim(p_triggered_by), ''), 'cron')
  )
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.finish_reconciliation_run(
  p_run_id UUID,
  p_status TEXT,
  p_summary JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_run_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.reconciliation_runs
  SET
    status = CASE WHEN p_status IN ('completed', 'failed') THEN p_status ELSE 'failed' END,
    summary = COALESCE(p_summary, '{}'::jsonb),
    completed_at = timezone('utc', now())
  WHERE id = p_run_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.record_reconciliation_issue(
  p_run_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_provider_reference TEXT,
  p_issue_type TEXT,
  p_db_amount NUMERIC,
  p_provider_amount NUMERIC,
  p_db_status TEXT,
  p_provider_status TEXT,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_send_alert BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issue_id UUID;
BEGIN
  SELECT id
  INTO v_issue_id
  FROM public.reconciliation_issues
  WHERE resolved = FALSE
    AND entity_type = p_entity_type
    AND COALESCE(entity_id::TEXT, '') = COALESCE(p_entity_id::TEXT, '')
    AND COALESCE(provider_reference, '') = COALESCE(p_provider_reference, '')
    AND issue_type = p_issue_type
  LIMIT 1;

  IF v_issue_id IS NOT NULL THEN
    UPDATE public.reconciliation_issues
    SET
      run_id = COALESCE(p_run_id, run_id),
      db_amount = p_db_amount,
      provider_amount = p_provider_amount,
      db_status = p_db_status,
      provider_status = p_provider_status,
      details = COALESCE(p_details, '{}'::jsonb)
    WHERE id = v_issue_id;

    RETURN v_issue_id;
  END IF;

  INSERT INTO public.reconciliation_issues (
    run_id,
    entity_type,
    entity_id,
    provider_reference,
    issue_type,
    db_amount,
    provider_amount,
    db_status,
    provider_status,
    details
  ) VALUES (
    p_run_id,
    p_entity_type,
    p_entity_id,
    NULLIF(trim(COALESCE(p_provider_reference, '')), ''),
    p_issue_type,
    p_db_amount,
    p_provider_amount,
    p_db_status,
    p_provider_status,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_issue_id;

  IF p_send_alert THEN
    PERFORM public.raise_admin_alert(
      'Reconciliation Mismatch Detected',
      format('%s mismatch on %s', p_issue_type, p_entity_type),
      'reconciliation',
      jsonb_build_object(
        'issue_id', v_issue_id,
        'entity_type', p_entity_type,
        'entity_id', p_entity_id,
        'provider_reference', p_provider_reference
      )
    );
  END IF;

  RETURN v_issue_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_reconciliation_clean(
  p_entity_type TEXT,
  p_entity_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
BEGIN
  IF p_entity_type = 'payment' THEN
    UPDATE public.payments
    SET reconciliation_status = 'clean', reconciled_at = v_now
    WHERE id = p_entity_id;
  ELSIF p_entity_type = 'payout' THEN
    UPDATE public.payouts
    SET reconciliation_status = 'clean', reconciled_at = v_now
    WHERE id = p_entity_id;
  ELSIF p_entity_type = 'refund' THEN
    UPDATE public.refunds
    SET reconciliation_status = 'clean', reconciled_at = v_now
    WHERE id = p_entity_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_reconciliation_run(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_reconciliation_run(UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_reconciliation_issue(UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, JSONB, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_reconciliation_clean(TEXT, UUID) TO authenticated, service_role;
-- =============================================================
-- 4) Fraud evaluation + payout freeze guards on core financial tables
-- =============================================================
CREATE OR REPLACE FUNCTION public.trg_evaluate_failed_payment_fraud()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_new_status TEXT := lower(COALESCE(NEW.payment_status, NEW.status, ''));
  v_old_status TEXT := lower(COALESCE(OLD.payment_status, OLD.status, ''));
BEGIN
  IF v_new_status IN ('failed', 'cancelled', 'terminated')
     AND v_old_status NOT IN ('failed', 'cancelled', 'terminated') THEN
    SELECT customer_id INTO v_customer_id FROM public.bookings WHERE id = NEW.booking_id;
    IF v_customer_id IS NOT NULL THEN
      PERFORM public.evaluate_failed_payment_fraud(v_customer_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_evaluate_failed_payment_fraud ON public.payments;
CREATE TRIGGER trg_evaluate_failed_payment_fraud
AFTER INSERT OR UPDATE OF status, payment_status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_evaluate_failed_payment_fraud();
CREATE OR REPLACE FUNCTION public.trg_evaluate_refund_fraud()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_new_status TEXT := lower(COALESCE(NEW.status, ''));
  v_old_status TEXT := lower(COALESCE(OLD.status, ''));
BEGIN
  IF v_new_status IN ('refund_requested', 'processing', 'refunded', 'success')
     AND v_old_status IS DISTINCT FROM v_new_status THEN
    SELECT customer_id INTO v_customer_id FROM public.bookings WHERE id = NEW.booking_id;
    IF v_customer_id IS NOT NULL THEN
      PERFORM public.evaluate_refund_fraud(v_customer_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_evaluate_refund_fraud ON public.refunds;
CREATE TRIGGER trg_evaluate_refund_fraud
AFTER INSERT OR UPDATE OF status ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.trg_evaluate_refund_fraud();
CREATE OR REPLACE FUNCTION public.trg_enforce_owner_payout_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  v_owner_id := NEW.owner_id;

  IF v_owner_id IS NULL THEN
    SELECT b.owner_id INTO v_owner_id
    FROM public.bookings b
    WHERE b.id = NEW.booking_id;
    NEW.owner_id := COALESCE(NEW.owner_id, v_owner_id);
  END IF;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_OWNER_REQUIRED';
  END IF;

  PERFORM public.evaluate_immediate_payout_fraud(v_owner_id, NEW.payment_id, NEW.booking_id);

  IF EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = v_owner_id
      AND COALESCE(a.is_frozen, false)
  ) THEN
    RAISE EXCEPTION 'OWNER_ACCOUNT_FROZEN';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_owner_payout_guard ON public.payouts;
CREATE TRIGGER trg_enforce_owner_payout_guard
BEFORE INSERT OR UPDATE OF owner_id, payment_id, booking_id ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_owner_payout_guard();
COMMIT;
