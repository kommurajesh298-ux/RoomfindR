BEGIN;
-- =============================================================
-- Manual occupancy + owner-recorded rent collection schema
-- =============================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS collection_mode TEXT,
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_cash_collection BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS collected_by UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_date DATE,
  ADD COLUMN IF NOT EXISTS receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_type TEXT,
  ADD COLUMN IF NOT EXISTS invoice_source TEXT,
  ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.payments
SET payment_method = CASE
  WHEN lower(trim(COALESCE(payment_method, ''))) IN ('cash') THEN 'cash'
  WHEN lower(trim(COALESCE(payment_method, ''))) IN ('bank', 'bank_transfer', 'bank transfer') THEN 'bank'
  WHEN lower(trim(COALESCE(payment_method, ''))) IN ('upi') THEN 'upi'
  WHEN lower(trim(COALESCE(payment_method, ''))) IN ('card', 'wallet', 'netbanking', 'online') THEN 'online'
  WHEN COALESCE(trim(payment_method), '') = '' THEN NULL
  ELSE lower(trim(payment_method))
END
WHERE payment_method IS NOT NULL;
UPDATE public.payments
SET collection_mode = CASE
  WHEN lower(trim(COALESCE(collection_mode, ''))) IN ('cash') THEN 'cash'
  WHEN lower(trim(COALESCE(collection_mode, ''))) IN ('bank', 'bank_transfer', 'bank transfer') THEN 'bank'
  WHEN lower(trim(COALESCE(collection_mode, ''))) IN ('upi') THEN 'upi'
  WHEN lower(trim(COALESCE(collection_mode, ''))) IN ('online') THEN 'online'
  WHEN lower(trim(COALESCE(collection_mode, ''))) IN ('mixed') THEN 'mixed'
  WHEN is_manual IS TRUE AND lower(trim(COALESCE(payment_method, ''))) = 'cash' THEN 'cash'
  WHEN is_manual IS TRUE THEN 'mixed'
  ELSE COALESCE(collection_mode, 'online')
END;
UPDATE public.payments
SET verification_status = CASE
  WHEN lower(trim(COALESCE(verification_status, ''))) IN (
    'pending',
    'verified',
    'failed',
    'skipped',
    'owner_recorded',
    'pending_admin_review',
    'disputed',
    'rejected',
    'approved'
  ) THEN lower(trim(verification_status))
  WHEN COALESCE(trim(verification_status), '') = '' THEN 'pending'
  ELSE 'pending'
END;
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method IN ('cash', 'online', 'bank', 'upi')
  );
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_collection_mode_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_collection_mode_check
  CHECK (
    collection_mode IS NULL
    OR collection_mode IN ('cash', 'online', 'bank', 'upi', 'mixed')
  );
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_verification_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_verification_status_check
  CHECK (
    verification_status IN (
      'pending',
      'verified',
      'failed',
      'skipped',
      'owner_recorded',
      'pending_admin_review',
      'disputed',
      'rejected',
      'approved'
    )
  );
CREATE INDEX IF NOT EXISTS idx_payments_is_manual ON public.payments(is_manual);
CREATE INDEX IF NOT EXISTS idx_payments_collection_mode ON public.payments(collection_mode);
CREATE INDEX IF NOT EXISTS idx_payments_collected_by ON public.payments(collected_by);
CREATE INDEX IF NOT EXISTS idx_payments_manual_review_required ON public.payments(manual_review_required);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_rent_payment_month_unique
  ON public.payments(booking_id, (metadata ->> 'collection_month'))
  WHERE is_manual IS TRUE
    AND lower(COALESCE(payment_type, '')) IN ('rent', 'monthly', 'monthly_rent')
    AND COALESCE(metadata ->> 'collection_month', '') <> ''
    AND lower(COALESCE(status, payment_status, '')) NOT IN ('failed', 'cancelled', 'rejected');
CREATE TABLE IF NOT EXISTS public.room_status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  occupied BOOLEAN NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('occupied', 'vacated')),
  payment_mode TEXT CHECK (payment_mode IN ('online', 'cash', 'mixed')),
  expected_rent NUMERIC(10,2),
  start_date DATE,
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_room_status_logs_room_created ON public.room_status_logs(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_status_logs_owner_created ON public.room_status_logs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_status_logs_booking ON public.room_status_logs(booking_id);
CREATE TABLE IF NOT EXISTS public.manual_payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'reviewed')),
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_manual_payment_logs_payment_created ON public.manual_payment_logs(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_payment_logs_owner_created ON public.manual_payment_logs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_payment_logs_reviewed_created ON public.manual_payment_logs(reviewed_by, created_at DESC);
ALTER TABLE public.room_status_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_payment_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS room_status_logs_select_owner_admin ON public.room_status_logs;
CREATE POLICY room_status_logs_select_owner_admin
ON public.room_status_logs
FOR SELECT
USING (
  owner_id = auth.uid()
  OR public.is_admin(auth.uid())
);
DROP POLICY IF EXISTS room_status_logs_insert_owner_admin ON public.room_status_logs;
CREATE POLICY room_status_logs_insert_owner_admin
ON public.room_status_logs
FOR INSERT
WITH CHECK (
  owner_id = auth.uid()
  OR public.is_admin(auth.uid())
);
DROP POLICY IF EXISTS manual_payment_logs_select_owner_admin ON public.manual_payment_logs;
CREATE POLICY manual_payment_logs_select_owner_admin
ON public.manual_payment_logs
FOR SELECT
USING (
  owner_id = auth.uid()
  OR reviewed_by = auth.uid()
  OR public.is_admin(auth.uid())
);
DROP POLICY IF EXISTS manual_payment_logs_insert_owner_admin ON public.manual_payment_logs;
CREATE POLICY manual_payment_logs_insert_owner_admin
ON public.manual_payment_logs
FOR INSERT
WITH CHECK (
  owner_id = auth.uid()
  OR reviewed_by = auth.uid()
  OR public.is_admin(auth.uid())
);
-- =============================================================
-- Ledger-safe manual collection accounting
-- =============================================================

INSERT INTO ledger.accounts (code, name, account_type, is_system)
VALUES
  ('owner_receivable_manual', 'Owner Receivable (Manual)', 'asset', TRUE),
  ('rent_revenue', 'Rent Revenue', 'revenue', TRUE)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE ledger.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_entry_type_check;
ALTER TABLE ledger.journal_entries
  ADD CONSTRAINT journal_entries_entry_type_check
  CHECK (
    entry_type IN (
      'payment_success',
      'payout_success',
      'refund_success',
      'commission_deduction',
      'manual_collection'
    )
  );
CREATE OR REPLACE FUNCTION ledger.record_manual_collection(p_payment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_journal_id UUID;
  v_amount NUMERIC(12,2);
  v_mode TEXT;
  v_receivable_account UUID;
  v_revenue_account UUID;
BEGIN
  SELECT
    COALESCE(p.amount, 0)::NUMERIC(12,2),
    lower(COALESCE(p.collection_mode, p.payment_method, 'cash'))
  INTO v_amount, v_mode
  FROM public.payments p
  WHERE p.id = p_payment_id;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO ledger.journal_entries (entry_type, source_table, source_id, description, metadata)
  VALUES (
    'manual_collection',
    'payments',
    p_payment_id,
    'Manual rent collection recorded by owner',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'amount', v_amount,
      'collection_mode', v_mode
    )
  )
  ON CONFLICT (source_table, source_id, entry_type)
  DO UPDATE SET
    description = EXCLUDED.description,
    metadata = EXCLUDED.metadata
  RETURNING id INTO v_journal_id;

  SELECT id INTO v_receivable_account FROM ledger.accounts WHERE code = 'owner_receivable_manual';
  SELECT id INTO v_revenue_account FROM ledger.accounts WHERE code = 'rent_revenue';

  INSERT INTO ledger.ledger_lines (journal_entry_id, account_id, side, amount, description)
  VALUES
    (v_journal_id, v_receivable_account, 'debit', v_amount, 'Owner manual collection receivable'),
    (v_journal_id, v_revenue_account, 'credit', v_amount, 'Rent revenue from owner-collected payment')
  ON CONFLICT (journal_entry_id, side, account_id)
  DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description;

  RETURN v_journal_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.trg_ledger_payment_success()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, ledger
AS $$
DECLARE
  v_new_status TEXT := lower(COALESCE(NEW.payment_status, NEW.status, ''));
  v_old_status TEXT := lower(COALESCE(OLD.payment_status, OLD.status, ''));
  v_new_verification TEXT := lower(COALESCE(NEW.verification_status, 'pending'));
BEGIN
  IF v_new_status IN ('paid', 'success', 'completed')
     AND v_old_status NOT IN ('paid', 'success', 'completed') THEN
    IF NEW.is_manual IS TRUE THEN
      IF v_new_verification IN ('owner_recorded', 'pending_admin_review', 'verified', 'approved') THEN
        PERFORM ledger.record_manual_collection(NEW.id);
      END IF;
    ELSE
      IF v_new_verification = 'verified' THEN
        PERFORM ledger.record_payment_success(NEW.id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- =============================================================
-- Manual occupancy + payment RPCs
-- =============================================================

CREATE OR REPLACE FUNCTION public.owner_get_room_status_candidates(
  p_room_id UUID
) RETURNS TABLE (
  booking_id UUID,
  tenant_name TEXT,
  start_date DATE,
  expected_rent NUMERIC,
  payment_mode TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_owner_id UUID;
  v_property_id UUID;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  SELECT p.owner_id, r.property_id
  INTO v_owner_id, v_property_id
  FROM public.rooms r
  JOIN public.properties p ON p.id = r.property_id
  WHERE r.id = p_room_id
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_actor IS DISTINCT FROM v_owner_id AND NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    COALESCE(NULLIF(trim(b.customer_name), ''), 'Tenant'),
    COALESCE(b.check_in_date, b.start_date, timezone('utc', now())::date),
    COALESCE(NULLIF(b.monthly_rent, 0), 0),
    CASE
      WHEN lower(COALESCE(b.payment_method, '')) IN ('cash') THEN 'cash'
      WHEN lower(COALESCE(b.payment_method, '')) IN ('bank') THEN 'online'
      WHEN lower(COALESCE(b.payment_method, '')) IN ('upi') THEN 'online'
      ELSE 'online'
    END
  FROM public.bookings b
  WHERE b.property_id = v_property_id
    AND b.owner_id = v_owner_id
    AND b.vacate_date IS NULL
    AND (
      lower(COALESCE(b.status::TEXT, '')) IN ('accepted', 'approved', 'confirmed', 'active', 'checked-in', 'checked_in', 'ongoing', 'vacate_requested')
      OR lower(COALESCE(b.booking_status, '')) IN ('accepted', 'approved', 'confirmed', 'active', 'checked-in', 'checked_in', 'ongoing', 'vacate_requested')
      OR lower(COALESCE(b.stay_status, '')) IN ('ongoing', 'active', 'vacate_requested')
    )
  ORDER BY COALESCE(b.updated_at, b.created_at) DESC;
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_update_room_status_control(
  p_room_id UUID,
  p_occupied BOOLEAN,
  p_booking_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_expected_rent NUMERIC DEFAULT NULL,
  p_payment_mode TEXT DEFAULT 'online',
  p_ip_address INET DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_room RECORD;
  v_booking public.bookings%ROWTYPE;
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_mode TEXT := lower(trim(COALESCE(p_payment_mode, 'online')));
  v_log_id UUID;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  IF v_mode NOT IN ('online', 'cash', 'mixed') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MODE';
  END IF;

  SELECT
    r.id,
    r.room_number,
    r.property_id,
    p.owner_id
  INTO v_room
  FROM public.rooms r
  JOIN public.properties p ON p.id = r.property_id
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_actor IS DISTINCT FROM v_room.owner_id AND NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_occupied THEN
    IF p_booking_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_REQUIRED_FOR_OCCUPIED';
    END IF;

    SELECT *
    INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND b.property_id = v_room.property_id
      AND b.owner_id = v_room.owner_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (
      lower(COALESCE(v_booking.status::TEXT, '')) IN ('accepted', 'approved', 'confirmed', 'active', 'checked-in', 'checked_in', 'ongoing', 'vacate_requested', 'payment_pending', 'paid')
      OR lower(COALESCE(v_booking.booking_status, '')) IN ('accepted', 'approved', 'confirmed', 'active', 'checked-in', 'checked_in', 'ongoing', 'vacate_requested', 'payment_pending', 'paid')
    ) THEN
      RAISE EXCEPTION 'BOOKING_NOT_APPROVED';
    END IF;

    UPDATE public.bookings
    SET
      room_id = p_room_id,
      room_number = COALESCE(v_room.room_number, room_number),
      start_date = COALESCE(p_start_date, start_date, v_now::date),
      check_in_date = COALESCE(check_in_date, p_start_date, v_now::date),
      monthly_rent = COALESCE(p_expected_rent, monthly_rent),
      payment_method = CASE
        WHEN v_mode = 'cash' THEN 'cash'
        WHEN v_mode = 'online' THEN COALESCE(NULLIF(payment_method, ''), 'online')
        WHEN v_mode = 'mixed' THEN COALESCE(NULLIF(payment_method, ''), 'online')
        ELSE payment_method
      END,
      status = 'active',
      booking_status = 'ACTIVE',
      stay_status = 'ongoing',
      vacate_date = NULL,
      continue_status = COALESCE(NULLIF(continue_status, ''), 'ongoing'),
      updated_at = v_now
    WHERE id = v_booking.id;

    PERFORM public.recalculate_room_occupancy(p_room_id);

    INSERT INTO public.room_status_logs (
      property_id,
      room_id,
      booking_id,
      owner_id,
      occupied,
      action,
      payment_mode,
      expected_rent,
      start_date,
      ip_address,
      metadata
    ) VALUES (
      v_room.property_id,
      p_room_id,
      v_booking.id,
      v_room.owner_id,
      TRUE,
      'occupied',
      v_mode,
      COALESCE(p_expected_rent, v_booking.monthly_rent),
      COALESCE(p_start_date, v_booking.start_date, v_now::date),
      COALESCE(p_ip_address, inet_client_addr()),
      jsonb_build_object(
        'room_number', v_room.room_number,
        'tenant_name', COALESCE(v_booking.customer_name, ''),
        'source', 'owner_manual_status_control'
      )
    )
    RETURNING id INTO v_log_id;

    RETURN jsonb_build_object(
      'success', true,
      'occupied', true,
      'booking_id', v_booking.id,
      'room_id', p_room_id,
      'log_id', v_log_id
    );
  END IF;

  IF p_booking_id IS NULL THEN
    SELECT b.*
    INTO v_booking
    FROM public.bookings b
    WHERE b.room_id = p_room_id
      AND b.owner_id = v_room.owner_id
      AND b.vacate_date IS NULL
      AND (
        lower(COALESCE(b.status::TEXT, '')) IN ('checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
        OR lower(COALESCE(b.booking_status, '')) IN ('checked-in', 'checked_in', 'active', 'ongoing', 'vacate_requested')
        OR lower(COALESCE(b.stay_status, '')) IN ('ongoing', 'active', 'vacate_requested')
      )
    ORDER BY COALESCE(b.check_in_date, b.start_date, b.created_at::date) DESC
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT *
    INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND b.owner_id = v_room.owner_id
      AND b.property_id = v_room.property_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTIVE_BOOKING_REQUIRED_TO_VACATE';
  END IF;

  UPDATE public.bookings
  SET
    status = 'completed',
    booking_status = 'COMPLETED',
    stay_status = 'vacated',
    continue_status = 'exit-completed',
    vacate_date = COALESCE(vacate_date, v_now::date),
    updated_at = v_now
  WHERE id = v_booking.id;

  PERFORM public.recalculate_room_occupancy(p_room_id);

  INSERT INTO public.room_status_logs (
    property_id,
    room_id,
    booking_id,
    owner_id,
    occupied,
    action,
    payment_mode,
    expected_rent,
    start_date,
    ip_address,
    metadata
  ) VALUES (
    v_room.property_id,
    p_room_id,
    v_booking.id,
    v_room.owner_id,
    FALSE,
    'vacated',
    v_mode,
    COALESCE(p_expected_rent, v_booking.monthly_rent),
    COALESCE(p_start_date, v_booking.start_date),
    COALESCE(p_ip_address, inet_client_addr()),
    jsonb_build_object(
      'room_number', v_room.room_number,
      'tenant_name', COALESCE(v_booking.customer_name, ''),
      'source', 'owner_manual_status_control'
    )
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'occupied', false,
    'booking_id', v_booking.id,
    'room_id', p_room_id,
    'log_id', v_log_id
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.owner_record_manual_rent_payment(
  p_booking_id UUID,
  p_amount NUMERIC,
  p_payment_mode TEXT,
  p_collected_date DATE,
  p_notes TEXT DEFAULT NULL,
  p_receipt_url TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_mode TEXT := lower(trim(COALESCE(p_payment_mode, 'cash')));
  v_method TEXT;
  v_collection_month TEXT;
  v_attempt INTEGER := 1;
  v_duplicate_id UUID;
  v_owner_name TEXT;
  v_needs_review BOOLEAN := FALSE;
  v_verification_status TEXT := 'owner_recorded';
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_ID_REQUIRED';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  IF v_mode IN ('bank_transfer', 'bank transfer') THEN
    v_mode := 'bank';
  END IF;

  IF v_mode NOT IN ('cash', 'bank', 'upi') THEN
    RAISE EXCEPTION 'INVALID_COLLECTION_MODE';
  END IF;

  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_actor IS DISTINCT FROM v_booking.owner_id AND NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF v_booking.vacate_date IS NOT NULL THEN
    RAISE EXCEPTION 'BOOKING_ALREADY_VACATED';
  END IF;

  IF lower(COALESCE(v_booking.status::TEXT, '')) IN ('cancelled', 'rejected', 'completed', 'checked_out', 'checked-out', 'vacated') THEN
    RAISE EXCEPTION 'BOOKING_NOT_ACTIVE';
  END IF;

  v_collection_month := to_char(COALESCE(p_collected_date, v_now::date), 'YYYY-MM');

  SELECT p.id
  INTO v_duplicate_id
  FROM public.payments p
  WHERE p.booking_id = p_booking_id
    AND p.is_manual IS TRUE
    AND lower(COALESCE(p.payment_type, '')) IN ('rent', 'monthly', 'monthly_rent')
    AND COALESCE(p.metadata ->> 'collection_month', '') = v_collection_month
    AND lower(COALESCE(p.status, p.payment_status, '')) NOT IN ('failed', 'cancelled', 'rejected')
  LIMIT 1;

  IF v_duplicate_id IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_MONTHLY_MANUAL_PAYMENT';
  END IF;

  IF p_amount > COALESCE(v_booking.monthly_rent, 0) AND COALESCE(v_booking.monthly_rent, 0) > 0 THEN
    v_needs_review := TRUE;
    v_verification_status := 'pending_admin_review';
  END IF;

  SELECT COALESCE(MAX(p.attempt_number), 0) + 1
  INTO v_attempt
  FROM public.payments p
  WHERE p.booking_id = p_booking_id;

  v_method := v_mode;

  SELECT COALESCE(o.name, 'Owner')
  INTO v_owner_name
  FROM public.owners o
  WHERE o.id = v_booking.owner_id;

  INSERT INTO public.payments (
    booking_id,
    payment_type,
    amount,
    status,
    payment_status,
    attempt_state,
    attempt_number,
    destination,
    settlement_status,
    payout_status,
    provider,
    payment_method,
    collection_mode,
    is_manual,
    is_cash_collection,
    collected_by,
    collected_date,
    verification_status,
    manual_review_required,
    invoice_type,
    invoice_source,
    receipt_url,
    notes,
    idempotency_key,
    last_provider_check_at,
    metadata
  )
  VALUES (
    p_booking_id,
    'rent',
    round(p_amount::numeric, 2),
    'paid',
    'paid',
    'success',
    GREATEST(1, COALESCE(v_attempt, 1)),
    'owner_direct',
    'not_eligible',
    'pending',
    'manual',
    v_method,
    v_mode,
    TRUE,
    (v_mode = 'cash'),
    v_booking.owner_id,
    COALESCE(p_collected_date, v_now::date),
    v_verification_status,
    v_needs_review,
    'owner_manual',
    'owner_manual',
    NULLIF(trim(COALESCE(p_receipt_url, '')), ''),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    format('manual-rent:%s:%s', p_booking_id, v_collection_month),
    v_now,
    jsonb_build_object(
      'collection_month', v_collection_month,
      'collection_mode', v_mode,
      'collected_by', v_booking.owner_id,
      'collected_by_name', COALESCE(v_owner_name, 'Owner'),
      'collected_at', v_now,
      'collected_date', COALESCE(p_collected_date, v_now::date),
      'collected_ip', COALESCE(p_ip_address, inet_client_addr())::TEXT,
      'invoice_source', 'owner_manual',
      'verification_status', v_verification_status,
      'needs_admin_review', v_needs_review
    )
  )
  RETURNING * INTO v_payment;

  UPDATE public.bookings
  SET
    payment_status = 'paid',
    rent_payment_status = 'paid',
    updated_at = v_now
  WHERE id = p_booking_id;

  INSERT INTO public.manual_payment_logs (
    payment_id,
    booking_id,
    owner_id,
    event_type,
    ip_address,
    metadata
  ) VALUES (
    v_payment.id,
    p_booking_id,
    v_booking.owner_id,
    'created',
    COALESCE(p_ip_address, inet_client_addr()),
    jsonb_build_object(
      'mode', v_mode,
      'amount', v_payment.amount,
      'verification_status', v_verification_status,
      'manual_review_required', v_needs_review
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'amount', v_payment.amount,
    'status', v_payment.status,
    'payment_status', v_payment.payment_status,
    'verification_status', v_payment.verification_status,
    'collection_mode', v_payment.collection_mode,
    'is_manual', v_payment.is_manual,
    'manual_review_required', v_payment.manual_review_required
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_review_manual_payment(
  p_payment_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_payment public.payments%ROWTYPE;
  v_action TEXT := lower(trim(COALESCE(p_action, '')));
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_customer_id UUID;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ID_REQUIRED';
  END IF;

  IF v_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'INVALID_ACTION';
  END IF;

  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
    AND is_manual IS TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MANUAL_PAYMENT_NOT_FOUND';
  END IF;

  IF v_action = 'approve' THEN
    UPDATE public.payments
    SET
      verification_status = 'verified',
      manual_review_required = FALSE,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_reviewed_by', v_actor,
        'admin_reviewed_at', v_now,
        'admin_review_action', 'approved',
        'admin_review_reason', NULLIF(trim(COALESCE(p_reason, '')), '')
      ),
      updated_at = v_now
    WHERE id = p_payment_id
    RETURNING * INTO v_payment;
  ELSE
    UPDATE public.payments
    SET
      status = 'failed',
      payment_status = 'failed',
      attempt_state = 'failed',
      verification_status = 'disputed',
      manual_review_required = FALSE,
      failure_reason = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Manual payment rejected by admin'),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_reviewed_by', v_actor,
        'admin_reviewed_at', v_now,
        'admin_review_action', 'rejected',
        'admin_review_reason', NULLIF(trim(COALESCE(p_reason, '')), '')
      ),
      updated_at = v_now
    WHERE id = p_payment_id
    RETURNING * INTO v_payment;

    UPDATE public.bookings
    SET
      payment_status = CASE
        WHEN lower(COALESCE(payment_status, '')) = 'paid' THEN 'pending'
        ELSE payment_status
      END,
      rent_payment_status = 'pending',
      updated_at = v_now
    WHERE id = v_payment.booking_id;

    SELECT b.customer_id
    INTO v_customer_id
    FROM public.bookings b
    WHERE b.id = v_payment.booking_id;

    IF v_customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        data,
        is_read,
        created_at
      ) VALUES (
        v_customer_id,
        'Manual payment flagged',
        'A manual rent payment recorded by your owner was rejected by admin and marked disputed.',
        'payment',
        jsonb_build_object(
          'booking_id', v_payment.booking_id,
          'payment_id', v_payment.id,
          'reason', NULLIF(trim(COALESCE(p_reason, '')), '')
        ),
        FALSE,
        v_now
      );
    END IF;
  END IF;

  INSERT INTO public.manual_payment_logs (
    payment_id,
    booking_id,
    owner_id,
    reviewed_by,
    event_type,
    ip_address,
    metadata
  ) VALUES (
    v_payment.id,
    v_payment.booking_id,
    v_payment.collected_by,
    v_actor,
    'reviewed',
    COALESCE(p_ip_address, inet_client_addr()),
    jsonb_build_object(
      'action', v_action,
      'reason', NULLIF(trim(COALESCE(p_reason, '')), ''),
      'verification_status', v_payment.verification_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment.id,
    'action', v_action,
    'status', v_payment.status,
    'payment_status', v_payment.payment_status,
    'verification_status', v_payment.verification_status
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.trg_lock_manual_payment_owner_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF OLD.is_manual IS TRUE
     AND OLD.collected_by IS NOT NULL
     AND v_actor IS NOT NULL
     AND v_actor = OLD.collected_by
     AND NOT public.is_admin(v_actor)
     AND timezone('utc', now()) > (OLD.created_at + INTERVAL '24 hours') THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.collection_mode IS DISTINCT FROM OLD.collection_mode
       OR NEW.collected_date IS DISTINCT FROM OLD.collected_date
       OR COALESCE(NEW.notes, '') IS DISTINCT FROM COALESCE(OLD.notes, '')
       OR COALESCE(NEW.receipt_url, '') IS DISTINCT FROM COALESCE(OLD.receipt_url, '')
       OR COALESCE(NEW.metadata, '{}'::jsonb) IS DISTINCT FROM COALESCE(OLD.metadata, '{}'::jsonb) THEN
      RAISE EXCEPTION 'MANUAL_PAYMENT_EDIT_WINDOW_EXPIRED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lock_manual_payment_owner_edits ON public.payments;
CREATE TRIGGER trg_lock_manual_payment_owner_edits
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.trg_lock_manual_payment_owner_edits();
GRANT EXECUTE ON FUNCTION public.owner_get_room_status_candidates(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_update_room_status_control(UUID, BOOLEAN, UUID, DATE, NUMERIC, TEXT, INET) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_record_manual_rent_payment(UUID, NUMERIC, TEXT, DATE, TEXT, TEXT, INET) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_manual_payment(UUID, TEXT, TEXT, INET) TO authenticated, service_role;
COMMIT;
